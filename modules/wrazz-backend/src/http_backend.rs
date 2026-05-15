use async_trait::async_trait;
use reqwest::{Client, StatusCode};
use wrazz_core::{Backend, BackendError, BackendResult, Entry, FileContent, FileEntry};

/// [`Backend`] implementation that proxies all operations to a remote
/// `wrazz-server` over HTTP.
///
/// All file routes are under `/api/workspaces/{workspace_id}/...` and the
/// workspace ID is embedded directly in the URL path.
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

    fn workspace_base(&self, workspace: &str) -> String {
        format!("{}/api/v1/workspaces/{}", self.base_url, workspace)
    }

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
        let url = format!("{}/entries", self.workspace_base(workspace));
        let resp = self
            .client
            .get(&url)
            .query(&[("path", path)])
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
        let url = format!("{}/files/{}", self.workspace_base(workspace), Self::url_path(path));
        let resp = self
            .client
            .get(&url)
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
        let url = format!("{}/content/{}", self.workspace_base(workspace), Self::url_path(path));
        let resp = self
            .client
            .get(&url)
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
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        let url = format!("{}/files/{}", self.workspace_base(workspace), Self::url_path(path));
        let resp = self
            .client
            .post(&url)
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
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        let url = format!("{}/files/{}", self.workspace_base(workspace), Self::url_path(path));
        let resp = self
            .client
            .put(&url)
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
        let url = format!("{}/entries/{}", self.workspace_base(workspace), Self::url_path(path));
        let resp = self
            .client
            .delete(&url)
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() { Ok(()) } else { Err(error_from_response(resp, path).await) }
    }

    async fn create_dir(&self, workspace: &str, path: &str) -> BackendResult<()> {
        let url = format!("{}/dirs/{}", self.workspace_base(workspace), Self::url_path(path));
        let resp = self
            .client
            .post(&url)
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
        let url = format!("{}/entries/{}", self.workspace_base(ws_from), Self::url_path(path_from));
        let resp = self
            .client
            .patch(&url)
            .json(&serde_json::json!({ "to_workspace": ws_to, "to_path": path_to }))
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() { Ok(()) } else { Err(error_from_response(resp, path_from).await) }
    }
}
