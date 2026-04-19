mod auth;
mod db;
mod oidc;
mod routes;
mod state;
mod store_cache;

use std::{sync::Arc, time::Duration};

use sqlx::postgres::PgPoolOptions;
use state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let data_dir: std::path::PathBuf =
        std::env::var("WRAZZ_DATA_DIR").unwrap_or_else(|_| "./data".into()).into();
    let bind = std::env::var("WRAZZ_BIND").unwrap_or_else(|_| "127.0.0.1:3001".into());
    let session_hours: i64 = std::env::var("WRAZZ_SESSION_HOURS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(24 * 7); // default: one week

    tokio::fs::create_dir_all(&data_dir).await?;

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    let store_cache = Arc::new(store_cache::StoreCache::new(&data_dir));

    let oidc_provider = build_oidc_provider().await;

    let state = AppState {
        pool: pool.clone(),
        store_cache: Arc::clone(&store_cache),
        data_dir,
        oidc_provider,
        session_duration: chrono::Duration::hours(session_hours),
    };

    // Background task: expire sessions and evict idle store entries hourly.
    {
        let pool = pool.clone();
        let store_cache = Arc::clone(&store_cache);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(3600));
            loop {
                interval.tick().await;
                match db::delete_expired_sessions(&pool).await {
                    Ok(n) if n > 0 => tracing::info!("cleaned up {n} expired sessions"),
                    Err(e) => tracing::warn!("session cleanup error: {e}"),
                    _ => {}
                }
                store_cache.evict_expired().await;
            }
        });
    }

    let app = routes::router(state);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on http://{bind}");
    axum::serve(listener, app).await?;

    Ok(())
}

/// Reads OIDC env vars and runs provider discovery. Returns `None` if any var
/// is missing or discovery fails (server still starts without OIDC).
async fn build_oidc_provider() -> Option<Arc<oidc::OidcProvider>> {
    let issuer_url = std::env::var("WRAZZ_OIDC_ISSUER_URL").ok()?;
    let client_id = std::env::var("WRAZZ_OIDC_CLIENT_ID").ok()?;
    let client_secret = std::env::var("WRAZZ_OIDC_CLIENT_SECRET").ok()?;
    let redirect_uri = std::env::var("WRAZZ_OIDC_REDIRECT_URI").ok()?;

    match oidc::OidcProvider::discover(issuer_url, client_id, client_secret, redirect_uri).await {
        Ok(provider) => {
            tracing::info!("OIDC provider configured");
            Some(Arc::new(provider))
        }
        Err(e) => {
            tracing::warn!("OIDC discovery failed, OIDC will be unavailable: {e}");
            None
        }
    }
}
