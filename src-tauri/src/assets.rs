use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const INDEX_SCHEMA_VERSION: u32 = 1;
const MAX_ASSET_BYTES: usize = 50 * 1024 * 1024;
const MAX_THUMB_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAssetFiles {
    path: String,
    thumb_path: String,
    bytes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetFileData {
    asset_id: String,
    file_name: String,
    media_type: String,
    data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirroredAsset {
    relative_path: String,
    absolute_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedImage {
    absolute_path: String,
    relative_path: String,
    file_name: String,
    media_type: String,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFolder {
    root_path: String,
    images: Vec<ScannedImage>,
    skipped: usize,
    truncated: bool,
}

#[tauri::command]
pub async fn pick_asset_files(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected_paths = app
            .dialog()
            .file()
            .add_filter(
                "Images",
                &["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"],
            )
            .blocking_pick_files();

        let Some(selected_paths) = selected_paths else {
            return Ok(Vec::new());
        };

        let mut paths = Vec::new();
        for selected_path in selected_paths {
            let path = selected_path
                .into_path()
                .map_err(|err| format!("Selected image path is not available: {err}"))?;
            if !path.is_file() {
                return Err(format!("Selected image is not a file: {}", path.display()));
            }
            paths.push(display_path(&path));
        }
        Ok(paths)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn pick_asset_folder(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder_path = app.dialog().file().blocking_pick_folder();

        match folder_path {
            Some(folder_path) => {
                let path = folder_path
                    .into_path()
                    .map_err(|err| format!("Selected folder path is not available: {err}"))?;
                Ok(Some(display_path(&path)))
            }
            None => Ok(None),
        }
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

/// Lists importable images below a folder without reading their bytes; the
/// frontend still imports through `resolve_local_image`, so content hashing and
/// dedupe stay identical to the single-file path.
#[tauri::command]
pub async fn scan_image_folder(root_path: String) -> Result<ScannedFolder, String> {
    tauri::async_runtime::spawn_blocking(move || scan_images_under_root(Path::new(&root_path)))
        .await
        .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn read_asset_library(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library_dir = asset_library_dir(&app)?;
        read_asset_index(&library_dir)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn write_asset_library(app: AppHandle, index: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library_dir = asset_library_dir(&app)?;
        write_asset_index(&library_dir, &index)
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn store_asset_file(
    app: AppHandle,
    asset_id: String,
    file_name: String,
    media_type: String,
    data_url: String,
    thumb_data_url: Option<String>,
) -> Result<StoredAssetFiles, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library_dir = asset_library_dir(&app)?;
        let hash = validate_asset_id(&asset_id)?;
        let extension = extension_for_media_type(&media_type, &file_name)?;
        let relative_path = format!("assets/{}/{}/{}.{}", &hash[0..2], &hash[2..4], hash, extension);
        let absolute_path = safe_library_join(&library_dir, &relative_path)?;

        let (_, bytes) = decode_data_url(&data_url)?;
        if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
            return Err("Asset files must be between 1 byte and 50 MB".to_string());
        }
        write_atomic(&absolute_path, &bytes)?;

        let thumb_path = match thumb_data_url.filter(|value| !value.trim().is_empty()) {
            Some(thumb_data_url) => {
                let (thumb_media_type, thumb_bytes) = decode_data_url(&thumb_data_url)?;
                if thumb_bytes.is_empty() || thumb_bytes.len() > MAX_THUMB_BYTES {
                    return Err("Asset thumbnails must be between 1 byte and 4 MB".to_string());
                }
                let thumb_extension = thumb_extension_for_media_type(&thumb_media_type);
                let relative_thumb_path =
                    format!("thumbs/{}/{}/{}.{}", &hash[0..2], &hash[2..4], hash, thumb_extension);
                let absolute_thumb_path = safe_library_join(&library_dir, &relative_thumb_path)?;
                write_atomic(&absolute_thumb_path, &thumb_bytes)?;
                relative_thumb_path
            }
            None => String::new(),
        };

        Ok(StoredAssetFiles {
            path: relative_path,
            thumb_path,
            bytes: bytes.len(),
        })
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn read_asset_file(
    app: AppHandle,
    asset_id: String,
    variant: Option<String>,
) -> Result<AssetFileData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library_dir = asset_library_dir(&app)?;
        let index = read_asset_index(&library_dir)?;
        let asset = find_asset(&index, &asset_id)?;
        let hash = validate_asset_id(&asset_id)?;
        let use_thumb = variant.as_deref() == Some("thumb");
        let relative_path = if use_thumb {
            asset
                .get("thumbPath")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Asset has no thumbnail yet".to_string())?
        } else {
            asset
                .get("path")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Asset has no stored file".to_string())?
        };
        let absolute_path = safe_library_join(&library_dir, relative_path)?;
        let bytes = fs::read(&absolute_path)
            .map_err(|err| format!("Failed to read asset {}: {err}", absolute_path.display()))?;
        let media_type = media_type_for_path(&absolute_path)?;
        let encoded = general_purpose::STANDARD.encode(bytes);
        let file_name = Path::new(relative_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&hash)
            .to_string();

        Ok(AssetFileData {
            asset_id,
            file_name,
            media_type: media_type.to_string(),
            data_url: format!("data:{media_type};base64,{encoded}"),
        })
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn mirror_asset(
    app: AppHandle,
    asset_id: String,
    document_path: String,
) -> Result<MirroredAsset, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library_dir = asset_library_dir(&app)?;
        let index = read_asset_index(&library_dir)?;
        let asset = find_asset(&index, &asset_id)?;
        let relative_path = asset
            .get("path")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Asset has no stored file".to_string())?;
        let source_path = safe_library_join(&library_dir, relative_path)?;

        let document = PathBuf::from(document_path.trim());
        if !document.is_file() {
            return Err("Save the Markdown document before mirroring assets".to_string());
        }
        let project_dir = document
            .parent()
            .ok_or_else(|| "Document has no parent directory".to_string())?;
        let file_name = Path::new(relative_path)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Asset file name is invalid".to_string())?;
        let relative_project_path = format!("assets/{file_name}");
        let target_dir = project_dir.join("assets");
        fs::create_dir_all(&target_dir).map_err(|err| {
            format!(
                "Failed to create project asset directory {}: {err}",
                target_dir.display()
            )
        })?;
        let target_path = target_dir.join(file_name);
        if !target_path.exists() {
            let bytes = fs::read(&source_path)
                .map_err(|err| format!("Failed to read asset {}: {err}", source_path.display()))?;
            write_atomic(&target_path, &bytes)?;
        }

        Ok(MirroredAsset {
            relative_path: relative_project_path,
            absolute_path: display_path(&target_path),
        })
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn delete_asset_file(app: AppHandle, asset_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library_dir = asset_library_dir(&app)?;
        let index = read_asset_index(&library_dir)?;
        let Ok(asset) = find_asset(&index, &asset_id) else {
            return Ok(());
        };

        for field in ["path", "thumbPath"] {
            if let Some(relative_path) = asset.get(field).and_then(Value::as_str) {
                if relative_path.trim().is_empty() {
                    continue;
                }
                let absolute_path = safe_library_join(&library_dir, relative_path)?;
                if absolute_path.exists() {
                    fs::remove_file(&absolute_path).map_err(|err| {
                        format!("Failed to delete asset {}: {err}", absolute_path.display())
                    })?;
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

fn asset_library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("markcard").join("library"))
        .map_err(|err| format!("Application data directory is not available: {err}"))
}

fn empty_index() -> Value {
    serde_json::json!({
        "schemaVersion": INDEX_SCHEMA_VERSION,
        "assets": [],
    })
}

fn read_asset_index(library_dir: &Path) -> Result<Value, String> {
    let index_path = library_dir.join("index.json");
    if !index_path.exists() {
        return Ok(empty_index());
    }
    let bytes = fs::read(&index_path)
        .map_err(|err| format!("Failed to read asset index {}: {err}", index_path.display()))?;
    let index = match serde_json::from_slice::<Value>(&bytes) {
        Ok(index) => index,
        Err(_) => {
            let backup_path = library_dir.join(format!(
                "index.corrupt-{}.json",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
            ));
            let _ = fs::rename(&index_path, backup_path);
            return Ok(empty_index());
        }
    };
    if !index.get("assets").is_some_and(Value::is_array) {
        return Ok(empty_index());
    }
    Ok(index)
}

fn write_asset_index(library_dir: &Path, index: &Value) -> Result<(), String> {
    if !index.get("assets").is_some_and(Value::is_array) {
        return Err("Asset index must contain an assets array".to_string());
    }
    if index
        .get("assets")
        .and_then(Value::as_array)
        .is_some_and(|assets| assets.len() > 50_000)
    {
        return Err("Asset index exceeds the 50,000 asset limit".to_string());
    }
    fs::create_dir_all(library_dir).map_err(|err| {
        format!(
            "Failed to create asset library directory {}: {err}",
            library_dir.display()
        )
    })?;
    let bytes = serde_json::to_vec_pretty(index)
        .map_err(|err| format!("Failed to serialize asset index: {err}"))?;
    write_atomic(&library_dir.join("index.json"), &bytes)
}

fn find_asset<'a>(index: &'a Value, asset_id: &str) -> Result<&'a Value, String> {
    index
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| {
            assets.iter().find(|asset| {
                asset.get("assetId").and_then(Value::as_str) == Some(asset_id)
            })
        })
        .ok_or_else(|| format!("Asset was not found in the library: {asset_id}"))
}

fn validate_asset_id(asset_id: &str) -> Result<&str, String> {
    let hash = asset_id
        .strip_prefix("sha256:")
        .ok_or_else(|| "Asset identifiers must use the sha256: prefix".to_string())?;
    if hash.len() != 64 || !hash.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("Asset identifier must contain a 64 character SHA-256 hash".to_string());
    }
    Ok(hash)
}

fn extension_for_media_type(media_type: &str, file_name: &str) -> Result<&'static str, String> {
    match media_type.split(';').next().unwrap_or_default().trim() {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        "image/avif" => Ok("avif"),
        "image/bmp" => Ok("bmp"),
        "image/svg+xml" => Ok("svg"),
        _ => {
            let extension = Path::new(file_name)
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase())
                .unwrap_or_default();
            match extension.as_str() {
                "png" => Ok("png"),
                "jpg" | "jpeg" | "jfif" => Ok("jpg"),
                "webp" => Ok("webp"),
                "gif" => Ok("gif"),
                "avif" => Ok("avif"),
                "bmp" => Ok("bmp"),
                "svg" => Ok("svg"),
                _ => Err("Unsupported image type".to_string()),
            }
        }
    }
}

fn thumb_extension_for_media_type(media_type: &str) -> &'static str {
    match media_type.split(';').next().unwrap_or_default().trim() {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}

fn media_type_for_path(path: &Path) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "png" => Ok("image/png"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "webp" => Ok("image/webp"),
        "gif" => Ok("image/gif"),
        "avif" => Ok("image/avif"),
        "bmp" => Ok("image/bmp"),
        "svg" => Ok("image/svg+xml"),
        _ => Err("Unsupported image type".to_string()),
    }
}

fn decode_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
    let (header, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "Invalid data URL".to_string())?;
    let media_type = header
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .ok_or_else(|| "Only base64 data URLs are supported".to_string())?;
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|err| format!("Invalid base64 image data: {err}"))?;
    Ok((media_type.to_string(), bytes))
}

fn safe_library_join(library_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Asset path escapes the library directory".to_string());
    }
    Ok(library_dir.join(relative))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Target path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("Failed to create directory {}: {err}", parent.display()))?;
    let temporary = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("asset"),
        std::process::id()
    ));
    fs::write(&temporary, bytes)
        .map_err(|err| format!("Failed to write {}: {err}", temporary.display()))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|err| format!("Failed to replace {}: {err}", path.display()))?;
    }
    fs::rename(&temporary, path).map_err(|err| {
        let _ = fs::remove_file(&temporary);
        format!("Failed to finalize {}: {err}", path.display())
    })
}

