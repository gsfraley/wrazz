use async_trait::async_trait;
use reqwest::{Client, StatusCode};
use wrazz_core::{Backend, BackendError, BackendResult, FileEntry};

pub struct HttpBackend {
    base_url: String,
    client: Client,
}

impl HttpBackend {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            client: Client::new(),
        }
    }

    /// URL for the files collection endpoint.
    fn files_url(&self) -> String {
        format!("{}/api/files", self.base_url)
    }

    /// URL for a specific file. Slashes in the ID are percent-encoded so the
    /// path segment stays intact.
    fn file_url(&self, id: &str) -> String {
        format!("{}/{}", self.files_url(), id.replace('/', "%2F"))
    }
}

/// Maps a non-2xx response to a `BackendError`.
/// `id` is passed in for `NotFound`/`Conflict` since those variants carry it.
async fn error_from_response(resp: reqwest::Response, id: &str) -> BackendError {
    match resp.status() {
        StatusCode::NOT_FOUND => BackendError::NotFound(id.to_string()),
        StatusCode::CONFLICT => BackendError::Conflict(id.to_string()),
        status => {
            let body = resp.text().await.unwrap_or_default();
            BackendError::Internal(Box::new(std::io::Error::other(format!(
                "backend returned {status}: {body}"
            ))))
        }
    }
}

#[async_trait]
impl Backend for HttpBackend {
    async fn list_files(&self) -> BackendResult<Vec<FileEntry>> {
        let resp = self
            .client
            .get(self.files_url())
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            resp.json::<Vec<FileEntry>>()
                .await
                .map_err(|e| BackendError::Internal(Box::new(e)))
        } else {
            Err(error_from_response(resp, "").await)
        }
    }

    async fn get_file(&self, id: &str) -> BackendResult<FileEntry> {
        let resp = self
            .client
            .get(self.file_url(id))
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            resp.json::<FileEntry>()
                .await
                .map_err(|e| BackendError::Internal(Box::new(e)))
        } else {
            Err(error_from_response(resp, id).await)
        }
    }

    async fn create_file(
        &self,
        title: String,
        content: String,
        tags: Vec<String>,
    ) -> BackendResult<FileEntry> {
        let resp = self
            .client
            .post(self.files_url())
            .json(&serde_json::json!({ "title": title, "content": content, "tags": tags }))
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            resp.json::<FileEntry>()
                .await
                .map_err(|e| BackendError::Internal(Box::new(e)))
        } else {
            Err(error_from_response(resp, &title).await)
        }
    }

    async fn update_file(
        &self,
        id: &str,
        title: String,
        content: String,
        tags: Vec<String>,
    ) -> BackendResult<FileEntry> {
        let resp = self
            .client
            .put(self.file_url(id))
            .json(&serde_json::json!({ "title": title, "content": content, "tags": tags }))
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            resp.json::<FileEntry>()
                .await
                .map_err(|e| BackendError::Internal(Box::new(e)))
        } else {
            Err(error_from_response(resp, id).await)
        }
    }

    async fn delete_file(&self, id: &str) -> BackendResult<()> {
        let resp = self
            .client
            .delete(self.file_url(id))
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(error_from_response(resp, id).await)
        }
    }
}
