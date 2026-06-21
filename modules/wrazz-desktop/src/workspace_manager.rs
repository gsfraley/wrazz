use std::sync::Arc;
use wrazz_backend::{LocalWorkspace, RemoteWorkspace, Store, WorkspaceRegistry};
use crate::workspace_config::{WorkspaceConfig, WorkspaceEntry};

pub async fn init_registry(registry: &WorkspaceRegistry, config: &WorkspaceConfig) {
    for entry in &config.workspaces {
        match entry {
            WorkspaceEntry::Local { id, name, path } => {
                let store = Store::new(path.clone());
                let ws = Arc::new(LocalWorkspace::new(id.clone(), name.clone(), store));
                registry.add(ws).await;
            }
            WorkspaceEntry::Remote(cfg) => {
                let ws = Arc::new(RemoteWorkspace::new(cfg.clone()));
                registry.add(ws).await;
            }
        }
    }
}
