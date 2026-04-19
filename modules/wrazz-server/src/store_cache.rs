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

    /// Returns the `Store` for the given user, creating and caching it on first access.
    /// The per-user directory is created if it doesn't exist.
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

    /// Remove entries that haven't been accessed within the TTL.
    pub async fn evict_expired(&self) {
        self.inner
            .write()
            .await
            .retain(|_, v| v.last_used.elapsed() < CACHE_TTL);
    }
}
