use async_trait::async_trait;
use reqwest::{Client, StatusCode};
use wrazz_core::{Backend, BackendError, BackendResult, Entry, FileContent, FileEntry};

/// [`Backend`] implementation that proxies all operations to a remote
/// `wrazz-server` over HTTP.
///
/// The `workspace` parameter is forwarded on every request as a `?workspace=`
/// query param. The server currently derives the workspace from the session
/// cookie and ignores it, but it is included preemptively so the wire format
/// is ready for multi-workspace support.
///
/// For `move_entry`, the source workspace is `?workspace=` and the destination
/// workspace is `to_workspace` in the request body.
pub struct HttpBackend {
    base_url: String,
    client: Client,
}

impl HttpBackend {
    /// Creates a new `HttpBackend` targeting `base_url`.
    ///
    /// `base_url` should be scheme + host + optional port, no trailing slash —
    /// e.g. `"http://localhost:3001"`.
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            client: Client::new(),
        }
    }

    fn entries_url(&self) -> String {
        format!("{}/api/entries", self.base_url)
    }

    fn files_url(&self) -> String {
        format!("{}/api/files", self.base_url)
    }

    fn content_url(&self) -> String {
        format!("{}/api/content", self.base_url)
    }

    fn dirs_url(&self) -> String {
        format!("{}/api/dirs", self.base_url)
    }

    /// Strips the leading `/` from a Backend path for use in URLs.
    fn url_path(path: &str) -> &str {
        path.trim_start_matches('/')
    }
}

async fn error_from_response(resp: reqwest::Response, path: &str) -> BackendError {
    match resp.status() {
        StatusCode::NOT_FOUND => BackendError::NotFound(path.to_string()),
        StatusCode::CONFLICT => BackendError::Conflict(path.to_string()),
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
    async fn list_entries(&self, workspace: &str, path: &str) -> BackendResult<Vec<Entry>> {
        let resp = self
            .client
            .get(self.entries_url())
            .query(&[("workspace", workspace), ("path", path)])
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            resp.json::<Vec<Entry>>()
                .await
                .map_err(|e| BackendError::Internal(Box::new(e)))
        } else {
            Err(error_from_response(resp, path).await)
        }
    }

    async fn get_file(&self, workspace: &str, path: &str) -> BackendResult<FileEntry> {
        let url = format!("{}/{}", self.files_url(), Self::url_path(path));
        let resp = self
            .client
            .get(&url)
            .query(&[("workspace", workspace)])
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            resp.json::<FileEntry>()
                .await
                .map_err(|e| BackendError::Internal(Box::new(e)))
        } else {
            Err(error_from_response(resp, path).await)
        }
    }

    async fn get_file_content(&self, workspace: &str, path: &str) -> BackendResult<FileContent> {
        let url = format!("{}/{}", self.content_url(), Self::url_path(path));
        let resp = self
            .client
            .get(&url)
            .query(&[("workspace", workspace)])
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            resp.json::<FileContent>()
                .await
                .map_err(|e| BackendError::Internal(Box::new(e)))
        } else {
            Err(error_from_response(resp, path).await)
        }
    }

    async fn create_file(
        &self,
        workspace: &str,
        path: &str,
        title: String,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        let url = format!("{}/{}", self.files_url(), Self::url_path(path));
        let resp = self
            .client
            .post(&url)
            .query(&[("workspace", workspace)])
            .json(&serde_json::json!({ "title": title, "tags": tags, "content": content }))
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            resp.json::<FileEntry>()
                .await
                .map_err(|e| BackendError::Internal(Box::new(e)))
        } else {
            Err(error_from_response(resp, path).await)
        }
    }

    async fn update_file(
        &self,
        workspace: &str,
        path: &str,
        title: String,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        let url = format!("{}/{}", self.files_url(), Self::url_path(path));
        let resp = self
            .client
            .put(&url)
            .query(&[("workspace", workspace)])
            .json(&serde_json::json!({ "title": title, "tags": tags, "content": content }))
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            resp.json::<FileEntry>()
                .await
                .map_err(|e| BackendError::Internal(Box::new(e)))
        } else {
            Err(error_from_response(resp, path).await)
        }
    }

    async fn delete_entry(&self, workspace: &str, path: &str) -> BackendResult<()> {
        let url = format!("{}/{}", self.entries_url(), Self::url_path(path));
        let resp = self
            .client
            .delete(&url)
            .query(&[("workspace", workspace)])
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() { Ok(()) } else { Err(error_from_response(resp, path).await) }
    }

    async fn create_dir(&self, workspace: &str, path: &str) -> BackendResult<()> {
        let url = format!("{}/{}", self.dirs_url(), Self::url_path(path));
        let resp = self
            .client
            .post(&url)
            .query(&[("workspace", workspace)])
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() { Ok(()) } else { Err(error_from_response(resp, path).await) }
    }

    async fn move_entry(
        &self,
        ws_from: &str,
        path_from: &str,
        ws_to: &str,
        path_to: &str,
    ) -> BackendResult<()> {
        let url = format!("{}/{}", self.entries_url(), Self::url_path(path_from));
        let resp = self
            .client
            .patch(&url)
            .query(&[("workspace", ws_from)])
            .json(&serde_json::json!({ "to_workspace": ws_to, "to_path": path_to }))
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() { Ok(()) } else { Err(error_from_response(resp, path_from).await) }
    }
}
