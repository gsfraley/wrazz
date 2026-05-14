use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::{BackendResult, Entry, FileContent, FileEntry};

/// Serialisable summary of a workspace, returned by the list and create APIs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
}

/// Async file-operation interface for a single workspace.
///
/// Unlike [`Backend`], which multiplexes across workspaces via an explicit
/// `workspace` parameter, a `Workspace` is scoped to exactly one workspace.
/// All path arguments follow the `/`-led convention used by the HTTP API
/// (e.g. `"/"`, `"/journal/"`, `"/journal/april.md"`).
///
/// Implementations:
/// - `LocalWorkspace` in `wrazz-backend` — filesystem via [`Store`].
/// - `ServerWorkspace` in `wrazz-server` — user-scoped, UUID-nested layout.
/// - `RemoteWorkspace` (future) — proxies to a remote `wrazz-server`.
///
/// [`Backend`]: crate::Backend
/// [`Store`]: wrazz_backend::Store
#[async_trait]
pub trait Workspace: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;

    async fn list_entries(&self, path: &str) -> BackendResult<Vec<Entry>>;
    async fn get_file(&self, path: &str) -> BackendResult<FileEntry>;
    async fn get_file_content(&self, path: &str) -> BackendResult<FileContent>;

    async fn create_file(
        &self,
        path: &str,
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry>;

    async fn update_file(
        &self,
        path: &str,
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry>;

    async fn delete_entry(&self, path: &str) -> BackendResult<()>;
    async fn create_dir(&self, path: &str) -> BackendResult<()>;

    async fn move_entry(&self, path_from: &str, path_to: &str) -> BackendResult<()>;

    /// Recursively collects the paths of all `.md` files under `path`.
    /// Use `"/"` for the workspace root.
    async fn walk_files(&self, path: &str) -> BackendResult<Vec<String>>;
}
