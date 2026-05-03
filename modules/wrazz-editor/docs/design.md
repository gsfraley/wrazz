# wrazz-editor — Design Document

`wrazz-editor` is a standalone React component that provides source-mode Markdown
editing with a paper-feel aesthetic. It is published as an npm package and consumed
by `wrazz-frontend`. All interactive Markdown handling lives here; the host app
only sees `value` / `onChange`.

---

## Goals

- **Source-mode only.** Markdown syntax is always visible as written. No hidden
  characters, no WYSIWYG toggling.
- **Paper feel.** Serif font, warm palette, generous leading. Writing, not coding.
- **Plugin-driven.** Every Markdown construct is handled by a plugin. The core
  editor is syntax-agnostic; it delegates rendering and interaction to plugins.
- **Independently publishable.** No dependency on `wrazz-frontend` or any
  server-side concern.

---

## Architecture

### The contenteditable model

The editor is a single `contenteditable` div (`.we-editor`). On every keystroke:

1. `saveCaretPos` records the caret as `{ line, col }` — line is the index of the
   line div, col is the character offset within editable content on that line
   (non-editable spans are excluded from the count).
2. `extractText` reconstructs the raw Markdown string from the DOM.
3. `valueToHtml` re-renders the full DOM from the Markdown string.
4. `restoreCaretPos` places the caret back at the saved position.

This render-on-every-keystroke approach keeps the DOM and the Markdown value in
perfect sync without a virtual cursor layer.

### Line structure

Each line of the document is a `<div class="we-line">` child of `.we-editor`.
Plugins may add modifier classes to the line div (e.g. `we-h1`, `we-h2`, `we-h3`)
and may render non-editable mark elements inside it.

### Non-editable marks

Some plugins render visual "mark" elements that are not part of the editable
text flow — for example, the `#` gutter marks for headings. These are rendered
as `<span contenteditable="false">` and excluded from `saveCaretPos` /
`restoreCaretPos` character counts. From the editor's perspective col 0 always
means the start of actual content, regardless of any non-editable prefix.

---

## Plugin System

### `ContentPlugin`

`ContentPlugin` is the interface for all inline and line-level Markdown constructs.
It covers anything that works within the single-contenteditable text flow: bold,
italic, links, headings, blockquotes, inline code.

```typescript
type Detection =
  | { kind: "inline";      pattern: RegExp }
  | { kind: "line-prefix"; pattern: RegExp }

interface ContentPlugin {
  name: string;
  detection: Detection;

  // Render a match to an HTML string for insertion into the line pipeline.
  // For line-prefix plugins, called once with the full line.
  // For inline plugins, called for each non-overlapping match within a line.
  render(match: RegExpMatchArray): string;

  // Reconstruct Markdown from a rendered DOM element.
  // Required when render() hides or transforms source characters.
  extract?(el: Element): string;

  // CSS class placed on the plugin's outermost rendered element.
  // Used by extractLineText to identify which plugin owns an element.
  spanClass?: string;

  // ── Focus-capture (optional) ──────────────────────────────────────────────

  // Describes when the editor should activate this plugin (give it the
  // keyboard focus slot).
  activation?: ActivationStrategy;

  // Called when the editor grants this plugin the activation slot.
  // context.setOverlayContent() may be called to mount a floating React node.
  // context.deactivate() releases the slot when done.
  onActivate?(context: PluginContext): void;

  // Called on every keydown while this plugin holds the slot.
  // Return true to consume the event (preventDefault + stopPropagation).
  onKeyDown?(e: KeyboardEvent, context: PluginContext): boolean;

  // Called when the plugin's activation slot is revoked (e.g. cursor moved away).
  onDeactivate?(context: PluginContext): void;
}
```

### `ActivationStrategy`

Describes the conditions under which the editor should call `onActivate`.

```typescript
type ActivationStrategy =
  // Activate when the cursor is at the content-start boundary of a
  // line-prefix plugin's line (col === 0 + the line matches the plugin).
  // Also activates on click on a non-editable mark span owned by this plugin.
  | { kind: "line-mark" }

  // Activate when the cursor is anywhere inside the plugin's rendered span.
  | { kind: "cursor-inside" }
```

### `PluginContext`

The handle given to a plugin when it is activated. The editor passes this; the
plugin uses it to mutate state and release control. Plugins must not hold
references to each other — all cross-cutting concerns go through `PluginContext`.

```typescript
interface PluginContext {
  // Current document value (raw Markdown).
  value: string;

  // Replace the document value. Triggers re-render.
  setValue(newValue: string): void;

  // Current caret position (content-relative).
  getCursor(): CaretPos;

  // Move the caret. Called after setValue if the cursor position changes.
  setCursor(pos: CaretPos): void;

  // Mount a React node as a floating overlay inside .we-wrap.
  // Pass null to unmount. The overlay is unmounted automatically on deactivate.
  setOverlayContent(node: ReactNode | null): void;

  // Release the activation slot. The editor refocuses the contenteditable.
  deactivate(): void;

  // The DOM element that triggered activation (the mark span or plugin span).
  anchorEl: HTMLElement;
}
```

### Activation slot

