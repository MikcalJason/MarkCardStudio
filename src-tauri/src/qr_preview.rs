// Temporary LAN server that lets a phone open the actually rendered card pages.
// The frontend renders every page through the shared card renderer and hands the
// bytes over IPC; this module keeps them in memory only, serves them (GET only)
// behind a random path token, and stops itself when asked or on expiry.

use std::{
    collections::BTreeMap,
    hash::{Hash, Hasher},
    io::{ErrorKind, Read, Write},
    net::{IpAddr, Shutdown, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

const PREVIEW_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_PREVIEW_FILES: usize = 99;
const MAX_PREVIEW_FILE_BYTES: usize = 24 * 1024 * 1024;
const MAX_PREVIEW_TOTAL_BYTES: usize = 96 * 1024 * 1024;
const MAX_INDEX_HTML_BYTES: usize = 1024 * 1024;
const MAX_CONCURRENT_CONNECTIONS: u32 = 24;
const REQUEST_HEAD_LIMIT: usize = 8 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);
// A scene page is a full-bleed photo, and several of them are requested at once
// by the phone. A short write timeout used to cut the response mid-body on a
// slow phone link, and the phone then showed a broken image for a page that was
// rendered correctly.
const WRITE_TIMEOUT: Duration = Duration::from_secs(60);
// After the body is queued the connection is half-closed and drained until the
// peer closes, so a slow reader never loses the tail of a page.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
const ACCEPT_TICK: Duration = Duration::from_millis(100);

struct ServedFile {
    mime: &'static str,
    bytes: Arc<Vec<u8>>,
}

struct SessionInner {
    token: String,
    index_html: Arc<String>,
    files: BTreeMap<String, ServedFile>,
    listener: Arc<TcpListener>,
    shutdown: AtomicBool,
    stopped: AtomicBool,
    index_hits: AtomicU32,
    image_hits: AtomicU32,
    active: AtomicU32,
}

struct SessionHandle {
    inner: Arc<SessionInner>,
    lan_ip: Option<IpAddr>,
    port: u16,
    expires_at: Instant,
    expires_at_unix_millis: u64,
    page_count: u32,
    total_bytes: u64,
}

impl Drop for SessionHandle {
    fn drop(&mut self) {
        // Wake the accept loop; its Arc keeps the listener alive until it exits,
        // so in-flight connection threads never touch a closed socket.
        self.inner.shutdown.store(true, Ordering::Relaxed);
    }
}

static SESSION: Mutex<Option<SessionHandle>> = Mutex::new(None);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPreviewFileInput {
    name: String,
    data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPreviewStart {
    url: String,
    reachable: bool,
    lan_ip: Option<String>,
    expires_at: u64,
    page_count: u32,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPreviewStats {
    running: bool,
    reachable: bool,
    url: Option<String>,
    open_count: u32,
    image_count: u32,
    expires_at: Option<u64>,
    page_count: u32,
    total_bytes: u64,
}

#[tauri::command]
pub async fn qr_preview_start(
    files: Vec<QrPreviewFileInput>,
    index_html: String,
) -> Result<QrPreviewStart, String> {
    tauri::async_runtime::spawn_blocking(move || start_preview(files, index_html))
        .await
        .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub fn qr_preview_stats() -> Result<QrPreviewStats, String> {
    let mut guard = SESSION
        .lock()
        .map_err(|_| "Preview session state is corrupted".to_string())?;
    if let Some(session) = guard.as_ref() {
        // Expired sessions linger until someone asks; drop them here.
        if Instant::now() < session.expires_at {
            return Ok(stats_for_session(session, true));
        }
    }
    *guard = None;
    Ok(QrPreviewStats {
        running: false,
        reachable: false,
        url: None,
        open_count: 0,
        image_count: 0,
        expires_at: None,
        page_count: 0,
        total_bytes: 0,
    })
}

#[tauri::command]
pub fn qr_preview_stop() -> Result<(), String> {
    let mut guard = SESSION
        .lock()
        .map_err(|_| "Preview session state is corrupted".to_string())?;
    *guard = None;
    Ok(())
}

fn stats_for_session(session: &SessionHandle, running: bool) -> QrPreviewStats {
    let (url, reachable) = preview_url(session.lan_ip, session.port, &session.inner.token);
    QrPreviewStats {
        running,
        reachable,
        url: Some(url),
        open_count: session.inner.index_hits.load(Ordering::Relaxed),
        image_count: session.inner.image_hits.load(Ordering::Relaxed),
        expires_at: Some(session.expires_at_unix_millis),
        page_count: session.page_count,
        total_bytes: session.total_bytes,
    }
}

fn start_preview(
    files: Vec<QrPreviewFileInput>,
    index_html: String,
) -> Result<QrPreviewStart, String> {
    if files.is_empty() {
        return Err("At least one page image is required for a preview".to_string());
    }
    if files.len() > MAX_PREVIEW_FILES {
        return Err(format!(
            "Too many pages for a phone preview: {len} (max {MAX_PREVIEW_FILES})",
            len = files.len()
        ));
    }
    if index_html.len() > MAX_INDEX_HTML_BYTES {
        return Err("Preview page HTML is too large".to_string());
    }

    let mut served = BTreeMap::new();
    let mut total_bytes = 0u64;
    for file in &files {
        let (name, served_file) = decode_preview_file(file)?;
        if served.contains_key(&name) {
            return Err(format!("Duplicate preview page name: {name}"));
        }
        total_bytes += served_file.bytes.len() as u64;
        served.insert(name, served_file);
    }
    if total_bytes > MAX_PREVIEW_TOTAL_BYTES as u64 {
        return Err(format!(
            "Preview pages are too large: {total_bytes} bytes (max {MAX_PREVIEW_TOTAL_BYTES})"
        ));
    }

    let mut guard = SESSION
        .lock()
        .map_err(|_| "Preview session state is corrupted".to_string())?;
    // Replacing a session stops the previous one via Drop.
    *guard = None;
    let handle = spawn_session(served, index_html, PREVIEW_TTL)?;
    let page_count = handle.page_count;
    let (url, reachable) = preview_url(handle.lan_ip, handle.port, &handle.inner.token);
    // TEMP DIAGNOSTIC: expose the session URL in the dev log while tracking down
    // the blank page report. Remove once the investigation is closed.
    eprintln!("markcard qr preview: {url} pages={page_count} bytes={total_bytes}");
    let lan_ip = handle.lan_ip.map(|ip| ip.to_string());
    let expires_at = handle.expires_at_unix_millis;
    *guard = Some(handle);
    Ok(QrPreviewStart {
        url,
        reachable,
        lan_ip,
        expires_at,
        page_count,
        total_bytes,
    })
}

fn preview_url(lan_ip: Option<IpAddr>, port: u16, token: &str) -> (String, bool) {
    match lan_ip {
        Some(ip) => (format!("http://{ip}:{port}/{token}/"), true),
        None => (format!("http://127.0.0.1:{port}/{token}/"), false),
    }
}

fn spawn_session(
    files: BTreeMap<String, ServedFile>,
    index_html: String,
    ttl: Duration,
) -> Result<SessionHandle, String> {
    let page_count = files.len() as u32;
    let total_bytes = files
        .values()
        .map(|file| file.bytes.len() as u64)
        .sum::<u64>();

    let listener = TcpListener::bind(("0.0.0.0", 0))
        .map_err(|err| format!("Failed to open a preview port: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("Failed to read the preview port: {err}"))?
        .port();
    let lan_ip = detect_lan_ip();
    let token = generate_token();
    let expires_at = Instant::now() + ttl;
    let expires_at_unix_millis = SystemTime::now()
        .checked_add(ttl)
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|since_epoch| since_epoch.as_millis() as u64)
        .unwrap_or(0);

    let inner = Arc::new(SessionInner {
        token: token.clone(),
        index_html: Arc::new(index_html),
        files,
        listener: Arc::new(listener),
        shutdown: AtomicBool::new(false),
        stopped: AtomicBool::new(false),
        index_hits: AtomicU32::new(0),
        image_hits: AtomicU32::new(0),
        active: AtomicU32::new(0),
    });

    let accept_inner = Arc::clone(&inner);
    std::thread::Builder::new()
        .name("qr-preview-accept".to_string())
        .spawn(move || accept_loop(accept_inner, expires_at))
        .map_err(|err| format!("Failed to start the preview server: {err}"))?;

    Ok(SessionHandle {
        inner,
        lan_ip,
        port,
        expires_at,
        expires_at_unix_millis,
        page_count,
        total_bytes,
    })
}

fn accept_loop(inner: Arc<SessionInner>, expires_at: Instant) {
    let listener = Arc::clone(&inner.listener);
    let _ = listener.set_nonblocking(true);
    loop {
        if inner.shutdown.load(Ordering::Relaxed) || Instant::now() >= expires_at {
            break;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if inner.active.load(Ordering::Relaxed) >= MAX_CONCURRENT_CONNECTIONS {
                    // The phone only needs a few parallel image requests; drop the rest.
                    let _ = stream.shutdown(Shutdown::Both);
                    continue;
                }
                let connection_inner = Arc::clone(&inner);
                let _ = std::thread::Builder::new()
                    .name("qr-preview-connection".to_string())
                    .spawn(move || handle_connection(connection_inner, stream));
            }
            Err(err) if err.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(ACCEPT_TICK);
            }
            Err(_) => break,
        }
    }
    inner.stopped.store(true, Ordering::Relaxed);
}

fn handle_connection(inner: Arc<SessionInner>, stream: TcpStream) {
    inner.active.fetch_add(1, Ordering::Relaxed);
    // macOS hands the non-blocking flag of the listener down to accepted
    // sockets. Without this the page body stopped at the first full send buffer
    // (a few hundred kilobytes) and the phone kept a truncated image.
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let _ = stream.set_nodelay(true);
    let _ = serve(stream, &inner);
    inner.active.fetch_sub(1, Ordering::Relaxed);
}

fn serve(mut stream: TcpStream, inner: &SessionInner) -> std::io::Result<()> {
    let (method, path) = read_request_head(&mut stream)?.unwrap_or_default();
    match route(&method, &path, &inner.token) {
        RouteResult::Index => {
            inner.index_hits.fetch_add(1, Ordering::Relaxed);
            write_response(
                stream,
                200,
                "text/html; charset=utf-8",
                inner.index_html.as_bytes(),
            )
        }
        RouteResult::File(name) => {
            let file = inner.files.get(&name);
            if let Some(file) = file {
                inner.image_hits.fetch_add(1, Ordering::Relaxed);
                write_response(stream, 200, file.mime, &file.bytes)
            } else {
                write_response(stream, 404, "text/plain", b"preview page not found")
            }
        }
        RouteResult::NotFound => write_response(stream, 404, "text/plain", b"preview not found"),
        RouteResult::MethodNotAllowed => {
            write_response(stream, 405, "text/plain", b"method not allowed")
        }
    }
}

enum RouteResult {
    Index,
    File(String),
    NotFound,
    MethodNotAllowed,
}

fn route(method: &str, path: &str, token: &str) -> RouteResult {
    if method != "GET" {
        return RouteResult::MethodNotAllowed;
    }
    let remembered_token = format!("/{token}");
    if path == remembered_token || path == format!("{remembered_token}/") {
        return RouteResult::Index;
    }
    let token_prefix = format!("{remembered_token}/");
    match path.strip_prefix(&token_prefix) {
        Some(name) => {
            // Names are whitelisted ASCII; nothing that smuggles a path survives.
            if name.is_empty()
                || name.contains('/')
                || name.contains('\\')
                || name.contains('%')
                || name.contains("..")
            {
                RouteResult::NotFound
            } else {
                RouteResult::File(name.to_string())
            }
        }
        None => RouteResult::NotFound,
    }
}

fn read_request_head(stream: &mut TcpStream) -> std::io::Result<Option<(String, String)>> {
    let mut head = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Ok(None);
        }
        head.extend_from_slice(&chunk[..read]);
        if head.len() > REQUEST_HEAD_LIMIT {
            return Ok(None);
        }
        if let Some(position) = find_head_end(&head) {
            let head_text = String::from_utf8_lossy(&head[..position]);
            let first_line = head_text.lines().next().unwrap_or("");
            let mut parts = first_line.split_whitespace();
            let method = parts.next().unwrap_or("").to_string();
            // Browsers may append a query string; the preview route has none.
            let target = parts
                .next()
                .unwrap_or("")
                .split('?')
                .next()
                .unwrap_or("")
                .to_string();
            return Ok(Some((method, target)));
        }
    }
}

fn find_head_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn write_response(mut stream: TcpStream, status: u16, mime: &str, body: &[u8]) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len(),
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()?;
    // Closing both halves here sent a reset while the tail of the body was still
    // queued, so a phone on Wi-Fi kept only the first few hundred kilobytes of a
    // page whose Content-Length promised the whole image. Half-close instead, and
    // read until the peer hangs up so the send buffer is flushed before drop.
    let _ = stream.shutdown(Shutdown::Write);
    let _ = stream.set_read_timeout(Some(DRAIN_TIMEOUT));
    let mut sink = [0u8; 1024];
    while let Ok(read) = stream.read(&mut sink) {
        if read == 0 {
            break;
        }
    }
    Ok(())
}

