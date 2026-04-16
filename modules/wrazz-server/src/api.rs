use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use wrazz_core::entry::Entry;
use wrazz_extensions::types::EntryMeta;

use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/entries", get(list_entries))
        .route("/entries", post(create_entry))
        .route("/entries/{id}", get(get_entry))
        .route("/entries/{id}", put(update_entry))
        .route("/entries/{id}", delete(delete_entry))
        .route("/entries/{id}/slots", get(get_slots))
}

#[derive(Serialize)]
struct EntryResponse {
    /// The filename stem — stable, human-readable identifier.
    id: String,
    title: String,
    content: String,
    tags: Vec<String>,
    created_at: String,
    updated_at: String,
}

impl From<Entry> for EntryResponse {
    fn from(e: Entry) -> Self {
        Self {
            id: e.id,
            title: e.title,
            content: e.content,
            tags: e.tags,
            created_at: e.created_at.to_rfc3339(),
            updated_at: e.updated_at.to_rfc3339(),
        }
    }
}

#[derive(Deserialize)]
struct CreateRequest {
    title: String,
    content: String,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct UpdateRequest {
    title: Option<String>,
    content: Option<String>,
    tags: Option<Vec<String>>,
}

async fn list_entries(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<EntryResponse>>, StatusCode> {
    state
        .store
        .list()
        .await
        .map(|entries| Json(entries.into_iter().map(Into::into).collect()))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn create_entry(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateRequest>,
) -> Result<(StatusCode, Json<EntryResponse>), StatusCode> {
    let mut entry = state
        .store
        .create(req.title, req.content, req.tags)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let meta = EntryMeta::from(&entry);
    entry.content = state.extensions.before_save(&entry.content, &meta);

    // Re-save with the (possibly transformed) content
    state
        .store
        .save(&entry)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((StatusCode::CREATED, Json(entry.into())))
}

async fn get_entry(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<EntryResponse>, StatusCode> {
    state
        .store
        .load(&id)
        .await
        .map(|e| Json(e.into()))
        .map_err(|_| StatusCode::NOT_FOUND)
}

async fn update_entry(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<UpdateRequest>,
) -> Result<Json<EntryResponse>, StatusCode> {
    let mut entry = state
        .store
        .load(&id)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    if let Some(title) = req.title {
        entry.title = title;
    }
    if let Some(content) = req.content {
        entry.content = content;
    }
    if let Some(tags) = req.tags {
        entry.tags = tags;
    }
    entry.updated_at = Utc::now();

    let meta = EntryMeta::from(&entry);
    entry.content = state.extensions.before_save(&entry.content, &meta);

    state
        .store
        .save(&entry)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(entry.into()))
}

async fn delete_entry(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> StatusCode {
    match state.store.delete(&id).await {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

#[derive(Serialize)]
struct SlotResponse {
    slot: String,
    html: String,
}

async fn get_slots(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<SlotResponse>>, StatusCode> {
    let entry = state
        .store
        .load(&id)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let meta = EntryMeta::from(&entry);
    let slots = state
        .extensions
        .render_all(&meta)
        .into_iter()
        .map(|s| SlotResponse { slot: s.slot, html: s.html })
        .collect();

    Ok(Json(slots))
}
