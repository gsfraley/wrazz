//! Remote workspace: proxies file operations to a wrazz-server over HTTP.
//!
//! [`RemoteWorkspace`] implements [`Workspace`] by forwarding every call to
//! the corresponding REST endpoint on a remote `wrazz-server`, authenticating
//! with a Bearer API token.
//!
//! [`RemoteWorkspaceConfig`] is the serialisable configuration stored in the
//! desktop's workspace config file. It holds everything needed to reconstruct
//! a [`RemoteWorkspace`].

use async_trait::async_trait;
use reqwest::{
    header::{self, HeaderMap, HeaderValue},
    Client, StatusCode,
};
use serde::{Deserialize, Serialize};
use wrazz_core::{BackendError, BackendResult, Entry, FileContent, FileEntry, Workspace};

/// Serialisable configuration for a [`RemoteWorkspace`].
///
/// Store this in the desktop's workspace config file; pass it to
/// [`RemoteWorkspace::new`] to reconstruct the live workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteWorkspaceConfig {
    /// The workspace UUID on the remote server.
    pub id: String,
    /// Cached display name. May be stale; refreshed on reconnect.
    pub name: String,
    /// Base URL of the remote `wrazz-server`, e.g. `"https://wrazz.fraley.dev"`.
    /// No trailing slash.
    pub server_url: String,
    /// Raw Bearer token. Stored by the desktop's secure config.
    pub token: String,
}

/// [`Workspace`] implementation that proxies all file operations to a remote
/// `wrazz-server` over HTTP, authenticating with a Bearer API token.
pub struct RemoteWorkspace {
    config: RemoteWorkspaceConfig,
    client: Client,
}

impl RemoteWorkspace {
    /// Creates a new `RemoteWorkspace` from the given config.
    ///
    /// Builds a `reqwest::Client` with the Bearer token pre-configured as a
    /// default header so every request is authenticated automatically.
    ///
    /// # Panics
    ///
    /// Panics if the token contains characters that are invalid in an HTTP
    /// header value (i.e. non-ASCII or ASCII control characters).
    pub fn new(config: RemoteWorkspaceConfig) -> Self {
        let mut auth_value =
            HeaderValue::from_str(&format!("Bearer {}", config.token))
                .expect("token must be a valid HTTP header value");
        auth_value.set_sensitive(true);

        let mut default_headers = HeaderMap::new();
        default_headers.insert(header::AUTHORIZATION, auth_value);

        let client = Client::builder()
            .user_agent("wrazz-desktop")
            .default_headers(default_headers)
            .build()
            .expect("failed to build reqwest client");

        Self { config, client }
    }

    /// Returns the base URL for all workspace endpoints:
    /// `{server_url}/api/workspaces/{id}`.
    fn workspace_base(&self) -> String {
        format!("{}/api/workspaces/{}", self.config.server_url, self.config.id)
    }

    /// Strips a leading `/` from `path` so it can be appended to a URL
    /// without producing a double slash.
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
impl Workspace for RemoteWorkspace {
    fn id(&self) -> &str {
        &self.config.id
    }

    fn name(&self) -> &str {
        &self.config.name
    }

    async fn list_entries(&self, path: &str) -> BackendResult<Vec<Entry>> {
        let url = format!("{}/entries", self.workspace_base());
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

    async fn get_file(&self, path: &str) -> BackendResult<FileEntry> {
        let url = format!("{}/files/{}", self.workspace_base(), Self::url_path(path));
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

    async fn get_file_content(&self, path: &str) -> BackendResult<FileContent> {
        let url = format!("{}/content/{}", self.workspace_base(), Self::url_path(path));
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
        path: &str,
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        let url = format!("{}/files/{}", self.workspace_base(), Self::url_path(path));
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
        path: &str,
        title: Option<String>,
        tags: Vec<String>,
        content: String,
    ) -> BackendResult<FileEntry> {
        let url = format!("{}/files/{}", self.workspace_base(), Self::url_path(path));
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

    async fn delete_entry(&self, path: &str) -> BackendResult<()> {
        let url = format!("{}/entries/{}", self.workspace_base(), Self::url_path(path));
        let resp = self
            .client
            .delete(&url)
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(error_from_response(resp, path).await)
        }
    }

    async fn create_dir(&self, path: &str) -> BackendResult<()> {
        let url = format!("{}/dirs/{}", self.workspace_base(), Self::url_path(path));
        let resp = self
            .client
            .post(&url)
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(error_from_response(resp, path).await)
        }
    }

    async fn move_entry(&self, path_from: &str, path_to: &str) -> BackendResult<()> {
        let url = format!("{}/entries/{}", self.workspace_base(), Self::url_path(path_from));
        let resp = self
            .client
            .patch(&url)
            .json(&serde_json::json!({ "to_path": path_to }))
            .send()
            .await
            .map_err(|e| BackendError::Internal(Box::new(e)))?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(error_from_response(resp, path_from).await)
        }
    }

    async fn walk_files(&self, path: &str) -> BackendResult<Vec<String>> {
        let mut result = Vec::new();
        let entries = self.list_entries(path).await?;
        for entry in entries {
            match entry {
                Entry::File(f) => result.push(f.path),
                Entry::Dir(d) => {
                    let sub = Box::pin(self.walk_files(&d.path)).await?;
                    result.extend(sub);
                }
            }
        }
        Ok(result)
    }
}
