/// Assembles the full Axum router.
///
/// - `POST /api/auth/login`, `POST /api/auth/logout` — open
/// - `GET /api/auth/oidc/redirect`, `GET /api/auth/oidc/callback` — open
/// - `POST /api/user` — admin only
/// - `GET /api/user/self`, `GET /api/user/id:<uuid>` — authenticated
/// - `GET|POST /api/files`, `GET|PUT|DELETE /api/files/{id}` — authenticated
pub mod auth;
pub mod files;
pub mod oidc;
pub mod user;

use axum::{
    Router,
    routing::{get, post},
};
use tower_http::{cors::CorsLayer, services::{ServeDir, ServeFile}};

use crate::state::AppState;

/// `static_dir` is the path to the built frontend assets. When `Some`, all
/// requests that don't match an API route fall through to `ServeDir`, with
/// `index.html` as the fallback so client-side routing works correctly.
pub fn router(state: AppState, static_dir: Option<String>) -> Router {
    let auth_routes = Router::new()
        .route("/login", post(auth::login))
        .route("/logout", post(auth::logout))
        .route("/oidc/redirect", get(oidc::oidc_redirect))
        .route("/oidc/callback", get(oidc::oidc_callback));

    // Static segment (/self) must be registered before the parameterised one
    // (/{handle}) so axum's router gives it priority.
    let user_routes = Router::new()
        .route("/user", post(user::create_user))
        .route("/user/self", get(user::get_user_self))
        .route("/user/{handle}", get(user::get_user_by_handle));

    let file_routes = Router::new()
        .route("/files", get(files::list_files).post(files::create_file))
        .route(
            "/files/{id}",
            get(files::get_file)
                .put(files::update_file)
                .delete(files::delete_file),
        );

    let api = Router::new()
        .nest("/auth", auth_routes)
        .merge(user_routes)
        .merge(file_routes);

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
