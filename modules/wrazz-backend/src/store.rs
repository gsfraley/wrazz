use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::fs;
use wrazz_core::FileEntry;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("not found: {id}")]
    NotFound { id: String },

    #[error("conflict: {id} already exists")]
    Conflict { id: String },

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("front matter parse error in {file}: {message}")]
    Parse { file: String, message: String },
}

pub type StoreResult<T> = Result<T, StoreError>;

// Deserialised from a file's YAML front matter block.
#[derive(Deserialize)]
struct FrontMatter {
    title: String,
    #[serde(default)]
    tags: Vec<String>,
    created_at: DateTime<Utc>,
}

// Serialised into a file's YAML front matter block.
#[derive(Serialize)]
struct FrontMatterOut<'a> {
    title: &'a str,
    #[serde(skip_serializing_if = "slice_is_empty")]
    tags: &'a [String],
    created_at: String,
}

fn slice_is_empty(v: &[String]) -> bool {
    v.is_empty()
}

pub struct Store {
    data_dir: PathBuf,
}

impl Store {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self { data_dir: data_dir.into() }
    }

    fn full_path(&self, id: &str) -> PathBuf {
        self.data_dir.join(id)
    }

    pub async fn list(&self) -> StoreResult<Vec<FileEntry>> {
        let data_dir = self.data_dir.clone();

        // walkdir is synchronous; run it off the async executor.
        let paths = tokio::task::spawn_blocking(move || {
            walkdir::WalkDir::new(&data_dir)
                .follow_links(true)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.file_type().is_file()
                        && e.path().extension().is_some_and(|x| x == "md")
                })
                .map(|e| e.path().to_path_buf())
                .collect::<Vec<_>>()
        })
        .await
        .map_err(|e| StoreError::Io(std::io::Error::other(e)))?;

        let mut entries = Vec::new();
        for path in paths {
            let id = path
                .strip_prefix(&self.data_dir)
                .expect("walkdir always returns paths under the root")
                .to_string_lossy()
                .into_owned();

            match self.load(&id).await {
                Ok(entry) => entries.push(entry),
                Err(e) => tracing::warn!("skipping {id}: {e}"),
            }
        }

        // Sort alphabetically by full path, case-insensitive — the same order
        // a file explorer shows: directory hierarchy first, then filename within
        // each level, matching what users expect when navigating a notes tree.
        entries.sort_by(|a, b| a.id.to_lowercase().cmp(&b.id.to_lowercase()));
        Ok(entries)
    }

    pub async fn load(&self, id: &str) -> StoreResult<FileEntry> {
        let path = self.full_path(id);

        let metadata = fs::metadata(&path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                StoreError::NotFound { id: id.to_string() }
            } else {
                StoreError::Io(e)
            }
        })?;

        let updated_at: DateTime<Utc> = metadata
            .modified()
            .map(|t| t.into())
            .unwrap_or_else(|_| Utc::now());

        let raw = fs::read_to_string(&path).await.map_err(StoreError::Io)?;
        // Normalise line endings so the parser only has to handle LF.
        let raw = raw.replace('\r', "");

        self.parse(id, &raw, updated_at)
    }

    fn parse(&self, id: &str, raw: &str, updated_at: DateTime<Utc>) -> StoreResult<FileEntry> {
        if raw.starts_with("---\n") {
            let rest = &raw[4..];
            let close = rest
                .find("\n---\n")
                .ok_or_else(|| StoreError::Parse {
                    file: id.to_string(),
                    message: "unclosed front matter".into(),
                })?;

            let yaml = &rest[..close];
            // Skip the "\n---\n" delimiter (5 chars), then any blank lines.
            let content = rest[close + 5..].trim_start_matches('\n').to_string();

            let fm: FrontMatter = serde_yaml_ng::from_str(yaml)
                .map_err(|e| StoreError::Parse { file: id.to_string(), message: e.to_string() })?;

            Ok(FileEntry {
                id: id.to_string(),
                title: fm.title,
                content,
                tags: fm.tags,
                created_at: fm.created_at,
                updated_at,
            })
        } else {
            // Naked file: no front matter at all.
            let title = raw
                .lines()
                .find(|l| l.starts_with("# "))
                .map(|l| l[2..].trim().to_string())
                .unwrap_or_else(|| stem_from_id(id));

            Ok(FileEntry {
                id: id.to_string(),
                title,
                content: raw.to_string(),
                tags: Vec::new(),
                created_at: updated_at,
                updated_at,
            })
        }
    }

    fn serialize(title: &str, tags: &[String], created_at: &DateTime<Utc>, content: &str) -> String {
        let fm = FrontMatterOut {
            title,
            tags,
            created_at: created_at.to_rfc3339(),
        };
        // serde_yaml_ng::to_string never fails on this struct.
        let yaml = serde_yaml_ng::to_string(&fm).unwrap_or_default();
        format!("---\n{yaml}---\n\n{content}")
    }

    pub async fn create(&self, title: String, content: String, tags: Vec<String>) -> StoreResult<FileEntry> {
        let stem = slugify(&title);
        let id = self.find_available_id(&stem).await?;
        let path = self.full_path(&id);

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await.map_err(StoreError::Io)?;
        }

        let now = Utc::now();
        fs::write(&path, Self::serialize(&title, &tags, &now, &content))
            .await
            .map_err(StoreError::Io)?;

        self.load(&id).await
    }

    async fn find_available_id(&self, stem: &str) -> StoreResult<String> {
        let candidate = format!("{stem}.md");
        if fs::metadata(self.full_path(&candidate)).await.is_err() {
            return Ok(candidate);
        }
        // Cap at 9999 to avoid an unbounded loop if the filesystem is in a
        // state where metadata() never errors (e.g. all of morning-pages-2.md
        // through morning-pages-N.md exist). In practice a user would need
        // ten thousand identically-titled notes before hitting this, but
        // prevents crashing if the user accidentally targets something like a
        // system dir with thousands of files.
        for n in 2u32..=9999 {
            let candidate = format!("{stem}-{n}.md");
            if fs::metadata(self.full_path(&candidate)).await.is_err() {
                return Ok(candidate);
            }
        }
        Err(StoreError::Conflict { id: stem.to_string() })
    }

    pub async fn save(
        &self,
        id: &str,
        title: String,
        content: String,
        tags: Vec<String>,
    ) -> StoreResult<FileEntry> {
        // Load first to confirm the file exists and to preserve its created_at.
        let existing = self.load(id).await?;
        let path = self.full_path(id);

        fs::write(&path, Self::serialize(&title, &tags, &existing.created_at, &content))
            .await
            .map_err(StoreError::Io)?;

        self.load(id).await
    }

    pub async fn delete(&self, id: &str) -> StoreResult<()> {
        fs::remove_file(self.full_path(id)).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                StoreError::NotFound { id: id.to_string() }
            } else {
                StoreError::Io(e)
            }
        })
    }
}

/// Converts a title into a URL-safe filename stem.
/// "Evening Thoughts!" → "evening-thoughts"
pub fn slugify(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Returns the filename stem from an ID like "journal/april.md" → "april".
fn stem_from_id(id: &str) -> String {
    Path::new(id)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| id.to_string())
}
