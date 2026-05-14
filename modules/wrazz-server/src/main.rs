use std::{path::PathBuf, sync::Arc};

use argon2::{
    Argon2, PasswordHasher,
    password_hash::{SaltString, rand_core::OsRng},
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tokio::sync::RwLock;
use wrazz_backend::WorkspaceRegistry;

use wrazz_server::db;
use wrazz_server::migrate;
use wrazz_server::routes;
use wrazz_server::routes::oidc::OidcProvider;
use wrazz_server::state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let data_dir: PathBuf =
        std::env::var("WRAZZ_DATA_DIR").unwrap_or_else(|_| "./data".into()).into();
    let bind = std::env::var("WRAZZ_BIND").unwrap_or_else(|_| "127.0.0.1:3001".into());
    let static_dir = std::env::var("WRAZZ_STATIC_DIR").ok();
    let public_url = std::env::var("WRAZZ_PUBLIC_URL").ok();
    let session_hours: i64 = std::env::var("WRAZZ_SESSION_HOURS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(24 * 7);

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

    // Run filesystem migrations (e.g. workspace directory nesting).
    if let Err(e) = migrate::run(&data_dir, &pool).await {
        tracing::error!("filesystem migration failed: {e}");
        return Err(e.into());
    }

    let workspace_registry = Arc::new(WorkspaceRegistry::new());
    let oidc_provider = Arc::new(RwLock::new(build_oidc_provider(&pool).await));

    let state = AppState {
        pool: pool.clone(),
        workspace_registry: Arc::clone(&workspace_registry),
        data_dir: Arc::new(data_dir),
        oidc_provider,
        session_duration: chrono::Duration::hours(session_hours),
        public_url,
    };

    // Background task: expire sessions hourly.
    {
        let pool = pool.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
            loop {
                interval.tick().await;
                match db::delete_expired_sessions(&pool).await {
                    Ok(n) if n > 0 => tracing::info!("cleaned up {n} expired sessions"),
                    Err(e) => tracing::warn!("session cleanup error: {e}"),
                    _ => {}
                }
            }
        });
    }

    let app = routes::router(state, static_dir);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on http://{bind}");
    axum::serve(listener, app).await?;

    Ok(())
}

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
        Ok(true) => { tracing::debug!("admin already exists, skipping bootstrap"); return; }
        Err(e) => { tracing::warn!("could not check for existing admins: {e}"); return; }
        Ok(false) => {}
    }

    let salt = SaltString::generate(&mut OsRng);
    let hash = match Argon2::default().hash_password(password.as_bytes(), &salt) {
        Ok(h) => h.to_string(),
        Err(e) => { tracing::warn!("could not hash bootstrap admin password: {e}"); return; }
    };

    match db::create_user_with_password(pool, username, username, &hash, true).await {
        Ok(u) => tracing::info!("bootstrapped admin user '{}' ({})", username, u.id),
        Err(e) => tracing::warn!("could not create bootstrap admin: {e}"),
    }
}

async fn build_oidc_provider(pool: &sqlx::SqlitePool) -> Option<Arc<OidcProvider>> {
    if let (Ok(issuer), Ok(client_id), Ok(secret), Ok(redirect_uri)) = (
        std::env::var("WRAZZ_OIDC_ISSUER_URL"),
        std::env::var("WRAZZ_OIDC_CLIENT_ID"),
        std::env::var("WRAZZ_OIDC_CLIENT_SECRET"),
        std::env::var("WRAZZ_OIDC_REDIRECT_URI"),
    ) {
        return match OidcProvider::discover(issuer, client_id, secret, redirect_uri).await {
            Ok(p) => { tracing::info!("OIDC configured from env"); Some(Arc::new(p)) }
            Err(e) => { tracing::warn!("OIDC env discovery failed: {e}"); None }
        };
    }

    match db::get_oidc_config(pool).await {
        Ok(Some(c)) if c.enabled => {
            match OidcProvider::discover(c.issuer_url, c.client_id, c.client_secret, c.redirect_uri).await {
                Ok(p) => { tracing::info!("OIDC configured from database"); Some(Arc::new(p)) }
                Err(e) => { tracing::warn!("OIDC DB discovery failed: {e}"); None }
            }
        }
        Ok(_) => None,
        Err(e) => { tracing::warn!("failed to read OIDC config: {e}"); None }
    }
}
