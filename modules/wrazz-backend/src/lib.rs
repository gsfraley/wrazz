//! File I/O layer and HTTP proxy backend for wrazz.
//!
//! This crate provides two implementations of the [`Backend`] trait from
//! `wrazz-core`, plus the [`Store`] that underpins local file access:
//!
//! - [`LocalBackend`] — wraps a [`Store`] to serve files directly from the
//!   local filesystem. Used when `wrazz-backend` runs in standalone mode.
//! - [`HttpBackend`] — proxies all operations to a remote `wrazz-server`
//!   over HTTP. Used when the binary is acting as a BFF in front of a
//!   separate server process.
//!
//! [`Store`] itself is also public so that `wrazz-server` can create
//! per-user instances directly without going through a `Backend` wrapper.
//!
//! [`Backend`]: wrazz_core::Backend

pub mod http_backend;
pub mod local_backend;
pub mod store;

pub use http_backend::HttpBackend;
pub use local_backend::LocalBackend;
pub use store::{Store, StoreError, slugify};
