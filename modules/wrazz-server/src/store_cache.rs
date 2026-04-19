use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use tokio::sync::RwLock;
use uuid::Uuid;
use wrazz_backend::Store;

const CACHE_TTL: Duration = Duration::from_secs(300);

struct CachedStore {
    store: Arc<Store>,
    last_used: Instant,
}

/// In-memory cache of per-user [`Store`] instances.
///
/// Opening a `Store` is cheap (it's just a `PathBuf`), but creating the
/// underlying directory and checking its existence on every request adds up.
/// The cache keeps each user's `Store` alive for [`CACHE_TTL`] (5 minutes)
/// after their last request, then drops it on the next [`evict_expired`] call.
///
/// The cache is keyed by user UUID because that is also the directory name,
/// making lookups a direct map hit rather than a path construction.
///
/// [`evict_expired`]: StoreCache::evict_expired
pub struct StoreCache {
    inner: RwLock<HashMap<Uuid, CachedStore>>,
    base_dir: PathBuf,
}

impl StoreCache {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
            base_dir: base_dir.into(),
        }
    }

    /// Returns the `Store` for `user_id`, creating and caching it on first
    /// access. The per-user directory (`<base_dir>/<user_id>/`) is created
    /// if it doesn't already exist.
    ///
    /// Uses a double-checked pattern: a write lock is taken on both the fast
    /// path (to update `last_used`) and the slow path (to insert), but the
    /// directory creation happens outside any lock to avoid blocking other
    /// users during filesystem I/O.
    pub async fn get_or_create(&self, user_id: Uuid) -> Result<Arc<Store>, std::io::Error> {
        // Fast path: already cached.
        {
            let mut inner = self.inner.write().await;
            if let Some(entry) = inner.get_mut(&user_id) {
                entry.last_used = Instant::now();
                return Ok(Arc::clone(&entry.store));
            }
        }

        // Slow path: create directory and store, then re-lock to insert.
        let user_dir = self.base_dir.join(user_id.to_string());
        tokio::fs::create_dir_all(&user_dir).await?;
        let store = Arc::new(Store::new(user_dir));

        let mut inner = self.inner.write().await;
        // Another task may have won the race; if so, use theirs.
        if let Some(entry) = inner.get_mut(&user_id) {
            entry.last_used = Instant::now();
            return Ok(Arc::clone(&entry.store));
        }
        inner.insert(
            user_id,
            CachedStore {
                store: Arc::clone(&store),
                last_used: Instant::now(),
            },
        );
        Ok(store)
    }

    /// Drops entries that haven't been accessed within [`CACHE_TTL`].
    /// Called hourly by the background cleanup task in `main`.
    pub async fn evict_expired(&self) {
        self.inner
            .write()
            .await
            .retain(|_, v| v.last_used.elapsed() < CACHE_TTL);
    }
}
