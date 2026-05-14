use async_trait::async_trait;
use wrazz_core::{BackendError, BackendResult, Entry, FileContent, FileEntry, Workspace};

use crate::store::{Store, StoreError};

impl From<StoreError> for BackendError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::NotFound { path } => BackendError::NotFound(path),
            StoreError::Conflict { path } => BackendError::Conflict(path),
            e => BackendError::Internal(Box::new(e)),
        }
    }
}

fn rel(path: &str) -> &str {
    path.trim_start_matches('/')
}

/// [`Workspace`] implementation backed by a local filesystem directory.
///
/// Wraps a [`Store`] and implements all file operations against it.
/// Used by `wrazz-backend` in standalone mode, and will be used by
/// `wrazz-desktop` for local raw-directory workspaces.
pub struct LocalWorkspace {
    id: String,
    name: String,
    store: Store,
}

impl LocalWorkspace {
    pub fn new(id: impl Into<String>, name: impl Into<String>, store: Store) -> Self {
        Self { id: id.into(), name: name.into(), store }
    }
}

#[async_trait]
impl Workspace for LocalWorkspace {
    fn id(&self) -> &str { &self.id }
    fn name(&self) -> &str { &self.name }

    async fn list_entries(&self, path: &str) -> BackendResult<Vec<Entry>> {
        self.store.list(rel(path)).await.map_err(Into::into)
    }

    async fn get_file(&self, path: &str) -> BackendResult<FileEntry> {
        self.store.load_metadata(rel(path)).await.map_err(Into::into)
    }

    async fn get_file_content(&self, path: &str) -> BackendResult<FileContent> {
        self.store.load_content(rel(path)).await.map_err(Into::into)
    }

    async fn create_file(
        &self,
        path: &str,
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        self.store.create(rel(path), title, tags, content).await.map_err(Into::into)
    }

    async fn update_file(
        &self,
        path: &str,
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        self.store.save(rel(path), title, tags, content).await.map_err(Into::into)
    }

    async fn delete_entry(&self, path: &str) -> BackendResult<()> {
        self.store.delete_entry(rel(path)).await.map_err(Into::into)
    }

    async fn create_dir(&self, path: &str) -> BackendResult<()> {
        self.store.create_dir(rel(path)).await.map_err(Into::into)
    }

    async fn move_entry(&self, path_from: &str, path_to: &str) -> BackendResult<()> {
        self.store.rename_entry(rel(path_from), rel(path_to)).await.map_err(Into::into)
    }

    async fn walk_files(&self, path: &str) -> BackendResult<Vec<String>> {
        self.store.walk_files(rel(path)).await.map_err(Into::into)
    }
}
