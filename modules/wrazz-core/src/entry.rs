use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    /// The filename stem (e.g. "morning-pages" for "morning-pages.md").
    /// This is the stable identifier for an entry — it is never stored in front matter,
    /// it IS the filename. Humans can set it by choosing the filename; wrazz sets it
    /// by slugifying the title on creation.
    pub id: String,

    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    /// Always derived from filesystem mtime — never stored in front matter.
    pub updated_at: DateTime<Utc>,
}

/// Convert a title or arbitrary string into a safe, human-readable filename stem.
/// "Morning Pages!" → "morning-pages"
pub fn slugify(s: &str) -> String {
    let slug: String = s
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    // Collapse runs of hyphens, strip leading/trailing
    slug.split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
