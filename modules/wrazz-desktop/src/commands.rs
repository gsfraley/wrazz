use tauri::{command, AppHandle, State};
use crate::{desktop_prefs, state::AppState};

#[command]
pub fn get_api_port(state: State<AppState>) -> u16 {
    state.api_port
}

#[command]
pub async fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    folder.map(|p| p.to_string())
}

#[command]
pub async fn begin_connect(
    state: State<'_, AppState>,
    app: AppHandle,
    server_url: String,
    name: String,
) -> Result<(), String> {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let nonce = hex::encode(bytes);

    let api_port = state.api_port;
    state.connect_state.pending.write().await.insert(
        nonce.clone(),
        crate::connect::PendingConnect {
            server_url: server_url.clone(),
            token_name: name.clone(),
            created_at: std::time::Instant::now(),
        },
    );

    let redirect_uri = format!("http://127.0.0.1:{api_port}/connect/callback");
    let connect_url = format!(
        "{}/api/v1/connect?name={}&redirect_uri={}&state={}",
        server_url.trim_end_matches('/'),
        urlencoding::encode(&name),
        urlencoding::encode(&redirect_uri),
        nonce,
    );

    let url = connect_url.parse::<url::Url>().map_err(|e| e.to_string())?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let app_clone = app.clone();
    app.run_on_main_thread(move || {
        let result = tauri::WebviewWindowBuilder::new(
            &app_clone,
            "connect-popup",
            tauri::WebviewUrl::External(url),
        )
        .title("Authorize wrazz Desktop")
        .inner_size(600.0, 700.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string());
        tx.send(result).ok();
    })
    .map_err(|e| e.to_string())?;

    rx.recv().unwrap_or_else(|_| Err("channel error".to_string()))
}

#[command]
pub fn get_desktop_prefs(state: State<AppState>) -> desktop_prefs::DesktopPrefs {
    let overrides = state.desktop_overrides.read().unwrap();
    desktop_prefs::compute_prefs(&state.detected_button_side, &overrides)
}

#[command]
pub fn set_desktop_pref_overrides(
    state: State<AppState>,
    button_side: Option<String>,
) -> Result<desktop_prefs::DesktopPrefs, String> {
    let new_overrides = desktop_prefs::DesktopPrefOverrides { button_side };
    desktop_prefs::save_overrides(&state.desktop_prefs_path, &new_overrides)?;
    let mut lock = state.desktop_overrides.write().map_err(|_| "lock poisoned".to_string())?;
    *lock = new_overrides;
    Ok(desktop_prefs::compute_prefs(&state.detected_button_side, &lock))
}
