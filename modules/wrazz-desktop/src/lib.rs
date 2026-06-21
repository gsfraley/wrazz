pub mod commands;
pub mod connect;
pub mod desktop_prefs;
pub mod server;
pub mod state;
pub mod workspace_config;
pub mod workspace_manager;

use std::sync::Arc;
use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Build a dedicated tokio runtime for the embedded server and setup work.
            // Tauri v2 uses its own runtime internally, but the setup closure is sync,
            // so we create one explicitly here and keep it alive in AppState.
            let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");

            // Load workspace config from the app data directory.
            let config_path = app
                .path()
                .app_data_dir()
                .expect("no app data dir")
                .join("workspaces.json");
            let workspace_config =
                workspace_config::WorkspaceConfig::load(&config_path).unwrap_or_default();

            // Build registry and populate from saved config.
            let registry = Arc::new(wrazz_backend::WorkspaceRegistry::new());
            rt.block_on(workspace_manager::init_registry(&registry, &workspace_config));

            let shared_config = Arc::new(tokio::sync::RwLock::new(workspace_config));
            let config_path = Arc::new(config_path);

            // Bind the axum server to an OS-assigned loopback port.
            let listener = rt
                .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
                .expect("failed to bind embedded server");
            let port = listener.local_addr().unwrap().port();

            // Load desktop preferences (button-side detection + any saved overrides).
            let desktop_prefs_path = Arc::new(
                app.path()
                    .app_data_dir()
                    .expect("no app data dir")
                    .join("desktop_prefs.json"),
            );
            let desktop_overrides = Arc::new(std::sync::RwLock::new(
                desktop_prefs::load_overrides(&desktop_prefs_path),
            ));
            let detected_button_side = Arc::new(desktop_prefs::detect_button_side());

            // Build connect state for tracking RFC 8252 nonces.
            let connect_state = Arc::new(connect::ConnectState::new());

            // Build the axum router.
            let app_handle = app.handle().clone();
            let router = server::build_router(
                Arc::clone(&registry),
                Arc::clone(&shared_config),
                Arc::clone(&config_path),
                Arc::clone(&connect_state),
                port,
                app_handle.clone(),
            );

            // Spawn the embedded server on the runtime.
            rt.spawn(async move {
                axum::serve(listener, router).await.expect("embedded server error");
            });

            // Store all shared state for IPC commands.
            app.manage(AppState {
                api_port: port,
                registry: Arc::clone(&registry),
                shared_config: Arc::clone(&shared_config),
                config_path: Arc::clone(&config_path),
                connect_state: Arc::clone(&connect_state),
                _runtime: Arc::new(rt),
                desktop_prefs_path: Arc::clone(&desktop_prefs_path),
                desktop_overrides: Arc::clone(&desktop_overrides),
                detected_button_side: Arc::clone(&detected_button_side),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_api_port,
            commands::pick_folder,
            commands::begin_connect,
            commands::get_desktop_prefs,
            commands::set_desktop_pref_overrides,
        ])
        .run(tauri::generate_context!())
        .expect("error while running wrazz desktop");
}
