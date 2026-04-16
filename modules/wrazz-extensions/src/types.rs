use wrazz_core::entry::Entry;

/// Mirror of the WIT `entry-meta` record, used at the host/guest boundary.
#[derive(Debug, Clone)]
pub struct EntryMeta {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub tags: Vec<String>,
}

impl From<&Entry> for EntryMeta {
    fn from(e: &Entry) -> Self {
        Self {
            id: e.id.to_string(),
            title: e.title.clone(),
            created_at: e.created_at.timestamp() as u64,
            updated_at: e.updated_at.timestamp() as u64,
            tags: e.tags.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SlotOutput {
    pub slot: String,
    pub html: String,
}
