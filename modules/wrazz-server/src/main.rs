mod db;
mod routes;
mod state;
mod store_cache;

use std::{sync::Arc, time::Duration};

use argon2::{
    Argon2, PasswordHasher,
    password_hash::{SaltString, rand_core::OsRng},
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let data_dir: std::path::PathBuf =
        std::env::var("WRAZZ_DATA_DIR").unwrap_or_else(|_| "./data".into()).into();
    let bind = std::env::var("WRAZZ_BIND").unwrap_or_else(|_| "127.0.0.1:3001".into());
    let static_dir = std::env::var("WRAZZ_STATIC_DIR").ok();
    let session_hours: i64 = std::env::var("WRAZZ_SESSION_HOURS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(24 * 7); // default: one week

    tokio::fs::create_dir_all(&data_dir).await?;

    let db_path = data_dir.join("db.sqlite");
    let connect_opts = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_opts)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    maybe_bootstrap_admin(&pool).await;

    let store_cache = Arc::new(store_cache::StoreCache::new(&data_dir));

    let oidc_provider = build_oidc_provider().await;

    let state = AppState {
        pool: pool.clone(),
        store_cache: Arc::clone(&store_cache),
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

    let app = routes::router(state, static_dir);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on http://{bind}");
    axum::serve(listener, app).await?;

    Ok(())
}

/// Creates the first admin account from `WRAZZ_BOOTSTRAP_ADMIN=username:password`
/// if the env var is set and no admin users exist yet.
async fn maybe_bootstrap_admin(pool: &sqlx::SqlitePool) {
    let raw = match std::env::var("WRAZZ_BOOTSTRAP_ADMIN") {
        Ok(v) => v,
        Err(_) => return,
    };

    let (username, password) = match raw.split_once(':') {
        Some(pair) => pair,
        None => {
            tracing::warn!("WRAZZ_BOOTSTRAP_ADMIN must be 'username:password', skipping");
            return;
        }
    };

    match db::has_any_admin(pool).await {
        Ok(true) => {
            tracing::debug!("admin already exists, skipping bootstrap");
            return;
        }
        Err(e) => {
            tracing::warn!("could not check for existing admins: {e}");
            return;
        }
        Ok(false) => {}
    }

    let salt = SaltString::generate(&mut OsRng);
    let hash = match Argon2::default().hash_password(password.as_bytes(), &salt) {
        Ok(h) => h.to_string(),
        Err(e) => {
            tracing::warn!("could not hash bootstrap admin password: {e}");
            return;
        }
    };

    match db::create_user_with_password(pool, username, username, &hash, true).await {
        Ok(u) => tracing::info!("bootstrapped admin user '{}' ({})", username, u.id),
        Err(e) => tracing::warn!("could not create bootstrap admin: {e}"),
    }
}

/// Reads the four `WRAZZ_OIDC_*` env vars and runs provider discovery.
async fn build_oidc_provider() -> Option<Arc<routes::oidc::OidcProvider>> {
    let issuer_url = std::env::var("WRAZZ_OIDC_ISSUER_URL").ok()?;
    let client_id = std::env::var("WRAZZ_OIDC_CLIENT_ID").ok()?;
    let client_secret = std::env::var("WRAZZ_OIDC_CLIENT_SECRET").ok()?;
    let redirect_uri = std::env::var("WRAZZ_OIDC_REDIRECT_URI").ok()?;

    match routes::oidc::OidcProvider::discover(issuer_url, client_id, client_secret, redirect_uri).await {
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
