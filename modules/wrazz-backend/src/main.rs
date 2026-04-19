mod routes;

use std::sync::Arc;

use wrazz_backend::{HttpBackend, LocalBackend, Store};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let bind = std::env::var("WRAZZ_BIND").unwrap_or_else(|_| "127.0.0.1:3000".into());

    // If WRAZZ_BACKEND_URL is set, proxy to a remote backend over HTTP.
    // Otherwise, run all-in-one with a local store.
    let backend: Arc<dyn wrazz_core::Backend> = match std::env::var("WRAZZ_BACKEND_URL") {
        Ok(url) => {
            tracing::info!("remote mode — proxying to {url}");
            Arc::new(HttpBackend::new(url))
        }
        Err(_) => {
            let data_dir = std::env::var("WRAZZ_DATA_DIR").unwrap_or_else(|_| "./data".into());
            tokio::fs::create_dir_all(&data_dir).await?;
            tracing::info!("local mode — data dir: {data_dir}");
            Arc::new(LocalBackend::new(Store::new(&data_dir)))
        }
    };

    let app = routes::router(backend);

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on http://{bind}");
    axum::serve(listener, app).await?;

    Ok(())
}
