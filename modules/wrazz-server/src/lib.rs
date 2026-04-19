use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A wrazz user. Each user's journal lives in its own directory keyed by id.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
}
