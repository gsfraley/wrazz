use async_trait::async_trait;
use wrazz_core::{Backend, BackendError, BackendResult, FileEntry};

use crate::store::{Store, StoreError};

impl From<StoreError> for BackendError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::NotFound { id } => BackendError::NotFound(id),
            StoreError::Conflict { id } => BackendError::Conflict(id),
            e => BackendError::Internal(Box::new(e)),
        }
    }
}

/// [`Backend`] implementation that reads and writes files directly on the
/// local filesystem via a [`Store`].
///
/// This is used when `wrazz-backend` runs in standalone mode (no
/// `WRAZZ_BACKEND_URL` set). `wrazz-server` also uses [`Store`] directly
/// for per-user file trees, bypassing this wrapper.
pub struct LocalBackend {
    store: Store,
}

impl LocalBackend {
    pub fn new(store: Store) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Backend for LocalBackend {
    async fn list_files(&self) -> BackendResult<Vec<FileEntry>> {
        self.store.list().await.map_err(Into::into)
    }

    async fn get_file(&self, id: &str) -> BackendResult<FileEntry> {
        self.store.load(id).await.map_err(Into::into)
    }

    async fn create_file(
        &self,
        title: String,
        content: String,
        tags: Vec<String>,
    ) -> BackendResult<FileEntry> {
        self.store
            .create(title, content, tags)
            .await
            .map_err(Into::into)
    }

    async fn update_file(
        &self,
        id: &str,
        title: String,
        content: String,
        tags: Vec<String>,
    ) -> BackendResult<FileEntry> {
        self.store
            .save(id, title, content, tags)
            .await
            .map_err(Into::into)
    }

    async fn delete_file(&self, id: &str) -> BackendResult<()> {
        self.store.delete(id).await.map_err(Into::into)
    }
}
