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

    // Register the pending connect nonce.
    state.connect_state.pending.write().await.insert(
        nonce.clone(),
        crate::connect::PendingConnect {
            server_url: server_url.clone(),
            token_name: name.clone(),
            created_at: std::time::Instant::now(),
        },
    );

    let redirect_uri = format!("http://127.0.0.1:{}/connect/callback", state.api_port);
    let connect_url = format!(
        "{}/api/connect?name={}&redirect_uri={}&state={}",
        server_url.trim_end_matches('/'),
        urlencoding::encode(&name),
        urlencoding::encode(&redirect_uri),
        nonce,
    );

    // Open a popup WebviewWindow for the user to authorize.
    tauri::WebviewWindowBuilder::new(
        &app,
        "connect-popup",
        tauri::WebviewUrl::External(
            connect_url.parse::<url::Url>().map_err(|e| e.to_string())?,
        ),
    )
    .title("Authorize wrazz Desktop")
    .inner_size(600.0, 700.0)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}
