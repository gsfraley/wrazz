use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// The in-memory representation of a single note or journal file.
///
/// Files are stored on disk as Markdown with a YAML front matter block.
/// `FileEntry` is what the API layer works with after parsing; it is also
/// the JSON shape returned to the frontend.
///
/// # Identity
///
/// `id` is the file's path relative to the data directory root, including
/// the `.md` extension — for example `"morning-pages.md"` or
/// `"journal/2026/april.md"`. It is derived from the on-disk path at read
/// time and never stored inside the file itself.
///
/// # Timestamps
///
/// `created_at` comes from the front matter and is written once when the
/// file is first created. `updated_at` is always the filesystem mtime and
/// is never stored in the file — it reflects the last write automatically.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// Relative path from the data directory, including `.md` extension.
    /// Acts as the stable identifier for this file across all API calls.
    pub id: String,

    /// Human-readable title, sourced from the `title` front matter field.
    /// Falls back to a `# Heading` if present, then to the filename stem.
    pub title: String,

    /// Raw Markdown body, everything after the closing `---` of front matter.
    pub content: String,

    /// Optional tags from the `tags` front matter field. Defaults to empty.
    #[serde(default)]
    pub tags: Vec<String>,

    /// Creation timestamp from the `created_at` front matter field.
    pub created_at: DateTime<Utc>,

    /// Last-modified time from the filesystem. Never written into the file.
    pub updated_at: DateTime<Utc>,
}
