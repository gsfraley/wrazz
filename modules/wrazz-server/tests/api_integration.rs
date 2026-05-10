use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use axum::response::Response;
use serde_json::{Value, json};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tempfile::TempDir;
use tokio::sync::RwLock;
use tower::ServiceExt;
use wrazz_server::{db, routes, state::AppState, store_cache::StoreCache};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Spin up a fresh router backed by an isolated temp-file SQLite database
/// and a temp data directory.  Returns the router, the `TempDir` guard
/// (keeps the directory alive for the duration of the test), and the UUID
/// string of the seeded admin user.
async fn setup() -> (axum::Router, TempDir, String) {
    let data_dir = TempDir::new().unwrap();

    let db_file = data_dir.path().join("test.sqlite");
    let opts = SqliteConnectOptions::new()
        .filename(&db_file)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .unwrap();

    sqlx::migrate!("./migrations").run(&pool).await.unwrap();

    // Seed a known admin user.
    let password_hash = hash_password("testpass");
    let user = db::create_user_with_password(
        &pool,
        "Test User",  // display_name
        "testuser",   // username (password subject)
        &password_hash,
        true,         // is_admin
    )
    .await
    .unwrap();

    let store_cache = Arc::new(StoreCache::new(data_dir.path()));

    let state = AppState {
        pool,
        store_cache,
        oidc_provider: Arc::new(RwLock::new(None)),
        session_duration: chrono::Duration::hours(1),
        public_url: None,
    };

    let app = routes::router(state, None);
    (app, data_dir, user.id.to_string())
}

fn hash_password(password: &str) -> String {
    use argon2::{
        Argon2, PasswordHasher,
        password_hash::{SaltString, rand_core::OsRng},
    };
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .unwrap()
        .to_string()
}

async fn body_json(resp: Response) -> Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

/// POST /api/auth/login and return (status, Set-Cookie header value).
async fn login(
    app: &axum::Router,
    username: &str,
    password: &str,
) -> (StatusCode, Option<String>) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "username": username, "password": password }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let status = resp.status();
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    (status, cookie)
}

/// Extract just the `name=value` pair from a `Set-Cookie` header value so it
/// can be sent back as a `Cookie` request header.
fn cookie_pair(set_cookie: &str) -> String {
    set_cookie
        .split(';')
        .next()
        .unwrap_or(set_cookie)
        .trim()
        .to_string()
}

fn authed_get(uri: &str, cookie: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap()
}

