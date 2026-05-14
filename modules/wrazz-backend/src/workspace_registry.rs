use std::{collections::HashMap, sync::Arc};

use tokio::sync::RwLock;
use wrazz_core::{Workspace, WorkspaceSummary};

/// In-memory registry of [`Workspace`] trait objects.
///
/// `WorkspaceRegistry` is the runtime container for open workspaces. It is
/// generic over the workspace implementation — `wrazz-server` populates it
/// with `ServerWorkspace` objects, while `wrazz-desktop` will hold a mix of
/// `LocalWorkspace` and `RemoteWorkspace` objects.
///
/// The registry is internally synchronised (`Arc<RwLock<...>>` under the
/// hood), so callers can hold an `Arc<WorkspaceRegistry>` and call methods
/// from multiple async tasks without additional locking.
pub struct WorkspaceRegistry {
    inner: RwLock<HashMap<String, Arc<dyn Workspace>>>,
}

impl WorkspaceRegistry {
    pub fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }

    /// Inserts or replaces a workspace. Keyed by `ws.id()`.
    pub async fn add(&self, ws: Arc<dyn Workspace>) {
        self.inner.write().await.insert(ws.id().to_string(), ws);
    }

    /// Removes a workspace by ID. Returns the removed entry, if any.
    pub async fn remove(&self, id: &str) -> Option<Arc<dyn Workspace>> {
        self.inner.write().await.remove(id)
    }

    /// Returns the workspace with the given ID, or `None`.
    pub async fn get(&self, id: &str) -> Option<Arc<dyn Workspace>> {
        self.inner.read().await.get(id).cloned()
    }

    /// Returns a summary of every workspace currently in the registry.
    pub async fn list(&self) -> Vec<WorkspaceSummary> {
        self.inner
            .read()
            .await
            .values()
            .map(|ws| WorkspaceSummary { id: ws.id().to_string(), name: ws.name().to_string() })
            .collect()
    }
}

impl Default for WorkspaceRegistry {
    fn default() -> Self { Self::new() }
}
