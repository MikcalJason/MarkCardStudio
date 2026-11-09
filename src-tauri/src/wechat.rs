use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

use crate::channels;
use crate::publish::bundle;

const WECHAT_API_BASE: &str = "https://api.weixin.qq.com/cgi-bin";
/// Keep in sync with `publishChannels.js` (`media.maxBytes` / `limits.images.max`).
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_IMAGES_PER_DRAFT: usize = 20;
const MAX_TITLE_CHARS: usize = 64;
const MAX_CAPTION_CHARS: usize = 2_000;
const PROGRESS_EVENT: &str = "wechat-draft-progress";
const MEDIA_CACHE_FILE: &str = "wechat-media-cache.json";
const MAX_MEDIA_CACHE_ENTRIES: usize = 2_000;
const MEDIA_ID_INVALID_ERRCODE: &str = "40007";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DraftProgress {
    stage: &'static str,
    current: usize,
    total: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatDraftResult {
    media_id: String,
    image_count: usize,
}

/// Permanent-material ids keyed by the image hash from the bundle manifest, so
/// re-publishing the same card reuses its upload instead of spending quota.
#[derive(Serialize, Deserialize, Default)]
struct MediaCacheFile {
    #[serde(default = "default_cache_version")]
    version: u32,
    #[serde(default)]
    items: HashMap<String, MediaCacheEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
struct MediaCacheEntry {
    #[serde(rename = "mediaId")]
    media_id: String,
    #[serde(rename = "uploadedAt")]
    uploaded_at: String,
}

fn default_cache_version() -> u32 {
    1
}

/// What a finished publish bundle contributes to one draft article.
#[derive(Debug)]
struct DraftImage {
    path: PathBuf,
    sha256: String,
}

#[derive(Debug)]
struct DraftSpec {
    title: String,
    body: String,
    tags: Vec<String>,
    images: Vec<DraftImage>,
}

fn iso_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    let (year, month, day) = channels::civil_from_days((seconds / 86_400) as i64);
    let remainder = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        remainder / 3_600,
        (remainder % 3_600) / 60,
        remainder % 60
    )
}

fn media_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Application data directory is not available: {err}"))?
        .join("markcard");
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Failed to create the cache folder: {err}"))?;
    Ok(dir.join(MEDIA_CACHE_FILE))
}

fn read_media_cache(path: &Path) -> HashMap<String, MediaCacheEntry> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    match serde_json::from_str::<MediaCacheFile>(&raw) {
        Ok(file) => file
            .items
            .into_iter()
            .filter(|(hash, entry)| {
                hash.len() == 64
                    && hash.chars().all(|character| character.is_ascii_hexdigit())
                    && !entry.media_id.trim().is_empty()
            })
            .collect(),
        // A damaged cache only costs a re-upload, so it is treated as empty.
        Err(_) => HashMap::new(),
    }
}

fn write_media_cache(path: &Path, items: &HashMap<String, MediaCacheEntry>) {
    let mut kept: Vec<(&String, &MediaCacheEntry)> = items.iter().collect();
    kept.sort_by(|left, right| right.1.uploaded_at.cmp(&left.1.uploaded_at));
    kept.truncate(MAX_MEDIA_CACHE_ENTRIES);
    let file = MediaCacheFile {
        version: default_cache_version(),
        items: kept
            .into_iter()
            .map(|(hash, entry)| (hash.clone(), entry.clone()))
            .collect(),
    };
    let Ok(bytes) = serde_json::to_vec(&file) else {
        return;
    };
    let temp_path = path.with_extension("json.tmp");
    if std::fs::write(&temp_path, &bytes).is_ok() {
        let _ = std::fs::rename(&temp_path, path);
    }
}

fn cached_media_id(items: &HashMap<String, MediaCacheEntry>, sha256: &str) -> Option<String> {
    if sha256.len() != 64 {
        return None;
    }
    items.get(sha256).map(|entry| entry.media_id.clone())
}

/// The bundle manifest already carries a SHA-256 per image; anything shorter or
/// non-hex is ignored so an odd manifest cannot poison the cache keys.
fn normalize_sha(value: Option<&Value>) -> String {
    let raw = value.and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    if raw.len() == 64 && raw.chars().all(|character| character.is_ascii_hexdigit()) {
        raw
    } else {
        String::new()
    }
}

fn bounded_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect()
}