const SCAN_MAX_FILES: usize = 3000;
const SCAN_MAX_DEPTH: usize = 8;
// Keep in sync with MAX_IMPORT_BYTES in useAssetLibrary.js: a larger file would
// be listed by the walker and then rejected by the importer.
const SCAN_MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;

fn scan_images_under_root(requested: &Path) -> Result<ScannedFolder, String> {
    let root = requested.canonicalize().map_err(|err| {
        format!("Cannot open folder {}: {err}", requested.display())
    })?;
    if !root.is_dir() {
        return Err(format!("Scan root is not a folder: {}", root.display()));
    }

    let mut images: Vec<ScannedImage> = Vec::new();
    let mut skipped = 0_usize;
    let mut truncated = false;
    let mut stack = vec![(root.clone(), 0_usize)];

    while let Some((dir, depth)) = stack.pop() {
        if depth >= SCAN_MAX_DEPTH {
            truncated = true;
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            skipped += 1;
            continue;
        };

        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Dot folders are vault and tool metadata (.obsidian, .git), not notes.
            if name.starts_with('.') {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                skipped += 1;
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                stack.push((entry.path(), depth + 1));
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            let path = entry.path();
            let Ok(media_type) = media_type_for_path(&path) else {
                continue;
            };
            let Ok(metadata) = entry.metadata() else {
                skipped += 1;
                continue;
            };
            if metadata.len() == 0 || metadata.len() > SCAN_MAX_FILE_BYTES {
                skipped += 1;
                continue;
            }
            if images.len() >= SCAN_MAX_FILES {
                truncated = true;
                break;
            }
            let Ok(relative) = path.strip_prefix(&root) else {
                skipped += 1;
                continue;
            };

            images.push(ScannedImage {
                absolute_path: display_path(&path),
                relative_path: relative
                    .components()
                    .map(|component| component.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/"),
                file_name: name,
                media_type: media_type.to_string(),
                bytes: metadata.len(),
            });
        }
    }

    images.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(ScannedFolder {
        root_path: display_path(&root),
        images,
        skipped,
        truncated,
    })
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_library_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "markcard-assets-{label}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn validates_content_addressed_asset_ids() {
        let hash = "a".repeat(64);
        assert_eq!(validate_asset_id(&format!("sha256:{hash}")).unwrap(), hash);
        assert!(validate_asset_id("asset-1").is_err());
        assert!(validate_asset_id(&format!("sha256:{}", "a".repeat(63))).is_err());
        assert!(validate_asset_id(&format!("sha256:{}", "g".repeat(64))).is_err());
    }

    #[test]
    fn rejects_paths_that_escape_the_library() {
        let library = Path::new("/tmp/markcard-library");
        assert!(safe_library_join(library, "assets/ab/cd/file.png").is_ok());
        assert!(safe_library_join(library, "../file.png").is_err());
        assert!(safe_library_join(library, "assets/../../file.png").is_err());
        assert!(safe_library_join(library, "/tmp/file.png").is_err());
    }

    #[test]
    fn decodes_base64_image_data_urls() {
        let (media_type, bytes) = decode_data_url("data:image/png;base64,aGk=").unwrap();
        assert_eq!(media_type, "image/png");
        assert_eq!(bytes, b"hi");
        assert!(decode_data_url("data:image/png,hi").is_err());
    }

    #[test]
    fn maps_supported_image_extensions() {
        assert_eq!(extension_for_media_type("image/jpeg", "a.bin").unwrap(), "jpg");
        assert_eq!(extension_for_media_type("", "photo.webp").unwrap(), "webp");
        assert!(extension_for_media_type("application/pdf", "a.pdf").is_err());
    }

    #[test]
    fn writes_and_reads_the_json_index_atomically() {
        let library = test_library_dir("index");
        let _ = fs::remove_dir_all(&library);
        let index = serde_json::json!({
            "schemaVersion": 1,
            // The frontend owns these arrays and Rust must pass them through,
            // because a dropped `roots` hides the mounted-folder rail.
            "roots": [{ "rootId": "root_1", "path": "/vault" }],
            "recentRoots": [{ "rootId": "root_2", "path": "/other" }],
            "assets": [{ "assetId": format!("sha256:{}", "b".repeat(64)), "path": "assets/bb/bb/file.png" }]
        });

        write_asset_index(&library, &index).unwrap();
        let restored = read_asset_index(&library).unwrap();
        assert_eq!(restored["assets"][0]["assetId"], index["assets"][0]["assetId"]);
        assert_eq!(restored["roots"][0]["path"], "/vault");
        assert_eq!(restored["recentRoots"][0]["rootId"], "root_2");
        assert!(write_asset_index(&library, &serde_json::json!({ "assets": "nope" })).is_err());

        fs::write(library.join("index.json"), b"not-json").unwrap();
        let recovered = read_asset_index(&library).unwrap();
        assert_eq!(recovered["assets"].as_array().unwrap().len(), 0);
        let _ = fs::remove_dir_all(&library);
    }

    #[test]
    fn scans_image_folders_recursively_without_metadata_or_oversized_files() {
        let root = test_library_dir("scan");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("notes/deep")).unwrap();
        fs::create_dir_all(root.join(".obsidian")).unwrap();
        fs::write(root.join("cover.png"), b"png-bytes").unwrap();
        fs::write(root.join("notes/deep/diagram.svg"), b"<svg/>").unwrap();
        fs::write(root.join("notes/notes.txt"), b"text").unwrap();
        fs::write(root.join("notes/empty.png"), b"").unwrap();
        fs::write(root.join(".obsidian/hidden.png"), b"png-bytes").unwrap();

        let huge = root.join("notes/huge.jpeg");
        fs::write(&huge, b"x").unwrap();
        let handle = fs::OpenOptions::new().write(true).open(&huge).unwrap();
        handle.set_len(SCAN_MAX_FILE_BYTES + 1).unwrap();
        drop(handle);

        let scanned = scan_images_under_root(&root).unwrap();
        let paths: Vec<&str> = scanned
            .images
            .iter()
            .map(|image| image.relative_path.as_str())
            .collect();
        assert_eq!(paths, vec!["cover.png", "notes/deep/diagram.svg"]);
        assert_eq!(scanned.images[0].media_type, "image/png");
        assert_eq!(scanned.images[1].media_type, "image/svg+xml");
        assert_eq!(scanned.images[1].file_name, "diagram.svg");
        assert_eq!(scanned.skipped, 2);
        assert!(!scanned.truncated);

        assert!(scan_images_under_root(&root.join("cover.png")).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn stops_scanning_below_the_depth_limit() {
        let root = test_library_dir("scan-depth");
        let _ = fs::remove_dir_all(&root);
        let mut deep = root.clone();
        for level in 0..(SCAN_MAX_DEPTH + 2) {
            deep = deep.join(format!("level-{level}"));
        }
        fs::create_dir_all(&deep).unwrap();
        fs::write(root.join("top.png"), b"png-bytes").unwrap();
        fs::write(deep.join("bottom.png"), b"png-bytes").unwrap();

        let scanned = scan_images_under_root(&root).unwrap();
        assert_eq!(scanned.images.len(), 1);
        assert_eq!(scanned.images[0].relative_path, "top.png");
        assert!(scanned.truncated);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writes_files_with_parent_directories() {
        let library = test_library_dir("files");
        let _ = fs::remove_dir_all(&library);
        let target = library.join("assets/ab/cd/file.png");
        write_atomic(&target, b"image-bytes").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"image-bytes");
        write_atomic(&target, b"next").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"next");
        let _ = fs::remove_dir_all(&library);
    }
}

