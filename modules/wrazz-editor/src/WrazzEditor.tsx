import { useRef, useLayoutEffect, useEffect, useState } from "react";
import "./WrazzEditor.css";
import { valueToHtml, extractLineText } from "./modifiers";
import { LinkOverlay } from "./LinkOverlay";

export interface WrazzEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

// ── Caret utilities ────────────────────────────────────────────

interface CaretPos {
  line: number;
  col: number; // textContent offset within the line div
}

function saveCaretPos(root: HTMLElement): CaretPos {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { line: 0, col: 0 };

  const range = sel.getRangeAt(0);

  // Walk up to find the top-level line div.
  let node: Node | null = range.startContainer;
  while (node && node.parentNode !== root) node = node.parentNode;

  const lineIdx = node
    ? Array.prototype.indexOf.call(root.children, node)
    : -1;
  if (lineIdx < 0) return { line: 0, col: 0 };

  // Measure character offset from the start of the line div.
  const measure = document.createRange();
  measure.setStart(node!, 0);
  measure.setEnd(range.startContainer, range.startOffset);
  return { line: lineIdx, col: measure.toString().length };
}

function restoreCaretPos(root: HTMLElement, pos: CaretPos): void {
  const sel = window.getSelection();
  if (!sel) return;

  const lineEl = root.children[pos.line] as HTMLElement | undefined;
  if (!lineEl) return;

  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  let remaining = pos.col;
  let target: Text | null = null;
  let targetOff = 0;

  let tn = walker.nextNode() as Text | null;
  while (tn) {
    if (remaining <= tn.length) {
      target = tn;
      targetOff = remaining;
      break;
    }
    remaining -= tn.length;
    tn = walker.nextNode() as Text | null;
  }

  try {
    const r = document.createRange();
    if (target) {
      r.setStart(target, targetOff);
    } else {
      r.selectNodeContents(lineEl);
      r.collapse(false);
    }
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch (_) {
    /* stale position — ignore */
  }
}

// ── Text extraction ────────────────────────────────────────────

function extractText(root: HTMLElement): string {
  const lines: string[] = [];
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      lines.push(child.textContent ?? "");
    } else if ((child as Element).tagName === "DIV") {
      lines.push(extractLineText(child as Element));
    }
  }
  return lines.join("\n");
}

// ── Overlay state ──────────────────────────────────────────────

interface OverlayState {
  /** "progress" = in-progress link being typed (display-only overlay).
   *  "edit"     = cursor is inside a complete rendered link (input overlay). */
  kind: "progress" | "edit";
  source: string;
  rect: DOMRect;
  /** For edit mode: info needed to splice the updated markdown back in. */
  editInfo?: { line: number; oldSrc: string };
}

// ── Component ──────────────────────────────────────────────────

export function WrazzEditor({
  value,
  onChange,
  placeholder,
  className,
}: WrazzEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const renderedValue = useRef<string | null>(null);

  const [overlay, setOverlay] = useState<OverlayState | null>(null);

  // ── Detect overlay state after each DOM update ──────────────

  function detectOverlay() {
    const el = editorRef.current;
    if (!el) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setOverlay(null);
      return;
    }

    const anchor = sel.anchorNode;
    const parent =
      anchor?.nodeType === Node.TEXT_NODE
        ? anchor.parentElement
        : (anchor as Element | null);

    // Cursor inside a link-in-progress span?
    const progressEl = parent?.closest(".we-link-progress") as HTMLElement | null;
    if (progressEl && progressEl.closest(".we-editor") === el) {
      setOverlay({
        kind: "progress",
        source: progressEl.textContent ?? "",
        rect: progressEl.getBoundingClientRect(),
      });
      return;
    }

    // Cursor inside a rendered (complete) link span?
    const linkEl = parent?.closest(".we-link") as HTMLElement | null;
    if (linkEl && linkEl.closest(".we-editor") === el) {
      const href = linkEl.getAttribute("data-href") ?? "";
      const text = linkEl.querySelector(".we-link-text")?.textContent ?? "";
      const lineEl = linkEl.closest(".we-line") as HTMLElement | null;
      const lineIdx = lineEl
        ? Array.prototype.indexOf.call(el.children, lineEl)
        : -1;

      setOverlay({
        kind: "edit",
        source: `[${text}](${href})`,
        rect: linkEl.getBoundingClientRect(),
        editInfo:
          lineIdx >= 0
            ? { line: lineIdx, oldSrc: `[${text}](${href})` }
            : undefined,
      });
      return;
    }

    setOverlay(null);
  }

  // ── Sync external value → DOM ───────────────────────────────

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el || value === renderedValue.current) return;
    el.innerHTML = valueToHtml(value);
    renderedValue.current = value;
    // Don't touch caret for external changes (file switch, etc.)
  }, [value]);

  // ── selectionchange: detect cursor moving into a link ───────

  useEffect(() => {
    const onSelectionChange = () => {
      const el = editorRef.current;
      if (!el || document.activeElement !== el) return;
      detectOverlay();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // ── Input handler ───────────────────────────────────────────

  const handleInput = () => {
    if (isComposing.current) return;
    const el = editorRef.current;
    if (!el) return;

    const caret = saveCaretPos(el);
    const text = extractText(el);

    el.innerHTML = valueToHtml(text, caret);
    renderedValue.current = text;

    restoreCaretPos(el, caret);
    detectOverlay();

    onChange(text);
  };

  // ── Paste: strip to plain text ──────────────────────────────

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    // onInput fires after execCommand
  };

  // ── Link overlay callbacks ──────────────────────────────────

  const handleLinkChange = (newMarkdown: string) => {
    if (!overlay?.editInfo) {
      setOverlay(null);
      return;
    }
    const { line, oldSrc } = overlay.editInfo;
    const lines = value.split("\n");
    const lineText = lines[line] ?? "";
    // Replace the old markdown with the new. Use indexOf so we handle
    // duplicate link text correctly (replaces first occurrence).
    const idx = lineText.indexOf(oldSrc);
    if (idx >= 0) {
      lines[line] =
        lineText.slice(0, idx) + newMarkdown + lineText.slice(idx + oldSrc.length);
    }
    onChange(lines.join("\n"));
    setOverlay(null);
    // Refocus the editor
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const handleOverlayDismiss = () => {
    setOverlay(null);
    editorRef.current?.focus();
  };

  // ── Render ──────────────────────────────────────────────────

  return (
    <div
      ref={wrapRef}
      className={`we-wrap${className ? ` ${className}` : ""}`}
      style={{ position: "relative" }}
    >
      <div
        ref={editorRef}
        className="we-editor"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={placeholder}
        onInput={handleInput}
        onPaste={handlePaste}
        onCompositionStart={() => {
          isComposing.current = true;
        }}
        onCompositionEnd={() => {
          isComposing.current = false;
          handleInput();
        }}
      />
      {overlay && wrapRef.current && (
        <LinkOverlay
          source={overlay.source}
          anchorRect={overlay.rect}
          wrapEl={wrapRef.current}
          isEditing={overlay.kind === "edit"}
          onChange={handleLinkChange}
          onDismiss={handleOverlayDismiss}
        />
      )}
    </div>
  );
}
