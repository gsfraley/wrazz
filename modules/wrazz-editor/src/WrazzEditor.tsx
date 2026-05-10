import { useRef, useLayoutEffect, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import "./WrazzEditor.css";
import { valueToHtml, extractText } from "./renderer";
import { saveCaretPos, restoreCaretPos } from "./caret";
import { PLUGINS, LINE_PREFIX_PLUGINS } from "./plugins/index";
import type { ContentPlugin, PluginContext, CaretPos } from "./plugins/index";
import { buildCopyText } from "./copy";

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
    const el = editorRef.current;
    if (!el) return;
    const text = buildCopyText(el, valueRef.current);
    if (text === null) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
  };

  // ── Blur ────────────────────────────────────────────────────

  const handleBlur = () => {
    if (activePluginRef.current) deactivate();
  };

  // ── Paste: strip to plain text ──────────────────────────────

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    handleInput();
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
