//! Core types and the storage abstraction for wrazz.
//!
//! This crate defines the vocabulary shared by every layer of the stack:
//!
//! - [`FileEntry`] — the in-memory representation of a note or journal file.
//! - [`Backend`] — the async trait that storage implementations satisfy.
//! - [`BackendError`] / [`BackendResult`] — the error type returned by all
//!   backend operations.
//!
//! Nothing in this crate performs I/O or knows about HTTP. It is a pure
//! type library that `wrazz-backend` and `wrazz-server` both depend on.

pub mod backend;
pub mod entry;

pub use backend::{Backend, BackendError, BackendResult};
pub use entry::FileEntry;
