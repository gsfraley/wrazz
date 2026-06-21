//! Axum router assembly.
//!
//! Open routes:
//! - `GET  /api/version`
//! - `POST /api/auth/login`, `POST /api/auth/logout`
//! - `GET  /api/auth/oidc/redirect`, `GET /api/auth/oidc/callback`, `GET /api/auth/oidc/status`
//!
//! Authenticated routes (require valid session cookie or Bearer token):
//! - User: `POST/GET/PUT /api/user`, `GET /api/user/{handle}`
//! - Admin: `GET/PUT/DELETE /api/admin/oidc`, `GET /api/admin/users`, `DELETE /api/admin/users/{id}`
//!
//! Token management (session cookie required):
//! - `GET    /api/connect`      — connect approval page
//! - `POST   /api/connect`      — issue token after approval
//! - `GET    /api/tokens`       — list tokens
//! - `DELETE /api/tokens/{id}`  — delete a token
//!
//! Workspace CRUD (authenticated):
//! - `GET    /api/workspaces`
//! - `POST   /api/workspaces`
//! - `GET    /api/workspaces/{id}`
//! - `PATCH  /api/workspaces/{id}`
//! - `DELETE /api/workspaces/{id}`
//!
//! Workspace file routes (authenticated, workspace-scoped):
//! - `GET    /api/workspaces/{id}/entries`
//! - `DELETE /api/workspaces/{id}/entries/{*path}`
//! - `PATCH  /api/workspaces/{id}/entries/{*path}`
//! - `GET    /api/workspaces/{id}/files/{*path}`
//! - `POST   /api/workspaces/{id}/files/{*path}`
//! - `PUT    /api/workspaces/{id}/files/{*path}`
//! - `GET    /api/workspaces/{id}/content/{*path}`
//! - `POST   /api/workspaces/{id}/dirs/{*path}`
//! - `GET    /api/workspaces/{id}/export/file/{*path}`
//! - `GET    /api/workspaces/{id}/export/dir`
//! - `GET    /api/workspaces/{id}/export/dir/{*path}`

pub mod admin;
pub mod auth;
pub mod export;
pub mod files;
pub mod oidc;
pub mod tokens;
pub mod user;
pub mod version;
pub mod workspaces;

use axum::{
    Router,
    routing::{delete, get, post},
};
use tower_http::{cors::CorsLayer, services::{ServeDir, ServeFile}};

use crate::state::AppState;

pub fn router(state: AppState, static_dir: Option<String>) -> Router {
    let auth_routes = Router::new()
        .route("/login", post(auth::login))
        .route("/logout", post(auth::logout))
        .route("/oidc/redirect", get(oidc::oidc_redirect))
        .route("/oidc/callback", get(oidc::oidc_callback))
        .route("/oidc/status", get(oidc::oidc_status));

    let user_routes = Router::new()
        .route("/user", post(user::create_user))
        .route("/user/self", get(user::get_user_self).put(user::update_user_self))
        .route("/user/{handle}", get(user::get_user_by_handle));

    let admin_routes = Router::new()
        .route("/admin/oidc",
            get(admin::get_oidc).put(admin::put_oidc).delete(admin::delete_oidc))
        .route("/admin/users", get(admin::list_users))
        .route("/admin/users/{id}", delete(admin::delete_user));

    let token_routes = Router::new()
        .route("/connect",
            get(tokens::connect_approval_page).post(tokens::connect_submit))
        .route("/tokens", get(tokens::list_tokens))
        .route("/tokens/{id}", delete(tokens::delete_token));

    // Per-workspace file/export operations, nested under /{workspace_id}/.
    let workspace_ops = Router::new()
        .route("/entries", get(files::list_entries))
        .route("/entries/{*path}", delete(files::delete_entry).patch(files::move_entry))
        .route("/files/{*path}",
            post(files::create_file).get(files::get_file).put(files::update_file))
        .route("/content/{*path}", get(files::get_file_content))
        .route("/dirs/{*path}", post(files::create_dir))
        .route("/export/file/{*path}", get(export::export_file))
        .route("/export/dir", get(export::export_dir_root))
        .route("/export/dir/{*path}", get(export::export_dir));

    let workspace_routes = Router::new()
        .route("/workspaces", get(workspaces::list_workspaces).post(workspaces::create_workspace))
        .route("/workspaces/{workspace_id}",
            get(workspaces::get_workspace)
            .patch(workspaces::rename_workspace)
            .delete(workspaces::delete_workspace))
        .nest("/workspaces/{workspace_id}", workspace_ops);

    let api = Router::new()
        .route("/version", get(version::get_version))
        .nest("/auth", auth_routes)
        .merge(user_routes)
        .merge(admin_routes)
        .merge(token_routes)
        .merge(workspace_routes);

    let base = Router::new()
        .nest("/api/v1", api)
        .layer(CorsLayer::permissive())
        .with_state(state);

    match static_dir {
        Some(dir) => base.fallback_service(
            ServeDir::new(&dir).fallback(ServeFile::new(format!("{dir}/index.html"))),
        ),
        None => base,
    }
}
