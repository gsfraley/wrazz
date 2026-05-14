//! Filesystem migration runner.
//!
//! On each startup, [`run`] reads `<data_dir>/.migrated` (which stores the
//! last successfully migrated version), compares it to the current binary
//! version, and executes any registered filesystem migrations whose version
//! gate exceeds the recorded version.  After all migrations pass, the current
//! version is written back to `.migrated`.
//!
//! ## Adding a new migration
//!
//! 1. Write an `async fn` with signature `async fn my_migration(data_dir:
//!    &Path, pool: &SqlitePool) -> Result<(), MigrateError>`.
//! 2. Add an entry to [`MIGRATIONS`] with the minimum version that triggers it
//!    and a pointer to the function.
//!
//! Migrations are run in declaration order and are idempotent by convention.

use std::path::Path;

use sqlx::SqlitePool;
use uuid::Uuid;

/// A single registered filesystem migration.
struct Migration {
    /// The migration runs when the recorded version is strictly less than this.
    version_gate: (u32, u32, u32),
    label: &'static str,
    run: for<'a> fn(&'a Path, &'a SqlitePool)
        -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), MigrateError>> + Send + 'a>>,
}

// Shim: wraps the async fn so it satisfies the for<'a> fn pointer bound.
fn run_v0_2_0<'a>(
    data_dir: &'a Path,
    pool: &'a SqlitePool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), MigrateError>> + Send + 'a>> {
    Box::pin(migrate_v0_2_0_nest_workspaces(data_dir, pool))
}

/// All registered filesystem migrations, in version order.
static MIGRATIONS: &[Migration] = &[
    Migration {
        version_gate: (0, 2, 0),
        label: "nest workspace files under UUID subdirectory",
        run: run_v0_2_0,
    },
];

// --- Error type ---

#[derive(Debug, thiserror::Error)]
pub enum MigrateError {
    #[error("I/O error during filesystem migration: {0}")]
    Io(#[from] std::io::Error),
    #[error("database error during filesystem migration: {0}")]
    Db(#[from] sqlx::Error),
}

// --- Entry point ---

/// Runs all pending filesystem migrations against `data_dir`.
///
/// Reads `<data_dir>/.migrated` to determine the last completed version (absent
/// → `0.0.0`). Runs every migration whose `version_gate` exceeds that. Writes
/// the current binary version back on success.
pub async fn run(data_dir: &Path, pool: &SqlitePool) -> Result<(), MigrateError> {
    let migrated_file = data_dir.join(".migrated");
    let last = read_version(&migrated_file).await;
    let current = parse_version(env!("CARGO_PKG_VERSION")).unwrap_or((0, 99, 99));

    for m in MIGRATIONS {
        if last < m.version_gate {
            tracing::info!("running fs migration (gate={}.{}.{}): {}", m.version_gate.0, m.version_gate.1, m.version_gate.2, m.label);
            (m.run)(data_dir, pool).await?;
            tracing::info!("fs migration complete: {}", m.label);
        }
    }

    // Write current version regardless — bumps the recorded version even when
    // no migrations ran, so future runs don't re-evaluate already-passed gates.
    if current > last {
        let ver = env!("CARGO_PKG_VERSION");
        tokio::fs::write(&migrated_file, ver).await?;
    }

    Ok(())
}

// --- Helpers ---

async fn read_version(path: &Path) -> (u32, u32, u32) {
    match tokio::fs::read_to_string(path).await {
        Ok(s) => parse_version(s.trim()).unwrap_or((0, 0, 0)),
        Err(_) => (0, 0, 0),
    }
}

fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    let mut parts = s.splitn(3, '.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()
        // Strip any pre-release suffix (e.g. "0-alpha.1" → "0")
        .and_then(|p| p.split('-').next())
        .and_then(|p| p.parse().ok())?;
    Some((major, minor, patch))
}

// --- v0.2.0: nest each user's files under their workspace UUID ---

/// Moves each user's files from `<data_dir>/<user_id>/` into
/// `<data_dir>/<user_id>/<workspace_id>/`.
///
/// Idempotent: if all non-UUID children are already gone, it's a no-op.
/// Does NOT skip just because the workspace dir exists — that dir may have
/// been created empty by `get_or_init` before this migration had a chance to
/// run, which is the exact scenario we need to handle.
async fn migrate_v0_2_0_nest_workspaces(
    data_dir: &Path,
    pool: &SqlitePool,
) -> Result<(), MigrateError> {
    // users.id is a 16-byte BLOB; decode it as Uuid directly (CAST to TEXT
    // reinterprets binary bytes as UTF-8 and panics). workspaces.id is TEXT.
    let rows: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT u.id, w.id \
         FROM users u \
         JOIN workspaces w ON w.user_id = u.id",
    )
    .fetch_all(pool)
    .await?;

    for (user_id, workspace_id_str) in rows {
        let user_id_str = user_id.to_string();
        let user_dir = data_dir.join(&user_id_str);
        let workspace_dir = user_dir.join(&workspace_id_str);

        if !user_dir.exists() {
            tracing::info!("migration v0.2.0: {user_id_str}/ not found, nothing to migrate");
            continue;
        }

        // Collect direct children of the user dir that should move into the
        // workspace subdir. Skip the workspace dir itself and any other
        // UUID-named dirs (those are already-migrated sibling workspaces).
        let mut reader = tokio::fs::read_dir(&user_dir).await?;
        let mut children = Vec::new();
        while let Some(entry) = reader.next_entry().await? {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == workspace_id_str || looks_like_uuid(&name) {
                tracing::debug!("migration v0.2.0: skipping UUID-named entry: {name}");
            } else {
                tracing::info!("migration v0.2.0: will move: {user_id_str}/{name}");
                children.push(entry.path());
            }
        }

        if children.is_empty() {
            tracing::info!("migration v0.2.0: {user_id_str}/{workspace_id_str}/ already up to date");
            continue;
        }

        // Create the workspace dir (ok if it already exists from get_or_init).
        tokio::fs::create_dir_all(&workspace_dir).await?;

        let mut moved = 0usize;
        for child in &children {
            let name = child.file_name().unwrap_or_default();
            let dst = workspace_dir.join(name);
            match tokio::fs::rename(child, &dst).await {
                Ok(()) => {
                    moved += 1;
                    tracing::info!(
                        "migration v0.2.0: moved {} → {}",
                        child.display(),
                        dst.display()
                    );
                }
                Err(e) => tracing::warn!(
                    "migration v0.2.0: could not move {} → {}: {e}",
                    child.display(),
                    dst.display()
                ),
            }
        }

        tracing::info!(
            "migration v0.2.0: {user_id_str}/{workspace_id_str}/ — {moved}/{} entries moved",
            children.len()
        );
    }

    Ok(())
}

fn looks_like_uuid(s: &str) -> bool {
    // UUID v4 canonical form: 8-4-4-4-12 hex chars separated by hyphens (36 chars total).
    if s.len() != 36 { return false; }
    s.chars().enumerate().all(|(i, c)| {
        if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() }
    })
}

async fn children_count(dir: &Path) -> usize {
    let Ok(mut rd) = tokio::fs::read_dir(dir).await else { return 0 };
    let mut n = 0usize;
    while rd.next_entry().await.ok().flatten().is_some() { n += 1; }
    n
}
