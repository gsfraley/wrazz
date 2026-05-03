import { useRef, useLayoutEffect, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import "./WrazzEditor.css";
import { valueToHtml, extractText } from "./renderer";
import { saveCaretPos, restoreCaretPos } from "./caret";
import { PLUGINS, LINE_PREFIX_PLUGINS } from "./plugins/index";
import type { ContentPlugin, PluginContext, CaretPos } from "./plugins/index";

export interface WrazzEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

// ── Activation helpers ─────────────────────────────────────────

function pluginForLine(lineEl: Element): ContentPlugin | null {
  const name = (lineEl as HTMLElement).dataset?.wePlugin;
  if (!name) return null;
  return LINE_PREFIX_PLUGINS.find((p) => p.name === name) ?? null;
}

function activatablePluginForElement(el: HTMLElement): ContentPlugin | null {
  const pluginEl = el.closest("[data-we-plugin]") as HTMLElement | null;
  if (!pluginEl) return null;
  const name = pluginEl.dataset.wePlugin;
  return PLUGINS.find((p) => p.name === name && p.interaction.activation) ?? null;
}

// ── Copy helper ────────────────────────────────────────────────

// Count editable characters in a cloned DOM fragment (skip contenteditable=false).
function countEditableChars(frag: DocumentFragment | Element): number {
  let n = 0;
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      n += (node.textContent ?? "").length;
      return;
    }
    if ((node as Element).getAttribute?.("contenteditable") === "false") return;
    for (const child of node.childNodes) walk(child);
  };
  walk(frag);
  return n;
}

// ── Component ──────────────────────────────────────────────────

