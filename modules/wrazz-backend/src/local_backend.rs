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

    async fn create_file(&self, title: String, content: String, tags: Vec<String>) -> BackendResult<FileEntry> {
        self.store.create(title, content, tags).await.map_err(Into::into)
    }

    async fn update_file(&self, id: &str, title: String, content: String, tags: Vec<String>) -> BackendResult<FileEntry> {
        self.store.save(id, title, content, tags).await.map_err(Into::into)
    }

    async fn delete_file(&self, id: &str) -> BackendResult<()> {
        self.store.delete(id).await.map_err(Into::into)
    }
}
