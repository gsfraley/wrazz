use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;
use wrazz_backend::{LocalBackend, Store};

fn make_app(dir: &TempDir) -> axum::Router {
    let workspace_id = "test-workspace".to_string();
    let store = Store::new(dir.path().to_str().unwrap());
    let backend: Arc<dyn wrazz_core::Backend> = Arc::new(LocalBackend::new(&workspace_id, store));
    wrazz_backend::routes::router(backend, workspace_id)
}

async fn body_json(resp: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn get_version_returns_version() {
    let dir = TempDir::new().unwrap();
    let app = make_app(&dir);

    let resp = app
        .oneshot(Request::builder().uri("/api/version").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = body_json(resp).await;
    assert!(body["version"].is_string());
    assert!(!body["version"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn list_entries_empty_root() {
    let dir = TempDir::new().unwrap();
    let app = make_app(&dir);

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/entries?path=/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = body_json(resp).await;
    assert_eq!(body, json!([]));
}

#[tokio::test]
async fn create_and_get_file() {
    let dir = TempDir::new().unwrap();
    let app = make_app(&dir);

    // Create a file.
    let create_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/files/hello.md")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "title": "Hello", "tags": [], "content": "world" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_resp.status(), StatusCode::CREATED);
    let created: Value = body_json(create_resp).await;
    assert_eq!(created["title"], "Hello");
    assert_eq!(created["path"], "/hello.md");

    // Get the file metadata.
    let get_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/files/hello.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get_resp.status(), StatusCode::OK);
    let meta: Value = body_json(get_resp).await;
    assert_eq!(meta["title"], "Hello");

    // Get the file content.
    let content_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/content/hello.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(content_resp.status(), StatusCode::OK);
    let content: Value = body_json(content_resp).await;
    assert_eq!(content["content"], "world");
}

#[tokio::test]
async fn create_file_conflict_returns_409() {
    let dir = TempDir::new().unwrap();
    let app = make_app(&dir);

    let body = json!({ "title": null, "tags": [], "content": "" }).to_string();

    let first = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/files/dup.md")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::CREATED);

    let second = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/files/dup.md")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn update_file() {
    let dir = TempDir::new().unwrap();
    let app = make_app(&dir);

    // Create.
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/files/edit.md")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "title": "Old", "tags": [], "content": "old" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Update.
    let upd = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/files/edit.md")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "title": "New", "tags": ["a"], "content": "new content" })
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(upd.status(), StatusCode::OK);
    let meta: Value = body_json(upd).await;
    assert_eq!(meta["title"], "New");

    // Verify content updated.
    let content_resp = app
        .oneshot(
            Request::builder()
                .uri("/api/content/edit.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let content: Value = body_json(content_resp).await;
    assert_eq!(content["content"], "new content");
}

#[tokio::test]
async fn delete_file() {
    let dir = TempDir::new().unwrap();
    let app = make_app(&dir);

    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/files/todelete.md")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "title": null, "tags": [], "content": "" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let del = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/entries/todelete.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del.status(), StatusCode::NO_CONTENT);

    // File should now be 404.
    let get = app
        .oneshot(
            Request::builder()
                .uri("/api/files/todelete.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn create_dir_and_list() {
    let dir = TempDir::new().unwrap();
    let app = make_app(&dir);

    let mkdir = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/dirs/myfolder")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(mkdir.status(), StatusCode::CREATED);

    // Dir should appear in root listing.
    let list = app
        .oneshot(
            Request::builder()
                .uri("/api/entries?path=/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list.status(), StatusCode::OK);
    let entries: Value = body_json(list).await;
    let paths: Vec<&str> = entries
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["path"].as_str())
        .collect();
    assert!(paths.iter().any(|p| p.contains("myfolder")));
}

#[tokio::test]
async fn move_file() {
    let dir = TempDir::new().unwrap();
    let app = make_app(&dir);

    // Create source.
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/files/source.md")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "title": "Src", "tags": [], "content": "src" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Move it.
    let mv = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/entries/source.md")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "to_path": "/dest.md" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(mv.status(), StatusCode::NO_CONTENT);

    // Original gone.
    let old = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/files/source.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(old.status(), StatusCode::NOT_FOUND);

    // New path exists.
    let new_file = app
        .oneshot(
            Request::builder()
                .uri("/api/files/dest.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(new_file.status(), StatusCode::OK);
}