/// A 图片消息 carries a plain-text description instead of HTML: the body lines,
/// then the hashtags (WeChat has no tag field, so they only survive as text).
fn build_caption_text(body: &str, tags: &[String]) -> String {
    let mut lines: Vec<String> = body
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();
    if !tags.is_empty() {
        let joined = tags
            .iter()
            .map(|tag| format!("#{tag}"))
            .collect::<Vec<_>>()
            .join(" ");
        lines.push(joined);
    }
    bounded_text(&lines.join("\n"), MAX_CAPTION_CHARS)
}

fn short_hash(seed: usize, label: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in label.bytes().chain(std::iter::once(seed as u8)) {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}")
}

fn supported_extension(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        _ => None,
    }
}

/// Reads `manifest.json` from a finished bundle. Only bundles written by this
/// app are accepted, so a stray folder can never be uploaded by accident.
fn read_draft_spec(bundle_dir: &Path) -> Result<DraftSpec, String> {
    let raw = std::fs::read_to_string(bundle_dir.join("manifest.json"))
        .map_err(|_| "The publish bundle has no manifest.json; regenerate the bundle".to_string())?;
    let manifest: Value =
        serde_json::from_str(&raw).map_err(|_| "The publish bundle manifest is unreadable".to_string())?;
    if manifest.get("generator").and_then(Value::as_str) != Some("markcard-studio") {
        return Err("This folder was not created by MarkCard Studio".to_string());
    }

    let content = manifest.get("content").cloned().unwrap_or(Value::Null);
    let title = bounded_text(
        content.get("title").and_then(Value::as_str).unwrap_or(""),
        MAX_TITLE_CHARS,
    );
    if title.is_empty() {
        return Err("The publish bundle has no title".to_string());
    }
    let body = content
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let tags = content
        .get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let images_node = manifest
        .get("images")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if images_node.is_empty() {
        return Err("The publish bundle has no images".to_string());
    }
    if images_node.len() > MAX_IMAGES_PER_DRAFT {
        return Err(format!("A draft holds at most {MAX_IMAGES_PER_DRAFT} images"));
    }

    let root = bundle_dir
        .canonicalize()
        .map_err(|err| format!("Failed to open the bundle folder: {err}"))?;
    let mut images = Vec::with_capacity(images_node.len());
    for entry in images_node.iter() {
        let file = entry.get("file").and_then(Value::as_str).unwrap_or("");
        let path = root
            .join(bundle::validate_relative_path(file)?)
            .canonicalize()
            .map_err(|_| format!("The bundle is missing {file}; regenerate the bundle"))?;
        if !path.starts_with(&root) {
            return Err("Bundle image escapes its own folder".to_string());
        }
        if supported_extension(&path).is_none() {
            return Err("Draft images must be JPG or PNG".to_string());
        }
        let size = std::fs::metadata(&path).map(|meta| meta.len() as usize).unwrap_or(0);
        if size == 0 || size > MAX_IMAGE_BYTES {
            return Err(format!("{file} is empty or exceeds the upload size limit"));
        }
        images.push(DraftImage {
            sha256: normalize_sha(entry.get("sha256")),
            path,
        });
    }

    Ok(DraftSpec {
        title,
        body,
        tags,
        images,
    })
}

/// A multipart filename is copied verbatim into the request body, so anything
/// that could break out of the header line is removed.
fn sanitize_file_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .filter(|char| char.is_ascii_alphanumeric() || matches!(char, '.' | '-' | '_'))
        .collect();
    let trimmed = cleaned.trim_matches('.');
    if trimmed.is_empty() {
        return "card.jpg".to_string();
    }
    trimmed.chars().take(64).collect()
}

fn build_multipart_body(
    field_name: &str,
    file_name: &str,
    content_type: &str,
    data: &[u8],
    boundary: &str,
) -> Vec<u8> {
    let mut body = Vec::with_capacity(data.len() + 128);
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"{field_name}\"; filename=\"{file_name}\"\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {content_type}\r\n\r\n").as_bytes());
    body.extend_from_slice(data);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

/// Returns the WeChat error message when the payload carries a non-zero errcode.
fn wechat_error(body: &Value, token: &str) -> Option<String> {
    let errcode = body.get("errcode").and_then(Value::as_i64).unwrap_or(0);
    if errcode == 0 {
        return None;
    }
    let errmsg = body
        .get("errmsg")
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    Some(format!(
        "{errcode}: {}",
        channels::sanitize_error_message(errmsg, token)
    ))
}

