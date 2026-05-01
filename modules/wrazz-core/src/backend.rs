use async_trait::async_trait;

use crate::{Entry, FileContent, FileEntry};

/// Errors returned by [`Backend`] operations.
#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("conflict: {0} already exists")]
    Conflict(String),

    #[error(transparent)]
    Internal(Box<dyn std::error::Error + Send + Sync>),
}

/// Convenience alias used by all backend methods.
pub type BackendResult<T> = Result<T, BackendError>;

/// Async storage abstraction over a workspace of Markdown files.
///
/// All operations are scoped to a `workspace` (an opaque string UUID) and a
/// `path` (a `/`-led path from the workspace root, e.g. `"/"`, `"/journal/"`,
/// `"/journal/april.md"`).
///
/// Implementations:
/// - `LocalBackend` in `wrazz-backend` — filesystem via [`Store`].
/// - `HttpBackend` in `wrazz-backend` — proxies over HTTP to `wrazz-server`.
#[async_trait]
pub trait Backend: Send + Sync {
    /// Lists the direct children of `path` within `workspace`.
    /// Use `"/"` to list the workspace root.
    async fn list_entries(&self, workspace: &str, path: &str) -> BackendResult<Vec<Entry>>;

    /// Returns metadata for the file at `path`. Does not include content.
    async fn get_file(&self, workspace: &str, path: &str) -> BackendResult<FileEntry>;

    /// Returns the content of the file at `path`.
    async fn get_file_content(&self, workspace: &str, path: &str) -> BackendResult<FileContent>;

    /// Creates a new file at the given full `path`.
    ///
    /// The caller is responsible for deriving the path from the title.
    /// Returns [`BackendError::Conflict`] if a file already exists at `path`.
    async fn create_file(
        &self,
        workspace: &str,
        path: &str,
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry>;

    /// Replaces the content of an existing file at `path`.
    async fn update_file(
        &self,
        workspace: &str,
        path: &str,
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry>;

    /// Deletes the file or directory at `path`. Directories are deleted recursively.
    async fn delete_entry(&self, workspace: &str, path: &str) -> BackendResult<()>;

    /// Creates a directory at `path`.
    async fn create_dir(&self, workspace: &str, path: &str) -> BackendResult<()>;

    /// Moves the entry at `(ws_from, path_from)` to `(ws_to, path_to)`.
    async fn move_entry(
        &self,
        ws_from: &str,
        path_from: &str,
        ws_to: &str,
        path_to: &str,
    ) -> BackendResult<()>;
}
