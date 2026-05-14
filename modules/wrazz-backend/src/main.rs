use std::sync::Arc;

use uuid::Uuid;
use wrazz_backend::{HttpBackend, LocalWorkspace, RegistryBackend, Store, WorkspaceRegistry};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let bind = std::env::var("WRAZZ_BIND").unwrap_or_else(|_| "127.0.0.1:3000".into());

    let (backend, workspace_id): (Arc<dyn wrazz_core::Backend>, String) =
        match std::env::var("WRAZZ_BACKEND_URL") {
            Ok(url) => {
                let workspace_id = std::env::var("WRAZZ_WORKSPACE_ID")
                    .unwrap_or_else(|_| Uuid::new_v4().to_string());
                tracing::info!("remote mode — proxying to {url}");
                (Arc::new(HttpBackend::new(url)), workspace_id)
            }
            Err(_) => {
                let data_dir =
                    std::env::var("WRAZZ_DATA_DIR").unwrap_or_else(|_| "./data".into());
                tokio::fs::create_dir_all(&data_dir).await?;
                let workspace_id = std::env::var("WRAZZ_WORKSPACE_ID")
                    .unwrap_or_else(|_| Uuid::new_v4().to_string());
                let workspace_name = std::env::var("WRAZZ_WORKSPACE_NAME")
                    .unwrap_or_else(|_| "Workspace".into());
                tracing::info!("local mode — data dir: {data_dir}, workspace: {workspace_id}");
                let registry = Arc::new(WorkspaceRegistry::new());
                let ws = Arc::new(LocalWorkspace::new(
                    &workspace_id,
                    &workspace_name,
                    Store::new(&data_dir),
                ));
                registry.add(ws).await;
                (Arc::new(RegistryBackend::new(registry)), workspace_id)
            }
        };

    let app = wrazz_backend::routes::router(backend, workspace_id);

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on http://{bind}");
    axum::serve(listener, app).await?;

    Ok(())
}
