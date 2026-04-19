use std::{path::PathBuf, sync::Arc};

use chrono::Duration;
use sqlx::PgPool;

use crate::oidc::OidcProvider;
use crate::store_cache::StoreCache;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub store_cache: Arc<StoreCache>,
    /// Root data directory. Per-user directories are `<data_dir>/<user_id>/`.
    pub data_dir: PathBuf,
    /// None when OIDC env vars are absent.
    pub oidc_provider: Option<Arc<OidcProvider>>,
    pub session_duration: Duration,
}
