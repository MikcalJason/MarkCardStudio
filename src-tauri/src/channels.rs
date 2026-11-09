use std::net::IpAddr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use keyring::Entry;
use serde::Serialize;
use serde_json::Value;

const KEYCHAIN_SERVICE: &str = "studio.markcard.channel";
const WECHAT_CHANNEL: &str = "wechat";
const WECHAT_TOKEN_URL: &str = "https://api.weixin.qq.com/cgi-bin/stable_token";
const PUBLIC_IP_ENDPOINTS: [&str; 3] = [
    // Reachable from mainland carriers and already returns the exact egress IP
    // WeChat reports; the global services are only fallbacks.
    "https://myip.ipip.net",
    "https://api.ipify.org?format=json",
    "https://4.ipw.cn",
];
const WECHAT_API_BASE: &str = "https://api.weixin.qq.com/cgi-bin";
const MAX_PROBE_MESSAGE_CHARS: usize = 120;
const REQUEST_TIMEOUT_SECS: u64 = 15;
const PROXY_FIELD: &str = "proxy";
const MAX_PROXY_URL_CHARS: usize = 300;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCredentialsStatus {
    channel: String,
    configured: bool,
    app_id_masked: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTestResult {
    ok: bool,
    expires_in: u64,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicIpResult {
    ip: String,
}

/// The proxy address never comes back with its userinfo: it can carry the login
/// for the user's own relay box.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelProxyStatus {
    channel: String,
    configured: bool,
    url_masked: String,
}

/// One read-only permission check. WeChat grants interfaces by account subject
/// and verification status, so a working access_token says nothing about these.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPermissionItem {
    key: String,
    status: String,
    errcode: i64,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPermissionProbe {
    items: Vec<ChannelPermissionItem>,
}

struct ProbeSpec {
    key: &'static str,
    path: &'static str,
    body: Option<Value>,
}

pub(crate) fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
    let day_of_era = (shifted - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 { month_prime + 3 } else { month_prime - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// The analytics endpoints need a calendar date and reject future or malformed
/// ones before checking permissions, so probes ask for yesterday (T+1 data).
fn yesterday_utc_date() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    let (year, month, day) = civil_from_days(seconds / 86_400 - 1);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Read-only endpoints only: every one of these is a query, never a write.
fn permission_probes() -> Vec<ProbeSpec> {
    let analytics_query = serde_json::json!({
        "begin_date": yesterday_utc_date(),
        "end_date": yesterday_utc_date(),
    });
    vec![
        ProbeSpec {
            key: "domainIp",
            path: "get_api_domain_ip",
            body: None,
        },
        ProbeSpec {
            key: "menu",
            path: "menu/get",
            body: None,
        },
        ProbeSpec {
            key: "material",
            path: "material/get_materialcount",
            body: Some(Value::Object(serde_json::Map::new())),
        },
        ProbeSpec {
            key: "draft",
            path: "draft/count",
            body: Some(Value::Object(serde_json::Map::new())),
        },
        ProbeSpec {
            key: "freepublish",
            path: "freepublish/batchget",
            body: Some(serde_json::json!({ "offset": 0, "count": 1 })),
        },
        ProbeSpec {
            key: "articleStats",
            path: "datacube/getarticlesummary",
            body: Some(analytics_query.clone()),
        },
        ProbeSpec {
            key: "articleTotal",
            path: "datacube/getarticletotal",
            body: Some(analytics_query.clone()),
        },
        ProbeSpec {
            key: "articleRead",
            path: "datacube/getuserread",
            body: Some(analytics_query.clone()),
        },
        ProbeSpec {
            key: "articleShare",
            path: "datacube/getusershare",
            body: Some(analytics_query.clone()),
        },
        ProbeSpec {
            key: "userStats",
            path: "datacube/getusersummary",
            body: Some(analytics_query.clone()),
        },
        ProbeSpec {
            key: "userCumulate",
            path: "datacube/getusercumulate",
            body: Some(analytics_query.clone()),
        },
        ProbeSpec {
            key: "messageStats",
            path: "datacube/getupstreammsg",
            body: Some(analytics_query.clone()),
        },
        ProbeSpec {
            key: "interfaceSummary",
            path: "datacube/getinterfacesummary",
            body: Some(analytics_query),
        },
        ProbeSpec {
            key: "userList",
            path: "user/get",
            body: None,
        },
    ]
}

pub(crate) fn validate_channel(channel: &str) -> Result<(), String> {
    if channel == WECHAT_CHANNEL {
        Ok(())
    } else {
        Err(format!("Unsupported channel: {channel}"))
    }
}

fn validate_app_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.len() < 6 || trimmed.len() > 64 || trimmed.chars().any(char::is_whitespace) {
        return Err("AppID is missing or malformed".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_app_secret(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.len() < 8 || trimmed.len() > 128 || trimmed.chars().any(char::is_whitespace) {
        return Err("AppSecret is missing or malformed".to_string());
    }
    Ok(trimmed.to_string())
}

fn entry(channel: &str, field: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, &format!("{channel}:{field}"))
        .map_err(|err| format!("Keychain unavailable: {err}"))
}

/// AppID is shown back to the user so they can confirm which account is linked,
/// but only in masked form; the AppSecret is never read back into the UI.
fn mask_app_id(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.is_empty() {
        return String::new();
    }
    if chars.len() <= 6 {
        return "*".repeat(chars.len());
    }
    let head: String = chars.iter().take(4).collect();
    let tail: String = chars[chars.len() - 2..].iter().collect();
    format!("{head}****{tail}")
}

pub(crate) fn read_credentials(channel: &str) -> Result<(Option<String>, Option<String>), String> {
    let app_id = entry(channel, "appId")?.get_password().ok();
    let app_secret = entry(channel, "appSecret")?.get_password().ok();
    Ok((app_id, app_secret))
}

fn status_for(channel: &str) -> Result<ChannelCredentialsStatus, String> {
    let (app_id, app_secret) = read_credentials(channel)?;
    let configured = app_id.is_some() && app_secret.is_some();
    Ok(ChannelCredentialsStatus {
        channel: channel.to_string(),
        configured,
        app_id_masked: mask_app_id(app_id.as_deref().unwrap_or("")),
    })
}

/// Parses a WeChat stable-token response without ever echoing the token itself.
fn classify_token_response(body: &Value) -> ChannelTestResult {
    if body.get("access_token").and_then(Value::as_str).is_some() {
        return ChannelTestResult {
            ok: true,
            expires_in: body.get("expires_in").and_then(Value::as_u64).unwrap_or(0),
            message: "OK".to_string(),
        };
    }
    let errcode = body.get("errcode").and_then(Value::as_i64).unwrap_or(0);
    let errmsg = body
        .get("errmsg")
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    ChannelTestResult {
        ok: false,
        expires_in: 0,
        message: format!("{errcode}: {errmsg}"),
    }
}

fn classify_probe_errcode(errcode: i64) -> &'static str {
    match errcode {
        0 => "allowed",
        48001 => "unauthorized",
        40164 => "blockedIp",
        40001 | 41001 | 42001 => "invalidCredentials",
        -1 => "busy",
        _ => "unknown",
    }
}

/// WeChat echoes parts of the request into some error messages, so the token is
/// stripped and the text is bounded before it can reach the webview.
pub(crate) fn sanitize_error_message(raw: &str, token: &str) -> String {
    let without_token = if token.is_empty() {
        raw.to_string()
    } else {
        raw.replace(token, "***")
    };
    let collapsed = without_token.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX_PROBE_MESSAGE_CHARS {
        return collapsed;
    }
    let kept: String = collapsed.chars().take(MAX_PROBE_MESSAGE_CHARS).collect();
    format!("{kept}…")
}

/// The proxy address is a credential too (it may carry the relay's login), so it
/// lives in the same keychain. Reading the keychain can make the OS prompt, so
/// the value is resolved once per process and invalidated on every write.
#[derive(Default)]
struct ProxyCache {
    loaded: bool,
    url: Option<String>,
}

fn proxy_cache() -> &'static Mutex<ProxyCache> {
    static CACHE: OnceLock<Mutex<ProxyCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(ProxyCache::default()))
}

fn invalidate_proxy() {
    if let Ok(mut guard) = proxy_cache().lock() {
        guard.loaded = false;
        guard.url = None;
    }
}

/// A bare `host:port` is read as an HTTP proxy, which is what `gost -L :8080`
/// exposes, so pasting the server address without a scheme still works.
fn normalize_proxy_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Proxy address is empty".to_string());
    }
    if trimmed.chars().count() > MAX_PROXY_URL_CHARS || trimmed.chars().any(char::is_whitespace) {
        return Err("Proxy address is malformed".to_string());
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let parsed =
        reqwest::Url::parse(&candidate).map_err(|_| "Proxy address is not a valid URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "socks5" | "socks5h") {
        return Err("Proxy must use http, https, socks5 or socks5h".to_string());
    }
    if parsed.host_str().unwrap_or("").is_empty() {
        return Err("Proxy address has no host".to_string());
    }
    if !matches!(parsed.path(), "" | "/") || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Proxy address must not contain a path, query or fragment".to_string());
    }
    Ok(parsed.to_string())
}

