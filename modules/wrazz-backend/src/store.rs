use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::fs;
use wrazz_core::{DirEntry, Entry, FileContent, FileEntry};

/// Errors that can arise from [`Store`] operations.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("not found: {path}")]
    NotFound { path: String },

    #[error("conflict: {path} already exists")]
    Conflict { path: String },

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

/// Low-level file I/O layer for a single workspace directory of Markdown notes.
///
/// `Store` is not aware of users or workspaces — callers are responsible for
/// pointing it at the right root directory. `wrazz-server` creates one `Store`
/// per user (workspace layout migration is a future task).
///
/// All methods accept paths relative to `data_dir` with no leading slash —
/// e.g. `"morning-pages.md"` or `"journal/april.md"`. The `/`-led convention
/// used by the `Backend` trait is stripped by callers before reaching here.
pub struct Store {
    data_dir: PathBuf,
}

impl Store {
    /// Creates a new `Store` rooted at `data_dir`.
    ///
    /// The directory must already exist — callers are responsible for creation.
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            data_dir: data_dir.into(),
        }
    }

    fn full_path(&self, rel_path: &str) -> PathBuf {
        self.data_dir.join(rel_path.trim_end_matches('/'))
    }

    /// Returns the direct children of `rel_path`, sorted case-insensitively.
    ///
    /// `rel_path` is relative to the data directory; use `""` for the root.
    /// Only `.md` files and subdirectories are included. Files that fail to
    /// parse are skipped with a warning.
    pub async fn list(&self, rel_path: &str) -> StoreResult<Vec<Entry>> {
        let dir = if rel_path.is_empty() {
            self.data_dir.clone()
        } else {
            self.full_path(rel_path)
        };

        let mut reader = fs::read_dir(&dir).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                StoreError::NotFound { path: rel_path.to_string() }
            } else {
                StoreError::Io(e)
            }
        })?;

        let mut entries = Vec::new();

        while let Some(dirent) = reader.next_entry().await.map_err(StoreError::Io)? {
            let file_type = dirent.file_type().await.map_err(StoreError::Io)?;
            let name = dirent.file_name().to_string_lossy().into_owned();

            let child_rel = if rel_path.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", rel_path.trim_end_matches('/'), name)
            };

            if file_type.is_dir() {
                let metadata = fs::metadata(dirent.path()).await.map_err(StoreError::Io)?;
                let ts: DateTime<Utc> = metadata
                    .modified()
                    .map(|t| t.into())
                    .unwrap_or_else(|_| Utc::now());
                entries.push(Entry::Dir(DirEntry {
                    path: format!("/{child_rel}/"),
                    created_at: ts,
                    updated_at: ts,
                }));
            } else if file_type.is_file() && name.ends_with(".md") {
                match self.load_metadata(&child_rel).await {
                    Ok(entry) => entries.push(Entry::File(entry)),
                    Err(e) => tracing::warn!("skipping {child_rel}: {e}"),
                }
            }
        }

        entries.sort_by(|a, b| {
            let pa = match a { Entry::File(f) => &f.path, Entry::Dir(d) => &d.path };
            let pb = match b { Entry::File(f) => &f.path, Entry::Dir(d) => &d.path };
            pa.to_lowercase().cmp(&pb.to_lowercase())
        });

        Ok(entries)
    }

    /// Reads and parses the metadata for the file at `rel_path`.
    pub async fn load_metadata(&self, rel_path: &str) -> StoreResult<FileEntry> {
        let path = self.full_path(rel_path);

        let metadata = fs::metadata(&path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                StoreError::NotFound { path: rel_path.to_string() }
            } else {
                StoreError::Io(e)
            }
        })?;

        let updated_at: DateTime<Utc> = metadata
            .modified()
            .map(|t| t.into())
            .unwrap_or_else(|_| Utc::now());

        let raw = fs::read_to_string(&path).await.map_err(StoreError::Io)?;
        let raw = raw.replace('\r', "");

        self.parse_metadata(rel_path, &raw, updated_at)
    }

    /// Reads and returns the content of the file at `rel_path`.
    pub async fn load_content(&self, rel_path: &str) -> StoreResult<FileContent> {
        let path = self.full_path(rel_path);

        let raw = fs::read_to_string(&path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                StoreError::NotFound { path: rel_path.to_string() }
            } else {
                StoreError::Io(e)
            }
        })?;
        let raw = raw.replace('\r', "");

        let content = if raw.starts_with("---\n") {
            let rest = &raw[4..];
            match rest.find("\n---\n") {
                Some(close) => rest[close + 5..].trim_start_matches('\n').to_string(),
                None => raw,
            }
        } else {
            raw
        };

        Ok(FileContent { content })
    }

    fn parse_metadata(
        &self,
        rel_path: &str,
        raw: &str,
        updated_at: DateTime<Utc>,
    ) -> StoreResult<FileEntry> {
        let abs_path = format!("/{rel_path}");

        if raw.starts_with("---\n") {
            let rest = &raw[4..];
            let close = rest.find("\n---\n").ok_or_else(|| StoreError::Parse {
                file: rel_path.to_string(),
                message: "unclosed front matter".into(),
            })?;

            let fm: FrontMatter =
                serde_yaml_ng::from_str(&rest[..close]).map_err(|e| StoreError::Parse {
                    file: rel_path.to_string(),
                    message: e.to_string(),
                })?;

            Ok(FileEntry {
                path: abs_path,
                title: fm.title,
                tags: fm.tags,
                created_at: fm.created_at,
                updated_at,
            })
        } else {
            let title = raw
                .lines()
                .find(|l| l.starts_with("# "))
                .map(|l| l[2..].trim().to_string())
                .unwrap_or_else(|| stem_from_path(rel_path));

            Ok(FileEntry {
                path: abs_path,
                title,
                tags: Vec::new(),
                created_at: updated_at,
                updated_at,
            })
        }
    }

    fn serialize(title: &str, tags: &[String], created_at: &DateTime<Utc>, content: &str) -> String {
        // No title and no tags → write a naked file. created_at is recovered
        // from filesystem mtime, same as any other foreign Markdown file.
        if title.is_empty() && tags.is_empty() {
            return content.to_string();
        }
        let fm = FrontMatterOut {
            title,
            tags,
            created_at: created_at.to_rfc3339(),
        };
        let yaml = serde_yaml_ng::to_string(&fm).unwrap_or_default();
        format!("---\n{yaml}---\n\n{content}")
    }

    /// Creates a new file at `rel_path` with the given metadata and content.
    ///
    /// Returns [`StoreError::Conflict`] if the file already exists.
    pub async fn create(
        &self,
        rel_path: &str,
        title: String,
        tags: Vec<String>,
        content: String,
    ) -> StoreResult<FileEntry> {
        let path = self.full_path(rel_path);

        if fs::metadata(&path).await.is_ok() {
            return Err(StoreError::Conflict { path: rel_path.to_string() });
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await.map_err(StoreError::Io)?;
        }

        let now = Utc::now();
        fs::write(&path, Self::serialize(&title, &tags, &now, &content))
            .await
            .map_err(StoreError::Io)?;

        self.load_metadata(rel_path).await
    }

    /// Overwrites the content of an existing file, preserving its `created_at`.
    pub async fn save(
        &self,
        rel_path: &str,
        title: String,
        tags: Vec<String>,
        content: String,
    ) -> StoreResult<FileEntry> {
        let existing = self.load_metadata(rel_path).await?;
        let path = self.full_path(rel_path);

        fs::write(
            &path,
            Self::serialize(&title, &tags, &existing.created_at, &content),
        )
        .await
        .map_err(StoreError::Io)?;

        self.load_metadata(rel_path).await
    }

    /// Deletes the file or directory at `rel_path`.
    /// Directories are deleted recursively.
    pub async fn delete_entry(&self, rel_path: &str) -> StoreResult<()> {
        let path = self.full_path(rel_path);

        let metadata = fs::metadata(&path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                StoreError::NotFound { path: rel_path.to_string() }
            } else {
                StoreError::Io(e)
            }
        })?;

        if metadata.is_dir() {
            fs::remove_dir_all(&path).await.map_err(StoreError::Io)
        } else {
            fs::remove_file(&path).await.map_err(StoreError::Io)
        }
    }

    /// Creates a directory at `rel_path` (including any missing parents).
    ///
    /// Returns [`StoreError::Conflict`] if something already exists at that path.
    pub async fn create_dir(&self, rel_path: &str) -> StoreResult<()> {
        let path = self.full_path(rel_path);

        if fs::metadata(&path).await.is_ok() {
            return Err(StoreError::Conflict { path: rel_path.to_string() });
        }

        fs::create_dir_all(&path).await.map_err(StoreError::Io)
    }

    /// Renames/moves an entry within this Store's data directory.
    pub async fn rename_entry(&self, from_rel: &str, to_rel: &str) -> StoreResult<()> {
        let src = self.full_path(from_rel);
        let dst = self.full_path(to_rel);

        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).await.map_err(StoreError::Io)?;
        }

        fs::rename(&src, &dst).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                StoreError::NotFound { path: from_rel.to_string() }
            } else {
                StoreError::Io(e)
            }
        })
    }
}

/// Converts a title into a URL-safe filename stem.
///
/// ```
/// # use wrazz_backend::slugify;
/// assert_eq!(slugify("Evening Thoughts!"), "evening-thoughts");
/// assert_eq!(slugify("  -- hello --  "), "hello");
/// ```
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

fn stem_from_path(rel_path: &str) -> String {
    Path::new(rel_path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| rel_path.to_string())
}
