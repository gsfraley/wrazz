use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use tokio::fs;

use crate::entry::{slugify, Entry};

/// Filesystem-backed entry store. Each entry is a Markdown file under `root/`.
///
/// # File format
///
/// Files may be "naked" (no front matter) or have YAML front matter:
///
/// ```markdown
/// ---
/// title: My Entry
/// tags: [journal]
/// created_at: "2026-04-15T10:30:00Z"
/// ---
///
/// Entry body.
/// ```
///
/// The entry ID is always the filename stem — never stored inside the file.
/// `updated_at` is always the filesystem mtime — never stored inside the file.
/// Naked files are fully supported: title falls back to the filename stem,
/// `created_at` falls back to filesystem mtime.
pub struct Store {
    root: PathBuf,
}

impl Store {
    pub async fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(&root)
            .await
            .with_context(|| format!("failed to create store directory: {}", root.display()))?;
        Ok(Self { root })
    }

    /// Save an existing entry. The file is determined by `entry.id`.
    pub async fn save(&self, entry: &Entry) -> Result<()> {
        let path = self.entry_path(&entry.id);
        let content = serialize(entry)?;
        fs::write(&path, content)
            .await
            .with_context(|| format!("failed to write entry '{}'", entry.id))?;
        Ok(())
    }

    /// Create a new entry, deriving the filename stem from the title.
    /// If the derived stem is already taken, appends `-2`, `-3`, etc.
    pub async fn create(
        &self,
        title: impl Into<String>,
        content: impl Into<String>,
        tags: Vec<String>,
    ) -> Result<Entry> {
        let title = title.into();
        let content = content.into();
        let base_stem = slugify(&title);
        let base_stem = if base_stem.is_empty() {
            "entry".to_string()
        } else {
            base_stem
        };

        // Find an available stem
        let stem = self.available_stem(&base_stem).await;

        let now = Utc::now();
        let entry = Entry {
            id: stem,
            title,
            content,
            tags,
            created_at: now,
            updated_at: now,
        };
        self.save(&entry).await?;
        Ok(entry)
    }

    pub async fn load(&self, id: &str) -> Result<Entry> {
        let path = self.entry_path(id);
        let raw = fs::read_to_string(&path)
            .await
            .with_context(|| format!("failed to read entry '{id}'"))?;
        let mtime = mtime_of(&path).await?;
        deserialize(&raw, id, mtime)
    }

    pub async fn list(&self) -> Result<Vec<Entry>> {
        let mut entries = vec![];
        let mut dir = fs::read_dir(&self.root).await?;
        while let Some(de) = dir.next_entry().await? {
            let path = de.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let stem = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let raw = match fs::read_to_string(&path).await {
                Ok(r) => r,
                Err(_) => continue,
            };
            let mtime = mtime_of(&path).await.unwrap_or_else(|_| Utc::now());
            if let Ok(entry) = deserialize(&raw, &stem, mtime) {
                entries.push(entry);
            }
        }
        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(entries)
    }

    pub async fn delete(&self, id: &str) -> Result<()> {
        let path = self.entry_path(id);
        fs::remove_file(&path)
            .await
            .with_context(|| format!("failed to delete entry '{id}'"))?;
        Ok(())
    }

    fn entry_path(&self, id: &str) -> PathBuf {
        self.root.join(format!("{id}.md"))
    }

    async fn available_stem(&self, base: &str) -> String {
        if !self.entry_path(base).exists() {
            return base.to_string();
        }
        let mut n = 2;
        loop {
            let candidate = format!("{base}-{n}");
            if !self.entry_path(&candidate).exists() {
                return candidate;
            }
            n += 1;
        }
    }
}

/// Serialize an entry to Markdown with YAML front matter.
/// Does NOT write `id` (that's the filename) or `updated_at` (that's the mtime).
fn serialize(entry: &Entry) -> Result<String> {
    let mut front: Vec<String> = vec![format!("title: {:?}", entry.title)];
    if !entry.tags.is_empty() {
        let tags = entry
            .tags
            .iter()
            .map(|t| format!("{:?}", t))
            .collect::<Vec<_>>()
            .join(", ");
        front.push(format!("tags: [{tags}]"));
    }
    front.push(format!("created_at: {:?}", entry.created_at.to_rfc3339()));

    Ok(format!(
        "---\n{}\n---\n\n{}",
        front.join("\n"),
        entry.content
    ))
}

/// Parse a Markdown file into an Entry.
///
/// Supports both front-matter files and naked files (no front matter at all).
/// `stem` is the filename without extension and becomes `entry.id`.
/// `mtime` is the filesystem mtime and becomes `entry.updated_at`.
fn deserialize(raw: &str, stem: &str, mtime: DateTime<Utc>) -> Result<Entry> {
    if let Some(rest) = raw.strip_prefix("---\n") {
        // Has front matter
        if let Some(end) = rest.find("\n---\n") {
            let front_str = &rest[..end];
            let body = rest[end + 5..].trim_start().to_string();

            let front: serde_json::Value = serde_yaml_ng::from_str(front_str)
                .with_context(|| format!("invalid front matter in '{stem}'"))?;

            let title = front["title"]
                .as_str()
                .unwrap_or(stem)
                .to_string();

            let tags: Vec<String> = front["tags"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();

            let created_at: DateTime<Utc> = front["created_at"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .unwrap_or(mtime);

            return Ok(Entry {
                id: stem.to_string(),
                title,
                content: body,
                tags,
                created_at,
                updated_at: mtime,
            });
        }
    }

    // Naked file — no front matter at all.
    // Derive title from first `# Heading` or fall back to the stem.
    let title = raw
        .lines()
        .find(|l| l.starts_with("# "))
        .map(|l| l.trim_start_matches('#').trim().to_string())
        .unwrap_or_else(|| stem.replace('-', " "));

    Ok(Entry {
        id: stem.to_string(),
        title,
        content: raw.trim_start().to_string(),
        tags: vec![],
        created_at: mtime,
        updated_at: mtime,
    })
}

async fn mtime_of(path: &Path) -> Result<DateTime<Utc>> {
    let meta = fs::metadata(path).await?;
    let mtime = meta.modified()?;
    Ok(DateTime::from(mtime))
}
