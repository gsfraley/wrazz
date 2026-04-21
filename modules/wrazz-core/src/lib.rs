//! Core types and the storage abstraction for wrazz.
//!
//! - [`FileEntry`] / [`DirEntry`] / [`Entry`] — metadata types for files and directories.
//! - [`FileContent`] — the content of a single file, separate from its metadata.
//! - [`Backend`] — the async trait that storage implementations satisfy.
//! - [`BackendError`] / [`BackendResult`] — error type returned by all backend operations.

pub mod backend;
pub mod entry;

pub use backend::{Backend, BackendError, BackendResult};
pub use entry::{DirEntry, Entry, FileContent, FileEntry};
