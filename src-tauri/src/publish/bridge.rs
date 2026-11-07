// Loopback-only reader for the bundle that was just generated. The companion
// Chrome fill extension fetches `manifest.json` and `images/*` from here, so
// opening the creator page is enough: no folder picker and no repeated
// directory grant.
//
// Boundaries, in the same spirit as `qr_preview.rs`: binds 127.0.0.1 only, GET
// only, serves exactly one bundle that must sit inside the app's managed
// publish root, everything sits behind a random path token, and the session
// stops itself after a bounded TTL. It never writes, never renders a card, and
// never exposes a path outside the bundle.

use std::{
    collections::BTreeMap,
    fs,
    hash::{Hash, Hasher},
    io::{ErrorKind, Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use super::bundle::publish_root_dir;

const BRIDGE_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CONCURRENT_CONNECTIONS: u32 = 16;
const REQUEST_HEAD_LIMIT: usize = 8 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const WRITE_TIMEOUT: Duration = Duration::from_secs(60);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
const ACCEPT_TICK: Duration = Duration::from_millis(100);
const GENERATOR: &str = "markcard-studio";

struct BridgeInner {
    token: String,
    manifest: Arc<String>,
    /// Bridge-relative file name (for example `01.jpg`) to an absolute path that
    /// was already canonicalized inside `<bundle>/images`.
    images: BTreeMap<String, PathBuf>,
    listener: Arc<TcpListener>,
    shutdown: AtomicBool,
    stopped: AtomicBool,
    manifest_hits: AtomicU32,
    image_hits: AtomicU32,
    active: AtomicU32,
}

struct BridgeHandle {
    inner: Arc<BridgeInner>,
    port: u16,
    expires_at: Instant,
    expires_at_unix_millis: u64,
    image_count: u32,
}

impl Drop for BridgeHandle {
    fn drop(&mut self) {
        // Wake the accept loop; its Arc keeps the listener alive until it exits,
        // so in-flight connection threads never touch a closed socket.
        self.inner.shutdown.store(true, Ordering::Relaxed);
    }
}

static BRIDGE: Mutex<Option<BridgeHandle>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishBridgeStart {
    /// Base URL including the token, for example `http://127.0.0.1:51234/m1a2b3`.
    url: String,
    expires_at: u64,
    image_count: u32,
    /// The bundle's channel id, so the caller never hands a WeChat bundle to the
    /// Xiaohongshu page by accident.
    channel_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishBridgeStatus {
    running: bool,
    url: Option<String>,
    expires_at: Option<u64>,
    image_count: u32,
    manifest_hits: u32,
    image_hits: u32,
}

#[tauri::command]
pub async fn publish_bridge_start(
    app: AppHandle,
    bundle_path: String,
) -> Result<PublishBridgeStart, String> {
    tauri::async_runtime::spawn_blocking(move || start_bridge(&app, &bundle_path))
        .await
        .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub fn publish_bridge_status() -> Result<PublishBridgeStatus, String> {
    let mut guard = BRIDGE
        .lock()
        .map_err(|_| "Publish bridge state is corrupted".to_string())?;
    if let Some(session) = guard.as_ref() {
        if Instant::now() < session.expires_at {
            return Ok(status_for(session, true));
        }
    }
    *guard = None;
    Ok(PublishBridgeStatus {
        running: false,
        url: None,
        expires_at: None,
        image_count: 0,
        manifest_hits: 0,
        image_hits: 0,
    })
}

#[tauri::command]
pub fn publish_bridge_stop() -> Result<(), String> {
    let mut guard = BRIDGE
        .lock()
        .map_err(|_| "Publish bridge state is corrupted".to_string())?;
    *guard = None;
    Ok(())
}

fn status_for(session: &BridgeHandle, running: bool) -> PublishBridgeStatus {
    PublishBridgeStatus {
        running,
        url: Some(bridge_url(session.port, &session.inner.token)),
        expires_at: Some(session.expires_at_unix_millis),
        image_count: session.image_count,
        manifest_hits: session.inner.manifest_hits.load(Ordering::Relaxed),
        image_hits: session.inner.image_hits.load(Ordering::Relaxed),
    }
}

fn bridge_url(port: u16, token: &str) -> String {
    format!("http://127.0.0.1:{port}/{token}")
}

fn start_bridge(app: &AppHandle, bundle_path: &str) -> Result<PublishBridgeStart, String> {
    let raw = bundle_path.trim();
    if raw.is_empty() {
        return Err("A publish bundle path is required".to_string());
    }

    let root = publish_root_dir(app)?;
    let root_real = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve the publish root: {err}"))?;
    let bundle_real = PathBuf::from(raw)
        .canonicalize()
        .map_err(|err| format!("Failed to resolve the publish bundle: {err}"))?;
    if !bundle_real.is_dir() {
        return Err("The publish bundle is not a directory".to_string());
    }
    // Only bundles the app itself wrote may be served, so a crafted path cannot
    // turn the bridge into a reader for an arbitrary folder.
    if !bundle_real.starts_with(&root_real) {
        return Err("The publish bundle is outside the app's publish folder".to_string());
    }

    let manifest = fs::read_to_string(bundle_real.join("manifest.json"))
        .map_err(|err| format!("Failed to read the publish manifest: {err}"))?;
    let parsed: Value = serde_json::from_str(&manifest)
        .map_err(|err| format!("The publish manifest is not valid JSON: {err}"))?;
    if parsed.get("generator").and_then(Value::as_str) != Some(GENERATOR) {
        return Err("The folder is not a MarkCard Studio publish bundle".to_string());
    }

    let channel_id = parsed
        .get("channel")
        .and_then(|channel| channel.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let images = collect_bundle_images(&bundle_real, &parsed)?;
    if images.is_empty() {
        return Err("The publish bundle has no images to serve".to_string());
    }

    let handle = spawn_bridge(manifest, images, BRIDGE_TTL)?;
    let mut guard = BRIDGE
        .lock()
        .map_err(|_| "Publish bridge state is corrupted".to_string())?;
    // Replacing a session stops the previous one via Drop.
    *guard = None;
    let start = PublishBridgeStart {
        url: bridge_url(handle.port, &handle.inner.token),
        expires_at: handle.expires_at_unix_millis,
        image_count: handle.image_count,
        channel_id,
    };
    *guard = Some(handle);
    Ok(start)
}

fn collect_bundle_images(
    bundle: &Path,
    manifest: &Value,
) -> Result<BTreeMap<String, PathBuf>, String> {
    let images_dir = bundle.join("images");
    let images_dir_real = images_dir
        .canonicalize()
        .map_err(|err| format!("Failed to resolve the bundle images folder: {err}"))?;

    let mut images = BTreeMap::new();
    let list = manifest
        .get("images")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for entry in list {
        let Some(file) = entry.get("file").and_then(Value::as_str) else {
            continue;
        };
        let Some(name) = file.strip_prefix("images/") else {
            return Err(format!("Unsupported bundle image path: {file}"));
        };
        if !is_safe_image_name(name) {
            return Err(format!("Unsupported bundle image name: {file}"));
        }
        let path = images_dir_real.join(name);
        let path = path
            .canonicalize()
            .map_err(|err| format!("Failed to resolve bundle image {name}: {err}"))?;
        if !path.starts_with(&images_dir_real) {
            return Err(format!("Bundle image escapes the images folder: {name}"));
        }
        if path.metadata().map(|meta| meta.len() > MAX_IMAGE_BYTES).unwrap_or(true) {
            return Err(format!("Bundle image is too large to serve: {name}"));
        }
        images.insert(name.to_string(), path);
    }
    Ok(images)
}

fn spawn_bridge(
    manifest: String,
    images: BTreeMap<String, PathBuf>,
    ttl: Duration,
) -> Result<BridgeHandle, String> {
    let image_count = images.len() as u32;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|err| format!("Failed to open a bridge port: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("Failed to read the bridge port: {err}"))?
        .port();
    let token = generate_token();
    let expires_at = Instant::now() + ttl;
    let expires_at_unix_millis = SystemTime::now()
        .checked_add(ttl)
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|since_epoch| since_epoch.as_millis() as u64)
        .unwrap_or(0);

    let inner = Arc::new(BridgeInner {
        token,
        manifest: Arc::new(manifest),
        images,
        listener: Arc::new(listener),
        shutdown: AtomicBool::new(false),
        stopped: AtomicBool::new(false),
        manifest_hits: AtomicU32::new(0),
        image_hits: AtomicU32::new(0),
        active: AtomicU32::new(0),
    });

    let accept_inner = Arc::clone(&inner);
    std::thread::Builder::new()
        .name("publish-bridge-accept".to_string())
        .spawn(move || accept_loop(accept_inner, expires_at))
        .map_err(|err| format!("Failed to start the publish bridge: {err}"))?;

    Ok(BridgeHandle {
        inner,
        port,
        expires_at,
        expires_at_unix_millis,
        image_count,
    })
}

fn accept_loop(inner: Arc<BridgeInner>, expires_at: Instant) {
    let listener = Arc::clone(&inner.listener);
    let _ = listener.set_nonblocking(true);
    loop {
        if inner.shutdown.load(Ordering::Relaxed) || Instant::now() >= expires_at {
            break;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if inner.active.load(Ordering::Relaxed) >= MAX_CONCURRENT_CONNECTIONS {
                    let _ = stream.shutdown(Shutdown::Both);
                    continue;
                }
                let connection_inner = Arc::clone(&inner);
                let _ = std::thread::Builder::new()
                    .name("publish-bridge-connection".to_string())
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

fn handle_connection(inner: Arc<BridgeInner>, stream: TcpStream) {
    inner.active.fetch_add(1, Ordering::Relaxed);
    // macOS hands the listener's non-blocking flag to accepted sockets.
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let _ = stream.set_nodelay(true);
    let _ = serve(stream, &inner);
    inner.active.fetch_sub(1, Ordering::Relaxed);
}

fn serve(mut stream: TcpStream, inner: &BridgeInner) -> std::io::Result<()> {
    let (method, path) = read_request_head(&mut stream)?.unwrap_or_default();
    match route(&method, &path, &inner.token) {
        Route::Manifest => {
            inner.manifest_hits.fetch_add(1, Ordering::Relaxed);
            write_response(
                stream,
                200,
                "application/json; charset=utf-8",
                inner.manifest.as_bytes(),
            )
        }
        Route::Health => {
            let body = format!(
                "{{\"ok\":true,\"generator\":\"{GENERATOR}\",\"images\":{}}}",
                inner.images.len()
            );
            write_response(stream, 200, "application/json; charset=utf-8", body.as_bytes())
        }
        Route::Image(name) => match inner.images.get(&name) {
            Some(path) => match fs::read(path) {
                Ok(bytes) => {
                    inner.image_hits.fetch_add(1, Ordering::Relaxed);
                    write_response(stream, 200, image_mime(&name), &bytes)
                }
                Err(_) => write_response(stream, 404, "text/plain", b"image not readable"),
            },
            None => write_response(stream, 404, "text/plain", b"image not found"),
        },
        Route::Preflight => write_response(stream, 204, "text/plain", b""),
        Route::NotFound => write_response(stream, 404, "text/plain", b"bridge not found"),
        Route::MethodNotAllowed => {
            write_response(stream, 405, "text/plain", b"method not allowed")
        }
    }
}

enum Route {
    Manifest,
    Health,
    Image(String),
    Preflight,
    NotFound,
    MethodNotAllowed,
}

fn route(method: &str, path: &str, token: &str) -> Route {
    if method == "OPTIONS" {
        return Route::Preflight;
    }
    if method != "GET" {
        return Route::MethodNotAllowed;
    }
    let prefix = format!("/{token}");
    let Some(rest) = path.strip_prefix(&prefix) else {
        return Route::NotFound;
    };
    match rest {
        "" | "/health" => Route::Health,
        "/manifest.json" => Route::Manifest,
        _ => match rest.strip_prefix("/images/") {
            Some(name) if is_safe_image_name(name) => Route::Image(name.to_string()),
            _ => Route::NotFound,
        },
    }
}

fn is_safe_image_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 128 || name.starts_with('.') || name.contains("..") {
        return false;
    }
    let allowed = name
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'));
    if !allowed {
        return false;
    }
    matches!(
        Path::new(name)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("jpg") | Some("jpeg") | Some("png")
    )
}

fn image_mime(name: &str) -> &'static str {
    match Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        _ => "image/jpeg",
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
        204 => "No Content",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    // The extension fetches from its own origin; with the token in the path a
    // permissive CORS header adds no reachability, only fewer surprises when a
    // host permission is missing.
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\n\r\n",
        body.len(),
    );
    stream.write_all(head.as_bytes())?;
    if !body.is_empty() {
        stream.write_all(body)?;
    }
    stream.flush()?;
    // Half-close and drain: closing both halves while the body is still queued
    // truncates large images.
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

    fn temp_bundle(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "markcard-bridge-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(path.join("images")).expect("create temp bundle");
        path
    }

    fn seed_bundle(root: &Path) -> (String, BTreeMap<String, PathBuf>) {
        fs::write(root.join("images/01.jpg"), [1u8, 2, 3, 4]).unwrap();
        let manifest = format!(
            "{{\"generator\":\"{GENERATOR}\",\"images\":[{{\"file\":\"images/01.jpg\"}}]}}"
        );
        fs::write(root.join("manifest.json"), &manifest).unwrap();
        let parsed: Value = serde_json::from_str(&manifest).unwrap();
        let images = collect_bundle_images(root, &parsed).unwrap();
        (manifest, images)
    }

    #[test]
    fn validates_bridge_image_names() {
        assert!(is_safe_image_name("01.jpg"));
        assert!(is_safe_image_name("cover-1_a.PNG"));
        assert!(!is_safe_image_name(""));
        assert!(!is_safe_image_name("../x.jpg"));
        assert!(!is_safe_image_name(".hidden.jpg"));
        assert!(!is_safe_image_name("a/b.jpg"));
        assert!(!is_safe_image_name("payload.exe"));
        assert!(!is_safe_image_name(&"a".repeat(129)));
    }

    #[test]
    fn routes_only_token_paths() {
        let token = "mtoken1234";
        assert!(matches!(route("GET", "/mtoken1234", token), Route::Health));
        assert!(matches!(route("GET", "/mtoken1234/manifest.json", token), Route::Manifest));
        assert!(matches!(
            route("GET", "/mtoken1234/images/01.jpg", token),
            Route::Image(name) if name == "01.jpg"
        ));
        assert!(matches!(route("GET", "/wrong/manifest.json", token), Route::NotFound));
        assert!(matches!(route("GET", "/mtoken1234/images/../manifest.json", token), Route::NotFound));
        assert!(matches!(route("POST", "/mtoken1234/manifest.json", token), Route::MethodNotAllowed));
        assert!(matches!(route("OPTIONS", "/mtoken1234/manifest.json", token), Route::Preflight));
    }

    #[test]
    fn collects_only_bundle_relative_images() {
        let root = temp_bundle("collect");
        let (_, images) = seed_bundle(&root);
        assert!(images.contains_key("01.jpg"));

        let outside = serde_json::json!({ "images": [{ "file": "../escape.jpg" }] });
        assert!(collect_bundle_images(&root, &outside).is_err());

        let nested = serde_json::json!({ "images": [{ "file": "images/sub/01.jpg" }] });
        assert!(collect_bundle_images(&root, &nested).is_err());

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn serves_manifest_and_images_over_loopback() {
        let root = temp_bundle("serve");
        let (manifest, images) = seed_bundle(&root);
        let handle = spawn_bridge(manifest, images, Duration::from_secs(30)).unwrap();
        assert_eq!(handle.image_count, 1);

        let (head, body) = http_get(handle.port, &format!("/{}/manifest.json", handle.inner.token));
        assert!(head.starts_with("HTTP/1.1 200"));
        assert!(head.contains("application/json"));
        assert!(String::from_utf8_lossy(&body).contains("markcard-studio"));

        let (head, body) = http_get(
            handle.port,
            &format!("/{}/images/01.jpg", handle.inner.token),
        );
        assert!(head.starts_with("HTTP/1.1 200"));
        assert!(head.contains("image/jpeg"));
        assert_eq!(body, vec![1, 2, 3, 4]);

        let (head, _) = http_get(handle.port, "/mtoken-missing/manifest.json");
        assert!(head.starts_with("HTTP/1.1 404"));

        drop(handle);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn stops_after_the_ttl_elapses() {
        let root = temp_bundle("ttl");
        let (manifest, images) = seed_bundle(&root);
        let session = spawn_bridge(manifest, images, Duration::from_millis(30)).unwrap();
        std::thread::sleep(Duration::from_millis(250));
        assert!(session.inner.stopped.load(Ordering::Relaxed));
        session.inner.shutdown.store(true, Ordering::Relaxed);
        fs::remove_dir_all(&root).unwrap();
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