/// Keeps the scheme, host and port so the user can confirm which relay box is
/// active, and replaces any username or password with a mask.
fn readable_proxy_url(value: &str) -> String {
    let Ok(parsed) = reqwest::Url::parse(value) else {
        return String::new();
    };
    let host = parsed.host_str().unwrap_or_default();
    let port = parsed.port().map(|port| format!(":{port}")).unwrap_or_default();
    let credentials = if parsed.username().is_empty() && parsed.password().is_none() {
        ""
    } else {
        "***@"
    };
    format!("{}://{credentials}{host}{port}", parsed.scheme())
}

pub(crate) fn proxy_url() -> Result<Option<String>, String> {
    if let Ok(guard) = proxy_cache().lock() {
        if guard.loaded {
            return Ok(guard.url.clone());
        }
    }
    let url = entry(WECHAT_CHANNEL, PROXY_FIELD)?
        .get_password()
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Ok(mut guard) = proxy_cache().lock() {
        guard.loaded = true;
        guard.url = url.clone();
    }
    Ok(url)
}

/// Keychain reads can make the OS prompt, so the first resolve happens off the
/// async runtime; every later `proxy_url()` call is a plain memory read.
pub(crate) async fn prepare_proxy() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(proxy_url)
        .await
        .map_err(|err| format!("Task execution failed: {err}"))??;
    Ok(())
}