fn decode_preview_file(file: &QrPreviewFileInput) -> Result<(String, ServedFile), String> {
    let name = file.name.trim();
    if !validate_file_name(name) {
        return Err("Invalid preview page name".to_string());
    }
    let (mime, bytes) = parse_data_url(&file.data_url)?;
    if bytes.len() > MAX_PREVIEW_FILE_BYTES {
        return Err("Preview page image is too large".to_string());
    }
    Ok((
        name.to_string(),
        ServedFile {
            mime,
            bytes: Arc::new(bytes),
        },
    ))
}

fn validate_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-' || byte == b'_'
        })
        && !name.starts_with('.')
}

fn parse_data_url(data_url: &str) -> Result<(&'static str, Vec<u8>), String> {
    let rest = data_url
        .strip_prefix("data:")
        .ok_or_else(|| "Preview pages must use data URLs".to_string())?;
    let (meta, encoded) = rest
        .split_once(',')
        .ok_or_else(|| "Invalid preview page data URL".to_string())?;
    let media_type = meta
        .strip_suffix(";base64")
        .ok_or_else(|| "Preview pages must be base64 data URLs".to_string())?;
    let mime = match media_type {
        "image/png" => "image/png",
        "image/jpeg" => "image/jpeg",
        "image/webp" => "image/webp",
        _ => return Err("Unsupported preview page image type".to_string()),
    };
    let bytes = general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|err| format!("Failed to decode preview page image: {err}"))?;
    Ok((mime, bytes))
}

