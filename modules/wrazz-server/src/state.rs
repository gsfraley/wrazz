use std::sync::Arc;

use chrono::Duration;
use sqlx::SqlitePool;
use tokio::sync::RwLock;

use crate::routes::oidc::OidcProvider;
use crate::store_cache::StoreCache;

/// Shared server state injected into every Axum handler via [`State`].
///
/// `AppState` is cheap to clone — all heavy resources are behind `Arc`.
/// `oidc_provider` is behind `Arc<RwLock<...>>` so the admin UI can hot-swap
/// the provider at runtime without a server restart.
///
/// [`State`]: axum::extract::State
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub store_cache: Arc<StoreCache>,
    /// Hot-swappable OIDC provider. `None` when OIDC is not configured or
    /// discovery failed. The admin API writes through this lock; OIDC request
    /// handlers clone the inner `Arc` and release the lock before awaiting.
    pub oidc_provider: Arc<RwLock<Option<Arc<OidcProvider>>>>,
    pub session_duration: Duration,
    /// The public base URL of this instance (e.g. `https://wrazz.home.fraley.dev`),
    /// set via `WRAZZ_PUBLIC_URL`. Used to suggest the OIDC redirect URI in the UI.
    pub public_url: Option<String>,
}
