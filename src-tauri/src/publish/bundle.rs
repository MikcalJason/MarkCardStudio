use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use serde_json::Value;
use tauri::AppHandle;

use crate::files::{display_path, expand_tilde};

const MAX_BUNDLE_FILE_BYTES: usize = 64 * 1024 * 1024;
const ALLOWED_EXTENSIONS: [&str; 7] = ["jpg", "jpeg", "png", "json", "txt", "html", "md"];
const BUNDLE_GENERATOR: &str = "markcard-studio";
const TEMP_MARKER: &str = ".tmp-";

fn active_bundles() -> &'static Mutex<HashSet<String>> {
    static ACTIVE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn lock_sessions() -> std::sync::MutexGuard<'static, HashSet<String>> {
    active_bundles()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn sanitize_bundle_name(raw: &str) -> String {
    let mut name = String::new();
    let mut previous_was_separator = false;

    for character in raw.trim().chars() {
        if character.is_control() {
            continue;
        }
        if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
            name.push(character);
            previous_was_separator = false;
            continue;
        }
        if !previous_was_separator && !name.is_empty() {
            name.push('-');
            previous_was_separator = true;
        }
    }

    let trimmed = name.trim_matches('.').trim_matches('-').to_string();
    if trimmed.is_empty() || trimmed == ".." || trimmed == "." {
        return "markcard-publish".to_string();
    }
    trimmed.chars().take(100).collect()
}

pub fn validate_relative_path(raw: &str) -> Result<PathBuf, String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err("Publish bundle file path must not be empty".to_string());
    }
    if value.starts_with('/') || value.starts_with('\\') {
        return Err("Publish bundle file path must be relative".to_string());
    }
    if value.contains('\\') || value.contains(':') {
        return Err("Publish bundle file path contains an unsupported separator".to_string());
    }

    let segments: Vec<&str> = value.split('/').collect();
    if segments.len() > 2 {
        return Err("Publish bundle file path must be at most one directory deep".to_string());
    }

    for segment in &segments {
        if segment.is_empty() || *segment == "." || *segment == ".." {
            return Err("Publish bundle file path must not traverse directories".to_string());
        }
        if !segment
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '-' | '_' | '.'))
        {
            return Err("Publish bundle file path contains unsupported characters".to_string());
        }
    }

    if segments.len() == 2 && segments[0] != "images" {
        return Err("Only the images directory may be nested in a publish bundle".to_string());
    }
    if segments.len() == 1 && segments[0] == "images" {
        return Err("The images directory must be created with its first file".to_string());
    }

    let file_name = segments[segments.len() - 1];
    let extension = Path::new(file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .ok_or_else(|| "Publish bundle files require a file extension".to_string())?;
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("Unsupported publish bundle file type: {extension}"));
    }

    Ok(segments.iter().collect::<PathBuf>())
}

fn ensure_inside_bundle(bundle: &Path, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Publish bundle file must have a parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("Failed to create publish bundle directory: {err}"))?;

    let bundle_real = bundle
        .canonicalize()
        .map_err(|err| format!("Failed to resolve publish bundle directory: {err}"))?;
    let parent_real = parent
        .canonicalize()
        .map_err(|err| format!("Failed to resolve publish bundle subdirectory: {err}"))?;

    if !parent_real.starts_with(&bundle_real) {
        return Err("Publish bundle file escapes the bundle directory".to_string());
    }
    Ok(())
}

fn temp_bundle_name(raw: &str) -> String {
    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    format!("{}{TEMP_MARKER}{pid}-{nanos}", sanitize_bundle_name(raw))
}

fn bundle_stem_from_temp(temp_name: &str) -> String {
    match temp_name.split_once(TEMP_MARKER) {
        Some((stem, _)) if !stem.is_empty() => stem.to_string(),
        _ => "markcard-publish".to_string(),
    }
}

pub fn resolve_final_bundle_path(root: &Path, stem: &str) -> PathBuf {
    let mut candidate = root.join(stem);
    let mut index = 1;
    while candidate.exists() {
        candidate = root.join(format!("{stem}-{index}"));
        index += 1;
    }
    candidate
}

pub fn is_replaceable_bundle(path: &Path) -> bool {
    let manifest = path.join("manifest.json");
    let Ok(raw) = fs::read_to_string(&manifest) else {
        return false;
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
        return false;
    };
    parsed
        .get("generator")
        .and_then(Value::as_str)
        .unwrap_or_default()
        == BUNDLE_GENERATOR
}

