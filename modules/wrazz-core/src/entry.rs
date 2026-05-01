use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Metadata for a single Markdown note. Does not include the file's content.
///
/// `path` is a `/`-led path from the workspace root — e.g. `"/morning-pages.md"`
/// or `"/journal/april.md"`. It never ends with `/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Metadata for a directory.
///
/// `path` is a `/`-led path from the workspace root and always ends with `/` —
/// e.g. `"/journal/"`. The root directory is not represented as a `DirEntry`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub path: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A file or directory entry returned by the list endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Entry {
    File(FileEntry),
    Dir(DirEntry),
}

/// The content of a single Markdown file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContent {
    pub content: String,
}