fn authed_with_body(method: &str, uri: &str, cookie: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn authed_delete(uri: &str, cookie: &str) -> Request<Body> {
    Request::builder()
        .method("DELETE")
        .uri(uri)
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// GET /api/version returns 200 with a version string — no auth required.
#[tokio::test]
async fn get_version_no_auth() {
    let (app, _dir, _uid) = setup().await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/version")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert!(
        body["version"].is_string(),
        "expected a version string, got: {body}"
    );
    assert!(
        !body["version"].as_str().unwrap().is_empty(),
        "version must not be empty"
    );
}

/// POST /api/auth/login with correct credentials returns 200 and sets a
/// session cookie whose name matches the constant in auth.rs.
#[tokio::test]
async fn login_success() {
    let (app, _dir, _uid) = setup().await;

    let (status, set_cookie) = login(&app, "testuser", "testpass").await;

    assert_eq!(status, StatusCode::OK, "login should return 200");
    let set_cookie = set_cookie.expect("Set-Cookie header must be present after login");
    assert!(
        set_cookie.starts_with("wrazz_session="),
        "cookie must be named wrazz_session, got: {set_cookie}"
    );
}

/// POST /api/auth/login with the wrong password returns 401.
#[tokio::test]
async fn login_wrong_password() {
    let (app, _dir, _uid) = setup().await;

    let (status, _) = login(&app, "testuser", "wrongpass").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// GET /api/user/self without a session cookie returns 401.
#[tokio::test]
async fn get_user_self_unauthenticated() {
    let (app, _dir, _uid) = setup().await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/user/self")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// GET /api/user/self with a valid session cookie returns 200 with the user's
/// info, including the expected username as display_name.
#[tokio::test]
async fn get_user_self_authenticated() {
    let (app, _dir, uid) = setup().await;

    let (_, set_cookie) = login(&app, "testuser", "testpass").await;
    let cookie = cookie_pair(set_cookie.as_deref().unwrap());

    let resp = app
        .oneshot(authed_get("/api/user/self", &cookie))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["id"].as_str().unwrap(), uid, "user id should match");
    assert_eq!(body["display_name"].as_str().unwrap(), "Test User");
    assert_eq!(body["is_admin"].as_bool().unwrap(), true);
}

/// Full file lifecycle: create → get metadata → get content → update → delete.
#[tokio::test]
async fn file_lifecycle() {
    let (app, _dir, _uid) = setup().await;

    let (_, set_cookie) = login(&app, "testuser", "testpass").await;
    let cookie = cookie_pair(set_cookie.as_deref().unwrap());

    // --- Create ---
    let resp = app
        .clone()
        .oneshot(authed_with_body(
            "POST",
            "/api/files/hello.md",
            &cookie,
            json!({
                "title": "Hello",
                "tags": ["test"],
                "content": "# Hello World"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED, "create should return 201");
    let created = body_json(resp).await;
    // The backend stores paths with a leading slash; accept both forms.
    let created_path = created["path"].as_str().unwrap_or("");
    assert!(
        created_path == "hello.md" || created_path == "/hello.md",
        "unexpected path: {created_path}"
    );

    // --- Get metadata ---
    let resp = app
        .clone()
        .oneshot(authed_get("/api/files/hello.md", &cookie))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let meta = body_json(resp).await;
    let meta_path = meta["path"].as_str().unwrap_or("");
    assert!(
        meta_path == "hello.md" || meta_path == "/hello.md",
        "unexpected metadata path: {meta_path}"
    );

    // --- Get content ---
    let resp = app
        .clone()
        .oneshot(authed_get("/api/content/hello.md", &cookie))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let content = body_json(resp).await;
    assert_eq!(content["content"].as_str().unwrap_or(""), "# Hello World");

    // --- Update ---
    let resp = app
        .clone()
        .oneshot(authed_with_body(
            "PUT",
            "/api/files/hello.md",
            &cookie,
            json!({
                "title": "Hello Updated",
                "tags": ["test", "updated"],
                "content": "# Hello World\n\nUpdated."
            }),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "update should return 200");
    let updated = body_json(resp).await;
    let updated_path = updated["path"].as_str().unwrap_or("");
    assert!(
        updated_path == "hello.md" || updated_path == "/hello.md",
        "unexpected updated path: {updated_path}"
    );

    // Verify updated content is returned.
    let resp = app
        .clone()
        .oneshot(authed_get("/api/content/hello.md", &cookie))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let content = body_json(resp).await;
    assert!(
        content["content"]
            .as_str()
            .unwrap_or("")
            .contains("Updated."),
        "updated content should be reflected"
    );

    // --- Delete ---
    let resp = app
        .clone()
        .oneshot(authed_delete("/api/entries/hello.md", &cookie))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT, "delete should return 204");

    // File should no longer be accessible.
    let resp = app
        .clone()
        .oneshot(authed_get("/api/files/hello.md", &cookie))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

/// After logout, the session cookie no longer grants access.
#[tokio::test]
async fn logout_invalidates_session() {
    let (app, _dir, _uid) = setup().await;

    let (_, set_cookie) = login(&app, "testuser", "testpass").await;
    let cookie = cookie_pair(set_cookie.as_deref().unwrap());

    // Confirm the session works before logout.
    let resp = app
        .clone()
        .oneshot(authed_get("/api/user/self", &cookie))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "should be authenticated before logout");

    // Logout.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT, "logout should return 204");

    // The same cookie should no longer work.
    let resp = app
        .clone()
        .oneshot(authed_get("/api/user/self", &cookie))
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "session should be invalidated after logout"
    );
}

/// Create a directory, then verify it appears in the listing for its parent.
#[tokio::test]
async fn create_dir_and_list() {
    let (app, _dir, _uid) = setup().await;

    let (_, set_cookie) = login(&app, "testuser", "testpass").await;
    let cookie = cookie_pair(set_cookie.as_deref().unwrap());

    // Create directory.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/dirs/notes")
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED, "create dir should return 201");

    // List root — the new directory should appear.
    let resp = app
        .clone()
        .oneshot(authed_get("/api/entries?path=/", &cookie))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let entries = body_json(resp).await;
    let entries = entries.as_array().expect("entries should be an array");
    let has_notes = entries
        .iter()
        .any(|e| e["path"].as_str().map(|p| p.contains("notes")).unwrap_or(false));
    assert!(has_notes, "notes directory should appear in listing; got: {entries:?}");
}
