use std::{path::PathBuf, sync::Arc};

use chrono::Duration;
use sqlx::PgPool;

use crate::oidc::OidcProvider;
use crate::store_cache::StoreCache;

/// Shared server state injected into every Axum handler via [`State`].
///
/// `AppState` is cheap to clone (all heavy resources are behind `Arc` or are
/// themselves clone-by-reference like `PgPool`), so each handler receives its
/// own copy rather than a shared reference.
///
/// [`State`]: axum::extract::State
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub store_cache: Arc<StoreCache>,
    /// Root data directory. Per-user directories are `<data_dir>/<user_id>/`.
    pub data_dir: PathBuf,
    /// `None` when the `WRAZZ_OIDC_*` env vars are absent or discovery fails.
    /// OIDC routes return `501 Not Implemented` in that case.
    pub oidc_provider: Option<Arc<OidcProvider>>,
    pub session_duration: Duration,
}