fn proxy_status_for(channel: &str) -> Result<ChannelProxyStatus, String> {
    let url = proxy_url()?;
    Ok(ChannelProxyStatus {
        channel: channel.to_string(),
        configured: url.is_some(),
        url_masked: url.as_deref().map(readable_proxy_url).unwrap_or_default(),
    })
}

/// Every WeChat call is built here so a configured relay proxy is always used:
/// the token, the material upload, the draft call and the probes must all leave
/// through the same egress IP that the account whitelisted.
pub(crate) fn client_with_timeout(seconds: u64) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(seconds));
    if let Some(url) = proxy_url()? {
        // The URL was validated on save; the message stays generic because a
        // reqwest error can echo the address, which may contain a password.
        let proxy = reqwest::Proxy::all(&url)
            .map_err(|_| "The saved proxy address cannot be used".to_string())?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|err| format!("Failed to create HTTP client: {err}"))
}

pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    client_with_timeout(REQUEST_TIMEOUT_SECS)
}

/// Reading the keychain can make macOS ask for the login password, and a rebuild
/// makes the OS forget "Always allow". The token therefore lives in memory for
/// its lifetime so a push does not read the keychain again until it expires.
struct CachedToken {
    token: String,
    expires_at: Instant,
}

fn token_cache() -> &'static Mutex<Option<CachedToken>> {
    static CACHE: OnceLock<Mutex<Option<CachedToken>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn invalidate_access_token() {
    if let Ok(mut guard) = token_cache().lock() {
        *guard = None;
    }
}

/// WeChat tokens last 7200s; renewing five minutes early avoids races.
fn token_ttl(expires_in: u64) -> Duration {
    Duration::from_secs(expires_in.saturating_sub(300).max(60))
}

pub(crate) async fn wechat_access_token(app_id: &str, app_secret: &str) -> Result<String, String> {
    if let Ok(guard) = token_cache().lock() {
        if let Some(cached) = guard.as_ref() {
            if cached.expires_at > Instant::now() {
                return Ok(cached.token.clone());
            }
        }
    }

    prepare_proxy().await?;
    let client = http_client()?;
    let response = client
        .post(WECHAT_TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "client_credential",
            "appid": app_id,
            "secret": app_secret,
            "force_refresh": false,
        }))
        .send()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;

    let body: Value = response
        .json()
        .await
        .map_err(|err| format!("Unexpected response: {err}"))?;
    let Some(token) = body.get("access_token").and_then(Value::as_str) else {
        return Err(classify_token_response(&body).message);
    };
    let expires_in = body.get("expires_in").and_then(Value::as_u64).unwrap_or(7_200);
    if let Ok(mut guard) = token_cache().lock() {
        *guard = Some(CachedToken {
            token: token.to_string(),
            expires_at: Instant::now() + token_ttl(expires_in),
        });
    }
    Ok(token.to_string())
}