/// Uploads of a 10 MB card need far more than the 15 s used for token calls.
/// Built through `channels` so a configured relay proxy carries the upload too:
/// a material upload from a different egress IP would hit the whitelist.
fn upload_client() -> Result<reqwest::Client, String> {
    channels::client_with_timeout(60)
}

async fn read_wechat_response(
    response: reqwest::Response,
    token: &str,
) -> Result<Value, String> {
    let text = response
        .text()
        .await
        .map_err(|err| format!("Unexpected response: {err}"))?;
    let payload: Value = serde_json::from_str(&text)
        .map_err(|_| channels::sanitize_error_message(&text, token))?;
    if let Some(message) = wechat_error(&payload, token) {
        return Err(message);
    }
    Ok(payload)
}

/// reqwest's `multipart` helper is a cargo feature this app does not enable, so
/// the form body is framed by hand.
async fn upload_image(
    endpoint: &str,
    token: &str,
    bytes: &[u8],
    content_type: &str,
    file_name: &str,
) -> Result<Value, String> {
    let boundary = format!("----markcard{}", short_hash(bytes.len(), file_name));
    let url = reqwest::Url::parse_with_params(endpoint, &[("access_token", token)])
        .map_err(|err| format!("Failed to build request URL: {err}"))?;
    let response = upload_client()?
        .post(url)
        .header(
            reqwest::header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(build_multipart_body(
            "media",
            file_name,
            content_type,
            bytes,
            &boundary,
        ))
        .send()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;
    read_wechat_response(response, token).await
}

async fn post_json(endpoint: &str, token: &str, payload: &Value) -> Result<Value, String> {
    let url = reqwest::Url::parse_with_params(endpoint, &[("access_token", token)])
        .map_err(|err| format!("Failed to build request URL: {err}"))?;
    let response = channels::http_client()?
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(payload.to_string())
        .send()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;
    read_wechat_response(response, token).await
}

/// The draft is a 图片消息 (`newspic`): the cards are permanent-material images
/// rather than an HTML article, and `content` is the plain-text description.
fn draft_payload(title: &str, content: &str, image_media_ids: &[String]) -> Value {
    let image_list: Vec<Value> = image_media_ids
        .iter()
        .map(|media_id| json!({ "image_media_id": media_id }))
        .collect();
    json!({
        "articles": [{
            "article_type": "newspic",
            "title": title,
            "content": content,
            "need_open_comment": 0,
            "only_fans_can_comment": 0,
            "image_info": { "image_list": image_list },
        }]
    })
}

fn file_label(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("card.jpg")
        .to_string()
}

#[tauri::command]
pub async fn publish_wechat_draft_from_bundle(
    app: tauri::AppHandle,
    channel: String,
    bundle_path: String,
) -> Result<WechatDraftResult, String> {
    channels::validate_channel(&channel)?;
    let bundle_dir = bundle_path.clone();
    let spec = tauri::async_runtime::spawn_blocking(move || read_draft_spec(Path::new(&bundle_dir)))
        .await
        .map_err(|err| format!("Task execution failed: {err}"))??;

    let channel_for_read = channel.clone();
    let (app_id, app_secret) = tauri::async_runtime::spawn_blocking(move || {
        channels::validate_channel(&channel_for_read)?;
        channels::read_credentials(&channel_for_read)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))??;
    let (Some(app_id), Some(app_secret)) = (app_id, app_secret) else {
        return Err("Credentials are not configured yet".to_string());
    };

    let token = channels::wechat_access_token(&app_id, &app_secret).await?;
    // A cached token skips the token request, so make sure the relay proxy is
    // resolved before the uploads build their own client.
    channels::prepare_proxy().await?;
    let total = spec.images.len();

    // 图片消息 references permanent material, so every card is uploaded with
    // add_material (not media/uploadimg) and collected as an image_media_id.
    // Identical cards reuse the cached media id instead of spending quota.
    let cache_path = media_cache_path(&app)?;
    let mut cache = read_media_cache(&cache_path);
    let content = build_caption_text(&spec.body, &spec.tags);

    let mut attempt = 0;
    let response = loop {
        let mut image_media_ids: Vec<String> = Vec::with_capacity(total);
        let mut reused_keys: Vec<String> = Vec::new();

        for (index, image) in spec.images.iter().enumerate() {
            let _ = app.emit(
                PROGRESS_EVENT,
                DraftProgress { stage: "upload", current: index + 1, total },
            );
            if let Some(media_id) = cached_media_id(&cache, &image.sha256) {
                reused_keys.push(image.sha256.clone());
                image_media_ids.push(media_id);
                continue;
            }

            let bytes =
                std::fs::read(&image.path).map_err(|err| format!("Failed to read card: {err}"))?;
            let content_type = supported_extension(&image.path).unwrap_or("image/jpeg");
            let uploaded = upload_image(
                &format!("{WECHAT_API_BASE}/material/add_material?type=image"),
                &token,
                &bytes,
                content_type,
                &sanitize_file_name(&file_label(&image.path)),
            )
            .await?;
            let media_id = uploaded
                .get("media_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if media_id.is_empty() {
                return Err(format!("Uploading page {} returned no media id", index + 1));
            }
            if !image.sha256.is_empty() {
                cache.insert(
                    image.sha256.clone(),
                    MediaCacheEntry {
                        media_id: media_id.clone(),
                        uploaded_at: iso_timestamp(),
                    },
                );
                write_media_cache(&cache_path, &cache);
            }
            image_media_ids.push(media_id);
        }

        let payload = draft_payload(&spec.title, &content, &image_media_ids);
        let _ = app.emit(PROGRESS_EVENT, DraftProgress { stage: "draft", current: total, total });
        match post_json(&format!("{WECHAT_API_BASE}/draft/add"), &token, &payload).await {
            Ok(response) => break response,
            Err(err) => {
                // A cached id can go stale when the material was removed in the
                // console; drop those entries and retry once with fresh uploads.
                let stale_cache =
                    !reused_keys.is_empty() && err.starts_with(MEDIA_ID_INVALID_ERRCODE);
                if stale_cache && attempt == 0 {
                    for key in &reused_keys {
                        cache.remove(key);
                    }
                    write_media_cache(&cache_path, &cache);
                    attempt += 1;
                    continue;
                }
                return Err(err);
            }
        }
    };

    let media_id = response
        .get("media_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if media_id.is_empty() {
        return Err("The draft was created without a media id".to_string());
    }
    Ok(WechatDraftResult {
        media_id,
        image_count: total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_framed_multipart_body() {
        let data = b"binary-bytes".to_vec();
        let body = build_multipart_body("media", "card-01.jpg", "image/jpeg", &data, "BOUNDARY");
        let text = String::from_utf8(body).unwrap();
        assert!(text.starts_with("--BOUNDARY\r\n"));
        assert!(text.contains("name=\"media\"; filename=\"card-01.jpg\""));
        assert!(text.contains("Content-Type: image/jpeg\r\n\r\nbinary-bytes"));
        assert!(text.ends_with("--BOUNDARY--\r\n"));
    }

    #[test]
    fn file_names_cannot_break_out_of_the_disposition_header() {
        assert_eq!(sanitize_file_name("card-01.jpg"), "card-01.jpg");
        assert_eq!(
            sanitize_file_name("a\"; filename=\"evil\r\nX: 1"),
            "afilenameevilX1"
        );
        assert_eq!(sanitize_file_name("../../images/x.png"), "imagesx.png");
        assert_eq!(sanitize_file_name("///"), "card.jpg");
    }

    #[test]
    fn caption_text_keeps_body_lines_and_tags() {
        let text = build_caption_text("第一段\n\n第二段", &["Markdown".to_string()]);
        assert_eq!(text, "第一段\n第二段\n#Markdown");
        assert_eq!(build_caption_text("  ", &[]), "");
    }

    #[test]
    fn builds_a_newspic_draft_payload() {
        let payload = draft_payload(
            "标题",
            "正文\n#Markdown",
            &["MEDIA_ONE".to_string(), "MEDIA_TWO".to_string()],
        );
        let article = &payload["articles"][0];
        assert_eq!(article["article_type"], "newspic");
        assert_eq!(article["title"], "标题");
        assert_eq!(article["content"], "正文\n#Markdown");
        assert_eq!(article["image_info"]["image_list"][0]["image_media_id"], "MEDIA_ONE");
        assert_eq!(article["image_info"]["image_list"][1]["image_media_id"], "MEDIA_TWO");
        // 图片消息 takes its cover from the first image, so no thumb is sent.
        assert!(article.get("thumb_media_id").is_none());
    }

    #[test]
    fn media_cache_roundtrips_and_ignores_bad_entries() {
        let dir = std::env::temp_dir().join(format!("mcs-media-cache-{}", short_hash(3, "probe")));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("wechat-media-cache.json");

        let key = "a".repeat(64);
        let mut items = HashMap::new();
        items.insert(
            key.clone(),
            MediaCacheEntry {
                media_id: "MEDIA_ID".to_string(),
                uploaded_at: "2026-10-23T00:00:00Z".to_string(),
            },
        );
        write_media_cache(&path, &items);
        assert_eq!(
            read_media_cache(&path).get(&key).map(|entry| entry.media_id.clone()),
            Some("MEDIA_ID".to_string())
        );

        std::fs::write(
            &path,
            br#"{"version":1,"items":{"short":{"mediaId":"X","uploadedAt":"t"},"0000000000000000000000000000000000000000000000000000000000000000":{"mediaId":"  ","uploadedAt":"t"}}}"#,
        )
        .unwrap();
        assert!(read_media_cache(&path).is_empty());

        std::fs::write(&path, b"{broken").unwrap();
        assert!(read_media_cache(&path).is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn media_cache_keeps_only_the_newest_entries() {
        let dir = std::env::temp_dir().join(format!("mcs-media-prune-{}", short_hash(4, "probe")));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("wechat-media-cache.json");
        let mut items = HashMap::new();
        for index in 0..(MAX_MEDIA_CACHE_ENTRIES + 5) {
            items.insert(
                format!("{index:064x}"),
                MediaCacheEntry {
                    media_id: format!("MEDIA_{index}"),
                    uploaded_at: format!("2026-10-23T00:00:{index:06}"),
                },
            );
        }
        write_media_cache(&path, &items);
        let loaded = read_media_cache(&path);
        assert_eq!(loaded.len(), MAX_MEDIA_CACHE_ENTRIES);
        assert!(!loaded.contains_key(&format!("{:064x}", 0)));
        assert!(loaded.contains_key(&format!("{:064x}", MAX_MEDIA_CACHE_ENTRIES + 4)));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn normalizes_manifest_hashes() {
        assert_eq!(normalize_sha(Some(&json!("A".repeat(64)))), "a".repeat(64));
        assert_eq!(normalize_sha(Some(&json!("abc"))), "");
        assert_eq!(normalize_sha(Some(&json!("z".repeat(64)))), "");
        assert_eq!(normalize_sha(None), "");
    }

    #[test]
    fn wechat_errors_are_classified_and_bounded() {
        let token = "SECRET";
        assert!(wechat_error(&json!({ "media_id": "x" }), token).is_none());
        let message = wechat_error(
            &json!({ "errcode": 48001, "errmsg": format!("api unauthorized {token}") }),
            token,
        )
        .unwrap();
        assert!(message.starts_with("48001:"));
        assert!(!message.contains(token));
    }

    #[test]
    fn rejects_bundles_that_are_not_ours() {
        let dir = std::env::temp_dir().join(format!("mcs-draft-foreign-{}", short_hash(1, "probe")));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("manifest.json"), b"{\"generator\":\"other\"}").unwrap();
        let error = read_draft_spec(&dir).unwrap_err();
        assert!(error.contains("not created by MarkCard Studio"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reads_a_valid_bundle_and_rejects_traversal() {
        let dir = std::env::temp_dir().join(format!("mcs-draft-ok-{}", short_hash(2, "probe")));
        std::fs::create_dir_all(dir.join("images")).unwrap();
        std::fs::write(dir.join("images/01.jpg"), vec![0xff; 64]).unwrap();
        let manifest = json!({
            "generator": "markcard-studio",
            "schemaVersion": 1,
            "content": { "title": "标题", "body": "正文", "tags": ["Markdown"] },
            "images": [{
                "file": "images/01.jpg",
                "role": "cover",
                "sha256": "A".repeat(64),
            }],
        });
        std::fs::write(dir.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
        let spec = read_draft_spec(&dir).unwrap();
        assert_eq!(spec.title, "标题");
        assert_eq!(spec.images.len(), 1);
        assert_eq!(spec.images[0].sha256, "a".repeat(64));

        let escaped = json!({
            "generator": "markcard-studio",
            "content": { "title": "标题", "body": "", "tags": [] },
            "images": [{ "file": "../secret.jpg", "role": "cover" }],
        });
        std::fs::write(dir.join("manifest.json"), serde_json::to_vec(&escaped).unwrap()).unwrap();
        assert!(read_draft_spec(&dir).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
