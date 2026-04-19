mod routes;

use std::sync::Arc;

use wrazz_backend::Store;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let data_dir = std::env::var("WRAZZ_DATA_DIR").unwrap_or_else(|_| "./data".into());
    let bind = std::env::var("WRAZZ_BIND").unwrap_or_else(|_| "127.0.0.1:3000".into());

    tokio::fs::create_dir_all(&data_dir).await?;

    let app = routes::router(Arc::new(Store::new(&data_dir)));

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on http://{bind}");
    axum::serve(listener, app).await?;

    Ok(())
}