fn read_probe_payload(text: &str, token: &str) -> ChannelPermissionItemFields {
    match serde_json::from_str::<Value>(text) {
        Ok(body) => {
            let errcode = body.get("errcode").and_then(Value::as_i64).unwrap_or(0);
            let status = classify_probe_errcode(errcode).to_string();
            let message = body
                .get("errmsg")
                .and_then(Value::as_str)
                .map(|errmsg| sanitize_error_message(errmsg, token))
                .unwrap_or_else(|| status.clone());
            ChannelPermissionItemFields {
                status,
                errcode,
                message,
            }
        }
        Err(_) => ChannelPermissionItemFields {
            status: "unknown".to_string(),
            errcode: 0,
            message: sanitize_error_message(text, token),
        },
    }
}

struct ChannelPermissionItemFields {
    status: String,
    errcode: i64,
    message: String,
}

#[tauri::command]
pub async fn set_channel_credentials(
    channel: String,
    app_id: String,
    app_secret: String,
) -> Result<ChannelCredentialsStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_channel(&channel)?;
        let app_id = validate_app_id(&app_id)?;
        let app_secret = validate_app_secret(&app_secret)?;
        entry(&channel, "appId")?
            .set_password(&app_id)
            .map_err(|err| format!("Failed to store AppID: {err}"))?;
        entry(&channel, "appSecret")?
            .set_password(&app_secret)
            .map_err(|err| format!("Failed to store AppSecret: {err}"))?;
        invalidate_access_token();
        status_for(&channel)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn channel_credentials_status(channel: String) -> Result<ChannelCredentialsStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_channel(&channel)?;
        status_for(&channel)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn clear_channel_credentials(channel: String) -> Result<ChannelCredentialsStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_channel(&channel)?;
        // ipWhitelist is only deleted so installs from older builds stop carrying it.
        for field in ["appId", "appSecret", "ipWhitelist"] {
            let _ = entry(&channel, field)?.delete_credential();
        }
        invalidate_access_token();
        status_for(&channel)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

/// Stores the relay proxy the WeChat API leaves through. The AppSecret stays on
/// this machine: the proxy is only a network hop, never a secret holder.
#[tauri::command]
pub async fn set_channel_proxy(
    channel: String,
    url: String,
) -> Result<ChannelProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_channel(&channel)?;
        let url = normalize_proxy_url(&url)?;
        entry(&channel, PROXY_FIELD)?
            .set_password(&url)
            .map_err(|err| format!("Failed to store proxy: {err}"))?;
        invalidate_proxy();
        // The next call must be routed through the new proxy, not a token that
        // may have been obtained from another egress IP.
        invalidate_access_token();
        proxy_status_for(&channel)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn channel_proxy_status(channel: String) -> Result<ChannelProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_channel(&channel)?;
        proxy_status_for(&channel)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn clear_channel_proxy(channel: String) -> Result<ChannelProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_channel(&channel)?;
        let _ = entry(&channel, PROXY_FIELD)?.delete_credential();
        invalidate_proxy();
        invalidate_access_token();
        proxy_status_for(&channel)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

/// Accepts both JSON responses and the plain-text bodies Chinese echo services
/// return (e.g. `当前 IP：1.2.3.4 来自于：…`).
fn extract_ip(text: &str) -> Option<String> {
    if let Ok(value) = serde_json::from_str::<Value>(text.trim()) {
        if let Some(ip) = value.get("ip").and_then(Value::as_str) {
            let trimmed = ip.trim();
            if trimmed.parse::<IpAddr>().is_ok() {
                return Some(trimmed.to_string());
            }
        }
    }
    text.split(|character: char| !(character.is_ascii_digit() || character == '.'))
        .find(|token| token.parse::<IpAddr>().is_ok())
        .map(str::to_string)
}

