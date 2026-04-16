use tauri::Manager;

/// Tauri commands — thin bridge between the webview and wrazz-core/wrazz-extensions.
/// In local mode, these call core directly. In server mode, the frontend talks
/// to the remote server over HTTP and this layer is unused.

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let _ = app;
            // TODO: in local mode, start wrazz-server on a localhost port
            // and point the webview at it, so the frontend code is identical
            // in web and desktop modes.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running wrazz desktop");
}
