use async_trait::async_trait;

use crate::FileEntry;

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("conflict: {0} already exists")]
    Conflict(String),

    /// Wraps lower-level errors (I/O, parse, etc.) that the caller cannot
    /// meaningfully recover from but may want to log or surface.
    #[error(transparent)]
    Internal(Box<dyn std::error::Error + Send + Sync>),
}

pub type BackendResult<T> = Result<T, BackendError>;

#[async_trait]
pub trait Backend: Send + Sync {
    async fn list_files(&self) -> BackendResult<Vec<FileEntry>>;
    async fn get_file(&self, id: &str) -> BackendResult<FileEntry>;
    async fn create_file(
        &self,
        title: String,
        content: String,
        tags: Vec<String>,
    ) -> BackendResult<FileEntry>;
    async fn update_file(
        &self,
        id: &str,
        title: String,
        content: String,
        tags: Vec<String>,
    ) -> BackendResult<FileEntry>;
    async fn delete_file(&self, id: &str) -> BackendResult<()>;
}