export function WrazzEditor({
  value,
  onChange,
  placeholder,
  className,
}: WrazzEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const renderedValue = useRef<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Activation slot: at most one plugin active at a time
  const activePluginRef = useRef<ContentPlugin | null>(null);
  const activeContextRef = useRef<PluginContext | null>(null);
  const [overlayContent, setOverlayContentState] = useState<ReactNode>(null);

  // Cursor move requested by plugin via setCursor(); applied by useLayoutEffect
  // (when setValue was also called) or synchronously by deactivate() (when not).
  const pendingCursor = useRef<CaretPos | null>(null);

  // ── Sync external value → DOM ───────────────────────────────

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el || value === renderedValue.current) return;
    el.innerHTML = valueToHtml(value);
    renderedValue.current = value;
    if (pendingCursor.current) {
      restoreCaretPos(el, pendingCursor.current);
      pendingCursor.current = null;
    }
  }, [value]);

  // ── Plugin activation ────────────────────────────────────────

  const deactivate = useCallback(() => {
    const ctx = activeContextRef.current;
    const plugin = activePluginRef.current;
    if (plugin?.onDeactivate && ctx) plugin.onDeactivate(ctx);
    activePluginRef.current = null;
    activeContextRef.current = null;
    setOverlayContentState(null);

    // Apply cursor immediately only if no re-render is in flight.
    // setValue() sets renderedValue to null; in that case useLayoutEffect
    // will apply the cursor once the new DOM is ready.
    const el = editorRef.current;
    if (el && pendingCursor.current && renderedValue.current === valueRef.current) {
      restoreCaretPos(el, pendingCursor.current);
      pendingCursor.current = null;
    }
  }, []);

  const activatePlugin = useCallback(
    (plugin: ContentPlugin, anchorEl: HTMLElement) => {
      if (activePluginRef.current === plugin) return;
      if (activePluginRef.current) deactivate();

      const ctx: PluginContext = {
        get value() {
          return valueRef.current;
        },
        setValue(newVal: string) {
          renderedValue.current = null; // signal that a DOM re-render is pending
          onChange(newVal);
        },
        getCursor() {
          return editorRef.current
            ? saveCaretPos(editorRef.current)
            : { line: 0, col: 0 };
        },
        setCursor(pos: CaretPos) {
          pendingCursor.current = pos;
        },
        setOverlayContent(node: ReactNode | null) {
          setOverlayContentState(node);
        },
        deactivate,
        anchorEl,
      };

      activePluginRef.current = plugin;
      activeContextRef.current = ctx;
      if (plugin.onActivate) plugin.onActivate(ctx);
    },
    [deactivate, onChange]
  );

  // ── selectionchange — line-mark activation ──────────────────
  //
  // No suppression on nav keys: the col=0 check is the gate. Activation is
  // idempotent (activatePlugin returns early if the plugin is already active),
  // so rapid navigation through headings is safe.

  useEffect(() => {
    const handler = () => {
      const el = editorRef.current;
      if (!el) return;
      const pos = saveCaretPos(el);

      if (pos.col !== 0) {
        if (activePluginRef.current?.interaction.activation === "line-mark")
          deactivate();
        return;
      }

      const lineEl = el.children[pos.line] as HTMLElement | undefined;
      if (!lineEl) return;

      const plugin = pluginForLine(lineEl);
      if (plugin?.interaction.activation === "line-mark") {
        activatePlugin(plugin, lineEl);
      } else if (activePluginRef.current?.interaction.activation === "line-mark") {
        deactivate();
      }
    };

    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [activatePlugin, deactivate]);

  // ── Input handler ───────────────────────────────────────────

  const handleInput = () => {
    if (isComposing.current) return;
    const el = editorRef.current;
    if (!el) return;

    const caret = saveCaretPos(el);
    const rawLines = extractText(el).split("\n");

    // Give each plugin a chance to transform lines before re-rendering.
    const lines = rawLines.map((line, idx) => {
      const isCaretLine = idx === caret.line;
      for (const plugin of PLUGINS) {
        const result = plugin.transformLine?.(line, isCaretLine, caret.col);
        if (result) {
          if (isCaretLine) caret.col = Math.max(0, caret.col + result.colDelta);
          return result.line;
        }
      }
      return line;
    });

    const text = lines.join("\n");
    el.innerHTML = valueToHtml(text);
    renderedValue.current = text;

    restoreCaretPos(el, caret);
    onChange(text);
  };

  // ── Keyboard handler (keydown + keyup) ──────────────────────

  const handleKeyboardEvent = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const plugin = activePluginRef.current;
    const ctx = activeContextRef.current;
    if (plugin?.onKeyboardEvent && ctx) {
      const consumed = plugin.onKeyboardEvent(e.nativeEvent, ctx);
      if (consumed) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  // ── MouseDown on non-editable marks ─────────────────────────

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.getAttribute("contenteditable") !== "false") return;
    const plugin = activatablePluginForElement(target);
    if (!plugin || plugin.interaction.activation !== "line-mark") return;

    e.preventDefault();
    const lineEl = target.closest(".we-line") as HTMLElement | null;
    if (!lineEl) return;

    const el = editorRef.current;
    if (!el) return;

    const lineIdx = Array.prototype.indexOf.call(el.children, lineEl);
    el.focus();
    restoreCaretPos(el, { line: lineIdx, col: 0 });
    activatePlugin(plugin, lineEl);
  };

  // ── Copy — include heading marks in copied text ─────────────
  //
  // contenteditable="false" spans are excluded from the browser's default
  // copy text, so heading marks are lost. We intercept and provide the
  // markdown source for the covered lines instead.

  const handleCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    const el = editorRef.current;
    if (!el) return;
    const lineCount = el.children.length;
    if (lineCount === 0) return;

    // Find the line div index for a selection endpoint.
    // When container === el (e.g. Ctrl+A), the offset is a child index; clamp
    // to valid range. If the walk escapes above el (shouldn't happen), fall back.
    const lineIdxOf = (node: Node, fallback: number): number => {
      if (node === el) {
        return Math.max(0, Math.min(fallback, lineCount - 1));
      }
      let n: Node | null = node;
      while (n && n.parentNode !== el) n = n.parentNode;
      if (!n) return Math.max(0, Math.min(fallback, lineCount - 1));
      const idx = Array.prototype.indexOf.call(el.children, n);
      return idx >= 0 ? idx : Math.max(0, Math.min(fallback, lineCount - 1));
    };

    const startIdx = lineIdxOf(range.startContainer, 0);
    const endIdx = lineIdxOf(range.endContainer, lineCount - 1);

    // Count content-relative editable chars from start of lineEl to a DOM point.
    // Returns Infinity when the range can't be constructed (treat as end-of-line).
    const colAt = (lineEl: HTMLElement, container: Node, offset: number): number => {
      try {
        const m = document.createRange();
        m.setStart(lineEl, 0);
        m.setEnd(container, offset);
        return countEditableChars(m.cloneContents());
      } catch {
        return Infinity;
      }
    };

    const startCol = colAt(
      el.children[startIdx] as HTMLElement,
      range.startContainer,
      range.startOffset
    );
    const endCol = colAt(
      el.children[endIdx] as HTMLElement,
      range.endContainer,
      range.endOffset
    );

    const srcLines = valueRef.current.split("\n");
    const pfxLen = (i: number) => {
      const m = (srcLines[i] ?? "").match(/^(#{1,6}) /);
      return m ? m[0].length : 0;
    };

    const parts: string[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const line = srcLines[i] ?? "";
      const pfx = pfxLen(i);
      // Include the heading prefix when the selection reaches col 0 of content.
      const from = i === startIdx
        ? (startCol === 0 ? 0 : Math.min(pfx + startCol, line.length))
        : 0;
      // Math.min handles Infinity (container === el fallthrough → full line).
      const to = i === endIdx
        ? Math.min(pfx + endCol, line.length)
        : line.length;
      parts.push(line.slice(from, to));
    }

    e.preventDefault();
    e.clipboardData.setData("text/plain", parts.join("\n"));
  };

  // ── Blur ────────────────────────────────────────────────────

  const handleBlur = () => {
    if (activePluginRef.current) deactivate();
  };

  // ── Paste: strip to plain text ──────────────────────────────

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className={`we-wrap${className ? ` ${className}` : ""}`}>
      <div
        ref={editorRef}
        className="we-editor"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyboardEvent}
        onKeyUp={handleKeyboardEvent}
        onMouseDown={handleMouseDown}
        onCopy={handleCopy}
        onBlur={handleBlur}
        onPaste={handlePaste}
        onCompositionStart={() => {
          isComposing.current = true;
        }}
        onCompositionEnd={() => {
          isComposing.current = false;
          handleInput();
        }}
      />
      {overlayContent}
    </div>
  );
}
