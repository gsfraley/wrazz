//! Multi-user server binary for wrazz.
//!
//! `wrazz-server` is the SQLite-backed deployment target for self-hosted
//! installations that need multiple user accounts.
//!
//! # What it adds over `wrazz-backend`
//!
//! - **Users** — each user gets their own isolated file tree under
//!   `WRAZZ_DATA_DIR/<user-uuid>/<workspace-uuid>/`.
//! - **Workspaces** — each user can have multiple named workspaces.
//! - **Auth** — password login (argon2) and OIDC (any OpenID Connect provider).
//! - **Sessions** — opaque UUID session tokens stored in SQLite, delivered
//!   as `HttpOnly` cookies.
//! - **Filesystem migrations** — versioned migrations tracked in `.migrated`.

pub mod db;
pub mod migrate;
pub mod routes;
pub mod server_workspace;
pub mod state;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An authenticated wrazz account.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
    pub is_admin: bool,
    pub email: Option<String>,
}
