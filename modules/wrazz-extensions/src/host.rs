use std::path::Path;

use anyhow::Result;
use tracing::warn;
use wasmtime::component::{Component, Linker};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiView};

use crate::types::{EntryMeta, SlotOutput};

struct ExtensionState {
    wasi: WasiCtx,
    table: wasmtime_wasi::ResourceTable,
}

impl WasiView for ExtensionState {
    fn ctx(&mut self) -> &mut WasiCtx {
        &mut self.wasi
    }
    fn table(&mut self) -> &mut wasmtime_wasi::ResourceTable {
        &mut self.table
    }
}

/// A loaded WASM extension. Cheap to clone (Engine is Arc-backed).
pub struct Extension {
    engine: Engine,
    component: Component,
    name: String,
}

impl Extension {
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let name = path
            .as_ref()
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let mut config = Config::new();
        config.wasm_component_model(true);
        config.async_support(false);

        let engine = Engine::new(&config)?;
        let component = Component::from_file(&engine, path)?;

        Ok(Self { engine, component, name })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    fn make_store(&self) -> Result<Store<ExtensionState>> {
        let wasi = WasiCtxBuilder::new().build();
        let state = ExtensionState {
            wasi,
            table: wasmtime_wasi::ResourceTable::new(),
        };
        Ok(Store::new(&self.engine, state))
    }

    /// Run the `ui::render` export and return slot outputs.
    pub fn render(&self, meta: &EntryMeta) -> Vec<SlotOutput> {
        // Placeholder until wasmtime bindgen! macro is wired up with the generated bindings.
        // Returns empty — the host renders nothing until the extension provides slots.
        let _ = (meta, self.make_store());
        vec![]
    }

    /// Run the `hooks::on-before-save` export. Returns the (possibly transformed) content.
    pub fn on_before_save(&self, content: &str, meta: &EntryMeta) -> String {
        let _ = (meta, self.make_store());
        content.to_string()
    }
}

/// Manages all loaded extensions for a running wrazz instance.
pub struct ExtensionHost {
    extensions: Vec<Extension>,
}

impl ExtensionHost {
    pub fn new() -> Self {
        Self { extensions: vec![] }
    }

    pub fn load_from_dir(&mut self, dir: impl AsRef<Path>) -> Result<()> {
        let dir = dir.as_ref();
        if !dir.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) == Some("wasm") {
                match Extension::load(&path) {
                    Ok(ext) => {
                        tracing::info!("loaded extension: {}", ext.name());
                        self.extensions.push(ext);
                    }
                    Err(e) => warn!("failed to load {:?}: {e:#}", path),
                }
            }
        }
        Ok(())
    }

    /// Collect all slot outputs from all extensions for the given entry.
    pub fn render_all(&self, meta: &EntryMeta) -> Vec<SlotOutput> {
        self.extensions.iter().flat_map(|e| e.render(meta)).collect()
    }

    /// Run on-before-save through all extensions in load order.
    pub fn before_save(&self, content: &str, meta: &EntryMeta) -> String {
        self.extensions
            .iter()
            .fold(content.to_string(), |c, e| e.on_before_save(&c, meta))
    }
}

impl Default for ExtensionHost {
    fn default() -> Self {
        Self::new()
    }
}
