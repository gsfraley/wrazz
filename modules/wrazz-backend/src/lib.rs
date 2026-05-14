//! File I/O layer and workspace registry for wrazz.
//!
//! This crate provides:
//!
//! - [`LocalWorkspace`] — a [`Workspace`] implementation backed by a local
//!   filesystem directory via [`Store`].
//! - [`WorkspaceRegistry`] — an in-memory registry of [`Workspace`] trait
//!   objects, shared between async tasks via `Arc`.
//! - [`RegistryBackend`] — a [`Backend`] adapter over a [`WorkspaceRegistry`],
//!   routing multi-workspace `Backend` calls to the matching workspace.
//! - [`HttpBackend`] — proxies all operations to a remote `wrazz-server`
//!   over HTTP. Used when acting as a BFF in front of a separate server.
//!
//! [`Store`] is also public so that `wrazz-server` can create per-workspace
//! instances directly without going through a `Workspace` wrapper.
//!
//! [`Backend`]: wrazz_core::Backend
//! [`Workspace`]: wrazz_core::Workspace

pub mod http_backend;
pub mod local_workspace;
pub mod registry_backend;
pub mod routes;
pub mod store;
pub mod workspace_registry;

pub use http_backend::HttpBackend;
pub use local_workspace::LocalWorkspace;
pub use registry_backend::RegistryBackend;
pub use store::{Store, StoreError, slugify};
pub use workspace_registry::WorkspaceRegistry;

/// Shared API response type for `GET /api/version`.
#[derive(serde::Serialize)]
pub struct VersionResponse {
    pub version: &'static str,
}
