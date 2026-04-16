use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// Relative path from the data directory root, including extension.
    /// e.g. "morning-pages.md" or "journal/2026/april.md"
    /// Never stored inside the file itself — derived from the path on read.
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    /// Always the filesystem mtime — never stored inside the file.
    pub updated_at: DateTime<Utc>,
}
