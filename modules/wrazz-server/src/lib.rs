//! Multi-user server binary for wrazz.
//!
//! `wrazz-server` is the Postgres-backed deployment target for teams or
//! self-hosted installations that need multiple accounts. It is deliberately
//! opinionated: no database abstraction layer, Postgres only.
//!
//! # What it adds over `wrazz-backend`
//!
//! - **Users** — each user gets their own isolated file tree under
//!   `WRAZZ_DATA_DIR/<user-uuid>/`.
//! - **Auth** — password login (argon2) and OIDC (any OpenID Connect
//!   provider; tested with Authentik). Both auth methods coexist per user.
//! - **Sessions** — opaque UUID session tokens stored in Postgres, delivered
//!   as `HttpOnly` cookies.
//!
//! # Public types
//!
//! Only [`User`] is exported from the library target. Everything else
//! (handlers, state, DB queries) lives in the binary's own module tree and
//! is not part of any public API.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An authenticated wrazz account.
///
/// Users are identified by a stable UUID that is also used as the name of
/// their data directory. Auth credentials (password hash or OIDC subject)
/// live in a separate `user_auth_providers` table so a single account can
/// have multiple login methods.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
    /// Whether this account has administrative privileges.
    ///
    /// Admins can create new user accounts (`POST /api/user`) and look up
    /// any user by ID. The first admin is provisioned at startup via
    /// `WRAZZ_BOOTSTRAP_ADMIN`.
    pub is_admin: bool,
    /// Contact email. Used as a fallback key for linking OIDC logins to
    /// existing password accounts: if an OIDC sub claim is unrecognised, the
    /// callback matches by email and links the provider rather than creating
    /// a new account.
    pub email: Option<String>,
}
