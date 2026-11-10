#[cfg(target_os = "android")]
mod android_bridge;
mod commands;
mod dns;
mod error;
mod ie;
mod monitor;
mod netinfo;
mod ping;
mod settings;
mod speedtest;
mod state;
mod storage;
mod system;
mod trace;
mod wifi;

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::WindowEvent;
use tauri::{AppHandle, Manager};

#[cfg(desktop)]
use settings::Language;
use settings::Theme;
use state::AppState;

/// Native Mica backdrop (Windows 11), falling back to Acrylic on older builds.
/// Mobile has no window chrome: the page paints its own background.
#[cfg(not(windows))]
pub(crate) fn apply_window_effects(_app: &AppHandle, _theme: Theme) {}

#[cfg(windows)]
pub(crate) fn apply_window_effects(app: &AppHandle, theme: Theme) {
    let Some(window) = app.get_webview_window("main") else { return };
    let dark = match theme {
        Theme::Dark => Some(true),
        Theme::Light => Some(false),
        Theme::System => None,
    };
    let tauri_theme = dark.map(|d| if d { tauri::Theme::Dark } else { tauri::Theme::Light });
    let _ = window.set_theme(tauri_theme);
    if window_vibrancy::apply_mica(&window, dark).is_err() {
        let tint = if dark == Some(false) { (238, 242, 250, 160) } else { (12, 16, 34, 160) };
        let _ = window_vibrancy::apply_acrylic(&window, Some(tint));
    }
}

#[cfg(desktop)]
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn build_tray(app: &AppHandle, language: Language) -> tauri::Result<()> {
    let (show_label, quit_label) = match language {
        Language::Cs => ("Otevřít Wifinatio", "Ukončit"),
        Language::En => ("Open Wifinatio", "Quit"),
    };
    let show = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Wifinatio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let storage = storage::Storage::open(&data_dir.join("wifinatio.db"))?;
            storage.close_dangling_events()?;
            let state = AppState::new(storage);
            let settings = state.settings.read().clone();
            let hub = state.hub.clone();
            app.manage(state);

            let handle = app.handle().clone();
            apply_window_effects(&handle, settings.theme);
            #[cfg(desktop)]
            build_tray(&handle, settings.language)?;
            hub.restart(handle.clone(), ping::default_targets(&settings.custom_targets), settings.ping_interval_ms);
            monitor::start(handle, hub);
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state.settings.read().run_in_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(mobile)]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::set_window_theme,
            commands::get_wifi_status,
            commands::get_ping_history,
            commands::get_networks,
            commands::scan_networks,
            commands::get_netinfo,
            commands::get_public_info,
            commands::check_ipv6,
            commands::test_mtu,
            commands::run_dns_test,
            commands::run_traceroute,
            commands::run_speedtest,
            commands::cancel_speedtest,
            commands::list_speedtests,
            commands::list_events,
            commands::save_snapshot,
            commands::list_snapshots,
            commands::delete_snapshot,
            commands::save_report,
            commands::list_reports,
            commands::clear_history,
            commands::get_system_checks,
            commands::open_settings_page,
            commands::write_text_file,
            commands::save_download,
            commands::request_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wifinatio");
}
