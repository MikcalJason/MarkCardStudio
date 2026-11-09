mod assets;
mod channels;
mod files;
mod publish;
mod qr_preview;
mod wechat;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
const CONFIRM_QUIT_MENU_ID: &str = "confirm-quit";

struct ExitState {
    approved: AtomicBool,
}

fn request_application_close(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.emit("app-exit-requested", ());
    }
}

#[cfg(target_os = "macos")]
fn build_macos_menu(app_handle: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};

    let menu = Menu::default(app_handle)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let item_count = app_menu.items()?.len();
        if item_count > 0 {
            app_menu.remove_at(item_count - 1)?;
            let quit_item = MenuItem::with_id(
                app_handle,
                CONFIRM_QUIT_MENU_ID,
                "Quit MarkCard Studio",
                true,
                Some("CmdOrCtrl+Q"),
            )?;
            app_menu.append(&quit_item)?;
        }
    }

    Ok(menu)
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn exit_application(app: tauri::AppHandle, state: tauri::State<'_, ExitState>) {
    state.approved.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().manage(ExitState {
        approved: AtomicBool::new(false),
    });

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(build_macos_menu)
        .on_menu_event(|app_handle, event| {
            if event.id() == CONFIRM_QUIT_MENU_ID {
                request_application_close(app_handle);
            }
        });

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            files::open_markdown_file,
            files::pick_markdown_file,
            files::read_markdown_file,
            files::save_markdown_file,
            files::write_markdown_file,
            files::resolve_local_image,
            files::resolve_remote_image,
            files::pick_export_folder,
            files::get_default_export_folder,
            files::save_export_file,
            files::open_export_folder,
            files::open_external_url,
            publish::bundle::get_publish_bundle_root,
            publish::bundle::begin_publish_bundle,
            publish::bundle::append_publish_bundle_file,
            publish::bundle::finish_publish_bundle,
            publish::bundle::cancel_publish_bundle,
            publish::bridge::publish_bridge_start,
            publish::bridge::publish_bridge_status,
            publish::bridge::publish_bridge_stop,
            files::import_custom_font,
            files::list_custom_fonts,
            files::read_custom_font,
            files::delete_custom_font,
            assets::pick_asset_files,
            assets::pick_asset_folder,
            assets::scan_image_folder,
            channels::set_channel_credentials,
            channels::channel_credentials_status,
            channels::clear_channel_credentials,
            channels::set_channel_proxy,
            channels::channel_proxy_status,
            channels::clear_channel_proxy,
            channels::test_channel_credentials,
            channels::fetch_public_ip,
            channels::probe_channel_permissions,
            wechat::publish_wechat_draft_from_bundle,
            assets::read_asset_library,
            assets::write_asset_library,
            assets::store_asset_file,
            assets::read_asset_file,
            assets::mirror_asset,
            assets::delete_asset_file,
            qr_preview::qr_preview_start,
            qr_preview::qr_preview_stats,
            qr_preview::qr_preview_stop,
            exit_application
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if app_handle
                .state::<ExitState>()
                .approved
                .load(Ordering::SeqCst)
            {
                return;
            }

            api.prevent_exit();
            request_application_close(app_handle);
        }
    });
}
