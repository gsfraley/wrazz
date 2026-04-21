/// Assembles the full Axum router.
///
/// Auth routes (open):
/// - `POST /api/auth/login`, `POST /api/auth/logout`
/// - `GET  /api/auth/oidc/redirect`, `GET /api/auth/oidc/callback`
///
/// User routes (authenticated / admin):
/// - `POST /api/user` — admin only
/// - `GET  /api/user/self`, `GET /api/user/{handle}` — authenticated
///
/// File and directory routes (authenticated, workspace-implicit):
/// - `GET    /api/entries?path=<path>`  — list directory
/// - `DELETE /api/entries/{*path}`      — delete file or directory
/// - `POST   /api/entries/move`         — move/rename
/// - `GET    /api/files/{*path}`        — file metadata
/// - `GET    /api/content/{*path}`      — file content
/// - `POST   /api/files`               — create file
/// - `PUT    /api/files/{*path}`        — update file
/// - `POST   /api/dirs`                — create directory
pub mod auth;
pub mod files;
pub mod oidc;
pub mod user;

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
        .route("/oidc/callback", get(oidc::oidc_callback));

    let user_routes = Router::new()
        .route("/user", post(user::create_user))
        .route("/user/self", get(user::get_user_self))
        .route("/user/{handle}", get(user::get_user_by_handle));

    let entry_routes = Router::new()
        .route("/entries", get(files::list_entries))
        .route("/entries/{*path}", delete(files::delete_entry).patch(files::move_entry));

    let file_routes = Router::new()
        .route("/files/{*path}", post(files::create_file).get(files::get_file).put(files::update_file));

    let content_routes = Router::new()
        .route("/content/{*path}", get(files::get_file_content));

    let dir_routes = Router::new()
        .route("/dirs/{*path}", post(files::create_dir));

    let api = Router::new()
        .nest("/auth", auth_routes)
        .merge(user_routes)
        .merge(entry_routes)
        .merge(file_routes)
        .merge(content_routes)
        .merge(dir_routes);

    let base = Router::new()
        .nest("/api", api)
        .layer(CorsLayer::permissive())
        .with_state(state);

    match static_dir {
        Some(dir) => base.fallback_service(
            ServeDir::new(&dir).fallback(ServeFile::new(format!("{dir}/index.html"))),
        ),
        None => base,
    }
}