/// The WebView can route through a different proxy or VPN than reqwest, which is
/// why this lookup runs in Rust: it must report the same egress IP that WeChat
/// sees for the API calls. It therefore uses the configured relay proxy too, so
/// an enabled relay shows the relay's address — the one to whitelist.
#[tauri::command]
pub async fn fetch_public_ip() -> Result<PublicIpResult, String> {
    // ipify is unreachable from some mainland networks, so several plain-text
    // echo services are tried in order; each is a read-only GET of our own IP.
    prepare_proxy().await?;
    let client = client_with_timeout(6)?;
    let mut last_error = "No IP lookup endpoint responded".to_string();
    for endpoint in PUBLIC_IP_ENDPOINTS {
        match client.get(endpoint).send().await {
            Ok(response) => {
                if !response.status().is_success() {
                    last_error = format!("{endpoint} returned HTTP {}", response.status());
                    continue;
                }
                let Ok(text) = response.text().await else {
                    last_error = format!("{endpoint} returned an unreadable body");
                    continue;
                };
                if let Some(ip) = extract_ip(&text) {
                    return Ok(PublicIpResult { ip });
                }
                last_error = format!("{endpoint} returned no IP address");
            }
            Err(err) => last_error = format!("{endpoint}: {err}"),
        }
    }
    Err(last_error)
}

#[tauri::command]
pub async fn test_channel_credentials(channel: String) -> Result<ChannelTestResult, String> {
    let channel_for_read = channel.clone();
    let (app_id, app_secret) = tauri::async_runtime::spawn_blocking(move || {
        validate_channel(&channel_for_read)?;
        read_credentials(&channel_for_read)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))??;

    let (Some(app_id), Some(app_secret)) = (app_id, app_secret) else {
        return Err("Credentials are not configured yet".to_string());
    };

    prepare_proxy().await?;
    let client = http_client()?;
    let response = client
        .post(WECHAT_TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "client_credential",
            "appid": app_id,
            "secret": app_secret,
            "force_refresh": false,
        }))
        .send()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;

    let body: Value = response
        .json()
        .await
        .map_err(|err| format!("Unexpected response: {err}"))?;
    Ok(classify_token_response(&body))
}

