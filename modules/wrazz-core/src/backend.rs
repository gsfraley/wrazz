use async_trait::async_trait;

use crate::FileEntry;

/// Errors returned by [`Backend`] operations.
///
/// Variants cover the three distinct failure modes a caller might want to
/// handle differently:
///
/// - [`NotFound`](BackendError::NotFound) — the requested file does not exist.
/// - [`Conflict`](BackendError::Conflict) — a file with the derived ID already
///   exists (typically a slug collision on create).
/// - [`Internal`](BackendError::Internal) — an I/O, parse, or database error
///   the caller cannot recover from but may want to log or surface.
#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    /// The file identified by the given ID does not exist.
    #[error("not found: {0}")]
    NotFound(String),

    /// A file with the derived slug already exists; the caller should retry
    /// with a different title or handle the collision explicitly.
    #[error("conflict: {0} already exists")]
    Conflict(String),

    /// An unexpected lower-level error (I/O, parse failure, DB error, etc.).
    /// Wraps the original error transparently so it can be logged upstream.
    #[error(transparent)]
    Internal(Box<dyn std::error::Error + Send + Sync>),
}

/// Convenience alias used by all backend methods.
pub type BackendResult<T> = Result<T, BackendError>;

/// Async storage abstraction over a collection of Markdown files.
///
/// Implementations include:
///
/// - `LocalBackend` in `wrazz-backend` — reads and writes `.md` files on
///   the local filesystem via `Store`.
/// - `HttpBackend` in `wrazz-backend` — proxies requests over HTTP to a
///   remote `wrazz-server` instance.
///
/// The trait is object-safe and `Send + Sync` so it can be held behind an
/// `Arc<dyn Backend>` and shared across async tasks.
///
/// All operations are keyed by `id`, which is the file's path relative to
/// the data directory root (see [`FileEntry::id`]).
#[async_trait]
pub trait Backend: Send + Sync {
    /// Returns all files in the store, sorted alphabetically by ID.
    async fn list_files(&self) -> BackendResult<Vec<FileEntry>>;

    /// Returns a single file by ID.
    ///
    /// # Errors
    /// Returns [`BackendError::NotFound`] if no file with that ID exists.
    async fn get_file(&self, id: &str) -> BackendResult<FileEntry>;

    /// Creates a new file with the given title, content, and tags.
    ///
    /// The ID (filename) is derived by slugifying the title. If a file with
    /// the same slug already exists a numeric suffix is appended
    /// (`morning-pages-2.md`, etc.).
    ///
    /// Returns the newly created [`FileEntry`] with its assigned ID and
    /// timestamps.
    async fn create_file(
        &self,
        title: String,
        content: String,
        tags: Vec<String>,
    ) -> BackendResult<FileEntry>;

    /// Replaces the content of an existing file in-place.
    ///
    /// The original `created_at` timestamp is preserved. `updated_at` will
    /// reflect the new filesystem mtime after the write.
    ///
    /// # Errors
    /// Returns [`BackendError::NotFound`] if no file with that ID exists.
    async fn update_file(
        &self,
        id: &str,
        title: String,
        content: String,
        tags: Vec<String>,
    ) -> BackendResult<FileEntry>;

    /// Permanently deletes the file with the given ID.
    ///
    /// # Errors
    /// Returns [`BackendError::NotFound`] if no file with that ID exists.
    async fn delete_file(&self, id: &str) -> BackendResult<()>;
}