fn detect_lan_ip() -> Option<IpAddr> {
    // A UDP connect only picks the routing table's egress interface; nothing is sent.
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect(("8.8.8.8", 80)).ok()?;
    socket.local_addr().ok().map(|addr| addr.ip())
}

fn generate_token() -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default()
        .hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    format!("m{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn served_file(bytes: &[u8]) -> ServedFile {
        ServedFile {
            mime: "image/png",
            bytes: Arc::new(bytes.to_vec()),
        }
    }

    #[test]
    fn validates_preview_file_names() {
        assert!(validate_file_name("01.png"));
        assert!(validate_file_name("cover-1_a.jpg"));
        assert!(!validate_file_name(""));
        assert!(!validate_file_name("../x.png"));
        assert!(!validate_file_name(".hidden.png"));
        assert!(!validate_file_name("a/b.png"));
        assert!(!validate_file_name(&"a".repeat(65)));
    }

    #[test]
    fn decodes_preview_data_urls() {
        let (media_type, bytes) = parse_data_url("data:image/png;base64,aGk=").unwrap();
        assert_eq!(media_type, "image/png");
        assert_eq!(bytes, b"hi");
        assert!(parse_data_url("data:text/html;base64,aGk=").is_err());
        assert!(parse_data_url("data:image/png,aGk=").is_err());
        assert!(parse_data_url("not-a-data-url").is_err());
    }

    #[test]
    fn routes_only_token_paths() {
        let token = "mtoken1234";
        assert!(matches!(route("GET", "/mtoken1234", token), RouteResult::Index));
        assert!(matches!(route("GET", "/mtoken1234/", token), RouteResult::Index));
        assert!(
            matches!(route("GET", "/mtoken1234/01.png", token), RouteResult::File(name) if name == "01.png")
        );
        assert!(matches!(route("GET", "/wrong/01.png", token), RouteResult::NotFound));
        assert!(matches!(route("GET", "/mtoken1234/01.png/..", token), RouteResult::NotFound));
        assert!(matches!(route("GET", "/mtoken1234/%2e%2e", token), RouteResult::NotFound));
        assert!(matches!(route("POST", "/mtoken1234/", token), RouteResult::MethodNotAllowed));
    }

    #[test]
    fn serves_pages_over_the_local_socket() {
        let mut files = BTreeMap::new();
        files.insert("01.png".to_string(), served_file(&[1, 2, 3, 4]));
        let handle = spawn_session(
            files,
            "<html><body>markcard</body></html>".to_string(),
            Duration::from_secs(30),
        )
        .unwrap();
        assert_eq!(handle.page_count, 1);
        assert_eq!(handle.total_bytes, 4);

        let reply = http_get(handle.port, &format!("/{}/", handle.inner.token));
        assert!((reply.0).starts_with("HTTP/1.1 200"));
        assert!(reply.0.contains("text/html"));
        assert_eq!(reply.1, b"<html><body>markcard</body></html>");

        let (head, body) = http_get(handle.port, &format!("/{}/01.png", handle.inner.token));
        assert!(head.starts_with("HTTP/1.1 200"));
        assert!(head.contains("image/png"));
        assert_eq!(body, vec![1, 2, 3, 4]);

        assert!(http_get(handle.port, "/mtoken-missing/01.png").0.starts_with("HTTP/1.1 404"));
        assert!(http_get(handle.port, "/").0.starts_with("HTTP/1.1 404"));

        assert!(!handle.inner.shutdown.load(Ordering::Relaxed));
        drop(handle);
    }

    #[test]
    fn serves_a_page_larger_than_one_socket_buffer() {
        // A scene page is ~1 MB; the response used to stop as soon as the send
        // buffer filled, and the phone showed a torn image for every page that
        // did not fit. This is the regression guard for that.
        let body: Vec<u8> = (0..1024 * 1024).map(|index| (index % 251) as u8).collect();
        let mut files = BTreeMap::new();
        files.insert("01.jpg".to_string(), served_file(&body));
        let handle = spawn_session(
            files,
            "<html></html>".to_string(),
            Duration::from_secs(30),
        )
        .unwrap();

        let (head, received) = http_get(handle.port, &format!("/{}/01.jpg", handle.inner.token));
        assert!(head.starts_with("HTTP/1.1 200"));
        assert!(head.contains(&format!("Content-Length: {}", body.len())));
        assert_eq!(received.len(), body.len());
        assert_eq!(received, body);
        drop(handle);
    }

    #[test]
    fn stops_after_the_ttl_elapses() {
        let mut files = BTreeMap::new();
        files.insert("01.png".to_string(), served_file(&[9]));
        let session = spawn_session(
            files,
            "<html></html>".to_string(),
            Duration::from_millis(30),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(250));
        assert!(session.inner.stopped.load(Ordering::Relaxed));
        session.inner.shutdown.store(true, Ordering::Relaxed);
    }

    fn http_get(port: u16, path: &str) -> (String, Vec<u8>) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(READ_TIMEOUT)).unwrap();
        let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
        let _ = stream.set_nodelay(true);
        stream
            .write_all(format!("GET {path} HTTP/1.0\r\nHost: test\r\n\r\n").as_bytes())
            .unwrap();
        let mut everything = Vec::new();
        let _ = stream.read_to_end(&mut everything);
        match find_head_end(&everything) {
            Some(split) => (
                String::from_utf8_lossy(&everything[..split]).to_string(),
                everything[split + 4..].to_vec(),
            ),
            None => (String::new(), everything),
        }
    }
}
