import type { ReactNode } from "react";

// ── Caret position ─────────────────────────────────────────────

export interface CaretPos {
  line: number;
  col: number; // content-relative; excludes contenteditable="false" spans
}

// ── Interaction ────────────────────────────────────────────────
//
// Two base kinds: inline (matched per-position within a line) and
// line-prefix (matched against the start of the whole line).
// Each may carry an optional activation kind that is scoped to its base:
//   inline      → activation?: "cursor-inside"
//   line-prefix → activation?: "line-mark"

export type Interaction =
  | { kind: "inline";      pattern: RegExp; activation?: "cursor-inside" }
  | { kind: "line-prefix"; pattern: RegExp; activation?: "line-mark" };

// ── Plugin context ─────────────────────────────────────────────

export interface PluginContext {
  value: string;
  setValue(newValue: string): void;
  getCursor(): CaretPos;
  setCursor(pos: CaretPos): void;
  setOverlayContent(node: ReactNode | null): void;
  deactivate(): void;
  anchorEl: HTMLElement;
}

// ── Plugin interface ───────────────────────────────────────────

export interface ContentPlugin {
  name: string;
  interaction: Interaction;

  // For line-prefix plugins the renderer passes the already-inlined content
  // as the second argument so plugins don't need to import renderInlineHtml.
  render(match: RegExpMatchArray, content?: string): string;

  // Reconstruct source Markdown from a rendered element.
  // Only needed when render() hides or transforms source characters.
  extract?(el: Element): string;

  // Called for each document line during handleInput, before re-rendering.
  // Return { line, colDelta } to replace the line text (e.g. auto-completing a
  // heading marker). colDelta is added to the caret col when this is the caret
  // line. Return null to leave the line unchanged.
  transformLine?(
    line: string,
    isCaretLine: boolean,
    caretCol: number
  ): { line: string; colDelta: number } | null;

  onActivate?(context: PluginContext): void;

  // Receives both keydown and keyup events while this plugin holds the slot.
  // Return true to consume the event (preventDefault + stopPropagation).
  onKeyboardEvent?(e: KeyboardEvent, context: PluginContext): boolean;

  onDeactivate?(context: PluginContext): void;
}
