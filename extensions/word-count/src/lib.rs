//! word-count — lamppost extension for wrazz
//!
//! The simplest possible extension: counts words in the current entry and
//! injects the result into the "status-bar" slot. Read this to understand
//! how to implement the wrazz extension WIT interface.

wit_bindgen::generate!({
    path: "../../wit",
    world: "extension",
});

struct WordCount;

impl Guest for WordCount {
    fn on_before_save(content: String, _meta: EntryMeta) -> String {
        // This extension doesn't transform content — pass through unchanged.
        content
    }

    fn on_after_save(_meta: EntryMeta) {
        // Nothing to do.
    }

    fn on_entry_open(_meta: EntryMeta) {
        // Nothing to do.
    }

    fn render(meta: EntryMeta) -> Vec<SlotOutput> {
        // We don't have the content here (render only receives meta), so we
        // use a JS snippet that counts words in the editor DOM at render time.
        // This demonstrates the html slot injection pattern.
        let _ = meta;
        vec![SlotOutput {
            slot: "status-bar".to_string(),
            html: r#"<span id="wrazz-word-count" data-wrazz-live="word-count">— words</span>"#
                .to_string(),
        }]
    }
}

export!(WordCount);