The editor holds at most one active plugin at a time. There is no priority queue
or competition — the editor activates the first plugin whose activation condition
is met, and no other plugin can take the slot until `context.deactivate()` is
called or the editor forcibly revokes it (e.g. cursor moves to an unrelated line).

While a plugin holds the slot:
- All `keydown` events on the contenteditable are routed to `plugin.onKeyDown`
  first. If it returns `true`, `preventDefault()` is called and the editor's
  own keydown logic is skipped.
- The overlay content (if any) is rendered inside `.we-wrap`.

### `EmbedPlugin` (planned)

`EmbedPlugin` handles constructs that *replace* a document region with a foreign
component: fenced code blocks, Mermaid diagrams, math. Unlike `ContentPlugin`,
`EmbedPlugin.render` returns a `ReactNode`, not an HTML string, and the region is
removed from the contenteditable flow entirely. Not yet implemented.

---

## Rendering Pipeline

### `renderInlineHtml(text)`

Scans `text` left-to-right with sticky regexes, applying the first matching
inline `ContentPlugin` at each position. Unmatched characters are HTML-escaped.
Bold must appear before italic in the plugin list so `**` is tried before `*`.

### `renderLineHtml(line)`

1. Tests each line-prefix plugin's pattern against the line start.
2. If matched: calls the plugin's `render`, which returns the full line HTML
   (typically a div with modifier classes and a non-editable mark span).
3. If no line-prefix matches: calls `renderInlineHtml` on the full line and
   wraps it in `<div class="we-line">`.

### `valueToHtml(value)`

Splits on `\n`, maps each line through `renderLineHtml`, joins. Called on every
input event and on external value changes.

---

## Text Extraction

### `extractLineText(lineEl)`

Reconstructs raw Markdown for one line by walking the line div's DOM:

- **Text nodes**: appended directly.
- **Non-editable mark spans** (`data-heading-depth`): reconstructed from the
  attribute, not the display text (e.g. `data-heading-depth="4"` → `"#### "`).
- **Plugin spans** (matched by `spanClass`): delegated to `plugin.extract(el)`.
- **All other elements** (strong, em, we-mark): recursed into, text appended.

### `extractText(root)`

Maps `extractLineText` over each line div child of the editor root, joins with
`\n`.

---

## Caret Tracking

`saveCaretPos` and `restoreCaretPos` work in terms of `{ line: number, col: number }`:

- `line` — index of the line div among the editor root's children.
- `col` — character offset within the **editable** text of that line.
  Non-editable spans (`contenteditable="false"`) are excluded from the count.

This means col 0 always means "start of content" on a heading line, not "before
the `#` mark". Plugins that render non-editable prefixes do not need to adjust
col values.

---

## Implemented Plugins

### Bold (`**text**`)

- Detection: inline, `/\*\*[^*\n]+\*\*/`
- Renders `<strong>` with visible `**` marks in `.we-mark` spans.
- No focus capture.

### Italic (`*text*`)

- Detection: inline, `/\*[^*\n]+\*/`
- Renders `<em>` with visible `*` marks in `.we-mark` spans.
- No focus capture.

### Heading (`# ` through `######`)

- Detection: line-prefix, `/^(#{1,6}) /`
- Renders the line as a `we-h1/2/3` flex div with a `contenteditable="false"`
  mark span in the left gutter. Levels 1–3 show the literal marks (`# `, `## `,
  `### `). Levels 4–6 show a compact `N#` label but store depth in
  `data-heading-depth` for correct extraction.
- Activation: `line-mark` — activates when cursor is at col 0 of the content,
  or on click on the mark span.
- `onKeyDown`:
  - `#` — increments heading depth (max 6).
  - `Backspace` / `Delete` — decrements depth; at depth 0 converts to plain text.
  - Arrow keys — navigates out: Left → end of previous line, Right → col 0 of
    content, Up/Down → same-col position on adjacent line.
  - Any printable character — exits the mark, prepends the character at col 0,
    places cursor after it.
- No overlay (mark is always visible; no floating panel needed).

---

## Planned Plugins

| Plugin | Detection | Activation |
|---|---|---|
| Link (`[text](url)`) | inline | cursor-inside → edit overlay |
| Inline code (`` `code` ``) | inline | none |
| Strikethrough (`~~text~~`) | inline | none |
| Blockquote (`> `) | line-prefix | line-mark |
| Code block (` ``` `) | EmbedPlugin | — |
| Mermaid diagram | EmbedPlugin | — |

---

## CSS Custom Properties

Defined in `WrazzEditor.css`; override in the host app to theme.

| Property | Default | Use |
|---|---|---|
| `--we-ink` | `#1a1a18` | Primary text |
| `--we-ink-muted` | `#7a7a6e` | Placeholder, secondary |
| `--we-mark` | `#c0b090` | Inline punctuation marks |
| `--we-mark-head` | `#d4c8a8` | Heading gutter marks |
| `--we-h1-size` | `1.65em` | H1 font size |
| `--we-h2-size` | `1.35em` | H2 font size |
| `--we-h3-size` | `1.12em` | H3 font size |
| `--we-margin` | `3.5rem` | Left margin; heading marks hang here |