/// Runs the read-only permission probes and reports only per-interface verdicts.
/// The access token is used in-Rust and is never part of the returned payload.
#[tauri::command]
pub async fn probe_channel_permissions(channel: String) -> Result<ChannelPermissionProbe, String> {
    let channel_for_read = channel.clone();
    let (app_id, app_secret) = tauri::async_runtime::spawn_blocking(move || {
        validate_channel(&channel_for_read)?;
        read_credentials(&channel_for_read)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))??;

    let (Some(app_id), Some(app_secret)) = (app_id, app_secret) else {
        return Err("Credentials are not configured yet".to_string());
    };

    let token = wechat_access_token(&app_id, &app_secret).await?;
    prepare_proxy().await?;
    let client = http_client()?;
    let mut items = Vec::new();
    for spec in permission_probes() {
        let url = format!("{WECHAT_API_BASE}/{}", spec.path);
        // reqwest's `query` helper is a cargo feature this app does not enable,
        // so the token is attached through Url, which also percent-encodes it.
        let endpoint = reqwest::Url::parse_with_params(&url, &[("access_token", token.as_str())])
            .map_err(|err| format!("Failed to build request URL: {err}"))?;
        let request = match spec.body {
            Some(body) => client.post(endpoint).json(&body),
            None => client.get(endpoint),
        };
        let response = request
            .send()
            .await
            .map_err(|err| format!("Request failed: {err}"))?;
        let text = response
            .text()
            .await
            .map_err(|err| format!("Unexpected response: {err}"))?;
        let fields = read_probe_payload(&text, &token);
        items.push(ChannelPermissionItem {
            key: spec.key.to_string(),
            status: fields.status,
            errcode: fields.errcode,
            message: fields.message,
        });
    }
    Ok(ChannelPermissionProbe { items })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_channel_names_and_lengths() {
        assert!(validate_channel("wechat").is_ok());
        assert!(validate_channel("xhs").is_err());
        assert!(validate_app_id("wx1234567890abcdef").is_ok());
        assert!(validate_app_id("short").is_err());
        assert!(validate_app_id("wx 12345678").is_err());
        assert!(validate_app_secret("0123456789abcdef0123456789abcdef").is_ok());
        assert!(validate_app_secret("short").is_err());
    }

    #[test]
    fn masks_app_ids_without_leaking_middle_characters() {
        assert_eq!(mask_app_id("wx1234567890abcdef"), "wx12****ef");
        assert_eq!(mask_app_id(""), "");
        assert_eq!(mask_app_id("abc"), "***");
    }

    #[test]
    fn extracts_ips_from_json_and_plain_text() {
        assert_eq!(
            extract_ip(r#"{"ip":"203.0.113.24"}"#).as_deref(),
            Some("203.0.113.24")
        );
        assert_eq!(extract_ip("203.0.113.24\n").as_deref(), Some("203.0.113.24"));
        assert_eq!(
            extract_ip("当前 IP：1.2.3.4  来自于：中国 北京 移动").as_deref(),
            Some("1.2.3.4")
        );
        assert_eq!(extract_ip("<html>blocked</html>"), None);
        assert_eq!(extract_ip("999.1.1.1"), None);
    }

    #[test]
    fn normalizes_relay_proxy_addresses() {
        assert_eq!(
            normalize_proxy_url("1.2.3.4:8080").as_deref(),
            Ok("http://1.2.3.4:8080/")
        );
        assert_eq!(
            normalize_proxy_url("  http://user:pass@relay.example.com:8080  ").as_deref(),
            Ok("http://user:pass@relay.example.com:8080/")
        );
        assert!(normalize_proxy_url("socks5://user:pass@relay.example.com:1080").is_ok());
        assert!(normalize_proxy_url("socks5h://relay.example.com:1080").is_ok());
        assert!(normalize_proxy_url("").is_err());
        assert!(normalize_proxy_url("ftp://relay.example.com:21").is_err());
        assert!(normalize_proxy_url("http://relay.example.com:8080/proxy").is_err());
        assert!(normalize_proxy_url("http://relay.example.com:8080?token=1").is_err());
        assert!(normalize_proxy_url("http://").is_err());
    }

    #[test]
    fn masks_proxy_credentials_but_keeps_the_host() {
        assert_eq!(
            readable_proxy_url("http://relay.example.com:8080/"),
            "http://relay.example.com:8080"
        );
        assert_eq!(
            readable_proxy_url("socks5://mark:secret@203.0.113.9:1080"),
            "socks5://***@203.0.113.9:1080"
        );
        assert_eq!(readable_proxy_url("not a url"), "");
    }

    #[test]
    fn keeps_a_safety_margin_on_cached_tokens() {
        assert_eq!(token_ttl(7_200).as_secs(), 6_900);
        assert_eq!(token_ttl(100).as_secs(), 60);
        assert_eq!(token_ttl(0).as_secs(), 60);
    }

    #[test]
    fn classifies_wechat_token_responses() {
        let ok = classify_token_response(&serde_json::json!({
            "access_token": "token-value",
            "expires_in": 7200,
        }));
        assert!(ok.ok);
        assert_eq!(ok.expires_in, 7200);
        assert_eq!(ok.message, "OK");

        let denied = classify_token_response(&serde_json::json!({
            "errcode": 40164,
            "errmsg": "invalid ip 1.2.3.4, not in whitelist",
        }));
        assert!(!denied.ok);
        assert!(denied.message.contains("40164"));
        assert!(denied.message.contains("whitelist"));
    }

    #[test]
    fn converts_epoch_days_to_calendar_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(59), (1970, 3, 1));
        assert_eq!(civil_from_days(20_089), (2025, 1, 1));
        assert_eq!(civil_from_days(20_453), (2025, 12, 31));
    }

    #[test]
    fn classifies_probe_error_codes() {
        assert_eq!(classify_probe_errcode(0), "allowed");
        assert_eq!(classify_probe_errcode(48001), "unauthorized");
        assert_eq!(classify_probe_errcode(40164), "blockedIp");
        assert_eq!(classify_probe_errcode(42001), "invalidCredentials");
        assert_eq!(classify_probe_errcode(-1), "busy");
        assert_eq!(classify_probe_errcode(46003), "unknown");
    }

    #[test]
    fn sanitizes_probe_messages_before_returning_them() {
        let token = "SECRET_TOKEN_VALUE";
        let leaked = sanitize_error_message(
            &format!("access_token={token} is invalid  {}", "x".repeat(300)),
            token,
        );
        assert!(!leaked.contains(token));
        assert!(leaked.chars().count() <= MAX_PROBE_MESSAGE_CHARS + 1);

        let json = read_probe_payload(
            r#"{"errcode":48001,"errmsg":"api unauthorized rid: 69cd2fca"}"#,
            token,
        );
        assert_eq!(json.status, "unauthorized");
        assert_eq!(json.errcode, 48001);

        let html = read_probe_payload("<html>gateway timeout</html>", token);
        assert_eq!(html.status, "unknown");

        let ok = read_probe_payload(r#"{"total_count":3}"#, token);
        assert_eq!(ok.status, "allowed");
        assert_eq!(ok.errcode, 0);
    }
}
