mod api;

use std::sync::Arc;

use anyhow::Result;
use axum::Router;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use wrazz_core::store::Store;
use wrazz_extensions::host::ExtensionHost;

pub struct AppState {
    pub store: Store,
    pub extensions: ExtensionHost,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let data_dir = std::env::var("WRAZZ_DATA_DIR").unwrap_or_else(|_| "data".into());
    let extensions_dir =
        std::env::var("WRAZZ_EXTENSIONS_DIR").unwrap_or_else(|_| "extensions".into());
    let bind_addr = std::env::var("WRAZZ_BIND").unwrap_or_else(|_| "0.0.0.0:3000".into());

    let store = Store::open(&data_dir).await?;

    let mut extensions = ExtensionHost::new();
    extensions.load_from_dir(&extensions_dir)?;

    let state = Arc::new(AppState { store, extensions });

    let app = Router::new()
        .nest("/api", api::router())
        .layer(CorsLayer::permissive())
        .with_state(state);

    tracing::info!("listening on {bind_addr}");
    let listener = TcpListener::bind(&bind_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
