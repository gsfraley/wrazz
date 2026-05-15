use tauri::{command, AppHandle, State};
use crate::state::AppState;

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