#[tauri::command]
pub async fn begin_publish_bundle(
    app: AppHandle,
    folder_path: String,
    bundle_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let raw_folder = folder_path.trim();
        if raw_folder.is_empty() {
            return Err("An export root folder must be selected first".to_string());
        }

        let root_dir = expand_tilde(&app, Path::new(raw_folder));
        fs::create_dir_all(&root_dir).map_err(|err| {
            format!(
                "Failed to create publish bundle root {}: {err}",
                root_dir.display()
            )
        })?;

        let temp_dir = root_dir.join(temp_bundle_name(&bundle_name));
        fs::create_dir_all(&temp_dir)
            .map_err(|err| format!("Failed to create publish bundle: {err}"))?;

        lock_sessions().insert(display_path(&temp_dir));
        Ok(display_path(&temp_dir))
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn append_publish_bundle_file(
    bundle_path: String,
    relative_path: String,
    base64_data: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = PathBuf::from(bundle_path.trim());
        if !lock_sessions().contains(bundle.to_string_lossy().as_ref()) {
            return Err("Publish bundle session is no longer active".to_string());
        }
        if !bundle.is_dir() {
            return Err("Publish bundle directory is missing".to_string());
        }

        let target = bundle.join(validate_relative_path(&relative_path)?);
        ensure_inside_bundle(&bundle, &target)?;

        let bytes = general_purpose::STANDARD
            .decode(&base64_data)
            .map_err(|err| format!("Failed to decode bundle file: {err}"))?;
        if bytes.is_empty() {
            return Err("Bundle file content must not be empty".to_string());
        }
        if bytes.len() > MAX_BUNDLE_FILE_BYTES {
            return Err(format!(
                "Bundle file is too large: {} bytes",
                bytes.len()
            ));
        }

        fs::write(&target, &bytes)
            .map_err(|err| format!("Failed to write {}: {err}", target.display()))
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn finish_publish_bundle(
    bundle_path: String,
    manifest_json: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let temp_dir = PathBuf::from(bundle_path.trim());
        let key = temp_dir.to_string_lossy().to_string();
        if !lock_sessions().contains(&key) {
            return Err("Publish bundle session is no longer active".to_string());
        }

        let parsed: Value = serde_json::from_str(&manifest_json)
            .map_err(|err| format!("Publish manifest is not valid JSON: {err}"))?;
        if !parsed.is_object() {
            return Err("Publish manifest must be a JSON object".to_string());
        }

        let stem = bundle_stem_from_temp(
            &temp_dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string(),
        );
        let root = temp_dir
            .parent()
            .ok_or_else(|| "Publish bundle directory has no parent".to_string())?;

        fs::write(temp_dir.join("manifest.json"), manifest_json)
            .map_err(|err| format!("Failed to write publish manifest: {err}"))?;

        let final_dir = if root.join(&stem).exists() {
            let requested = root.join(&stem);
            if is_replaceable_bundle(&requested) {
                fs::remove_dir_all(&requested)
                    .map_err(|err| format!("Failed to replace previous bundle: {err}"))?;
                requested
            } else {
                resolve_final_bundle_path(root, &stem)
            }
        } else {
            root.join(&stem)
        };

        fs::rename(&temp_dir, &final_dir).map_err(|err| {
            let _ = fs::remove_dir_all(&temp_dir);
            format!("Failed to publish bundle: {err}")
        })?;

        lock_sessions().remove(&key);
        Ok(display_path(&final_dir))
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[tauri::command]
pub async fn cancel_publish_bundle(bundle_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let temp_dir = PathBuf::from(bundle_path.trim());
        let key = temp_dir.to_string_lossy().to_string();
        lock_sessions().remove(&key);

        let name = temp_dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if !name.contains(TEMP_MARKER) {
            return Err("Only an unfinished bundle may be cancelled".to_string());
        }
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)
                .map_err(|err| format!("Failed to remove unfinished bundle: {err}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("Task execution failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "markcard-bundle-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp bundle root");
        path
    }

    #[test]
    fn accepts_bundle_relative_paths() {
        assert_eq!(
            validate_relative_path("images/01.jpg").unwrap(),
            PathBuf::from("images").join("01.jpg")
        );
        assert_eq!(
            validate_relative_path("manifest.json").unwrap(),
            PathBuf::from("manifest.json")
        );
        assert_eq!(
            validate_relative_path("copy.md").unwrap(),
            PathBuf::from("copy.md")
        );
    }

    #[test]
    fn rejects_traversal_and_unsafe_bundle_paths() {
        assert!(validate_relative_path("").is_err());
        assert!(validate_relative_path("/etc/passwd").is_err());
        assert!(validate_relative_path("../escape.png").is_err());
        assert!(validate_relative_path("images/../../escape.png").is_err());
        assert!(validate_relative_path("images//01.jpg").is_err());
        assert!(validate_relative_path("images/sub/01.jpg").is_err());
        assert!(validate_relative_path("C:\\temp\\01.jpg").is_err());
        assert!(validate_relative_path("payload.exe").is_err());
        assert!(validate_relative_path("no_extension").is_err());
        assert!(validate_relative_path("scripts/run.md").is_err());
    }

    #[test]
    fn sanitizes_bundle_names_without_path_separators() {
        assert_eq!(sanitize_bundle_name("周末去山里"), "周末去山里");
        assert_eq!(sanitize_bundle_name("a/b\\c"), "a-b-c");
        assert_eq!(sanitize_bundle_name("  ../  "), "markcard-publish");
        assert_eq!(sanitize_bundle_name("post.md"), "post.md");
        assert_eq!(
            bundle_stem_from_temp(&temp_bundle_name("post-publish")),
            "post-publish"
        );
    }

    #[test]
    fn finishes_bundle_atomically_and_replaces_only_own_output() {
        let root = temp_root("finish");
        let temp_dir = root.join(temp_bundle_name("post-publish"));
        fs::create_dir_all(&temp_dir).unwrap();

        let foreign = root.join("post-publish");
        fs::create_dir_all(&foreign).unwrap();
        fs::write(foreign.join("keep.txt"), "user data").unwrap();

        let next = resolve_final_bundle_path(&root, "post-publish");
        fs::rename(&temp_dir, &next).unwrap();
        assert_ne!(next, foreign);
        assert!(foreign.join("keep.txt").exists());

        fs::write(
            foreign.join("manifest.json"),
            "{\"generator\":\"markcard-studio\"}",
        )
        .unwrap();
        assert!(is_replaceable_bundle(&foreign));

        fs::write(foreign.join("manifest.json"), "{\"generator\":\"someone-else\"}").unwrap();
        assert!(!is_replaceable_bundle(&foreign));

        fs::remove_dir_all(&root).unwrap();
    }
}
