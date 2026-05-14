use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use wrazz_backend::RemoteWorkspaceConfig;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceConfig {
    pub workspaces: Vec<WorkspaceEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkspaceEntry {
    Local {
        id: String,
        name: String,
        path: PathBuf,
    },
    Remote(RemoteWorkspaceConfig),
}

impl WorkspaceEntry {
    pub fn id(&self) -> &str {
        match self {
            WorkspaceEntry::Local { id, .. } => id,
            WorkspaceEntry::Remote(c) => &c.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            WorkspaceEntry::Local { name, .. } => name,
            WorkspaceEntry::Remote(c) => &c.name,
        }
    }
}

impl WorkspaceConfig {
    pub fn load(path: &Path) -> Option<Self> {
        let bytes = std::fs::read(path).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(self)
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        std::fs::write(path, bytes)
    }

    pub fn add(&mut self, entry: WorkspaceEntry) {
        // Deduplicate by ID.
        self.workspaces.retain(|e| e.id() != entry.id());
        self.workspaces.push(entry);
    }

    pub fn remove(&mut self, id: &str) {
        self.workspaces.retain(|e| e.id() != id);
    }
}
