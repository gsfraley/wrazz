import { useEffect, useRef, useState } from "react";

// ── Styled source display ──────────────────────────────────────
// Renders [text](url) with the same per-part coloring as the inline editor.
// Mirrors the logic in renderProgressLink() so partial states work correctly.

function StyledSource({ src }: { src: string }) {
  const m = src.match(/^\[([^\]]*)\]?(?:\(([^)]*)?)?$/);
  if (!m) return <span className="we-link-overlay-raw">{src}</span>;

  const text = m[1] ?? "";
  const hasCloseBracket = src.includes("]");
  const hasOpenParen = src.includes("](");
  const urlPart = hasOpenParen ? (m[2] ?? "") : null;
  const hasCloseParen = src.endsWith(")");

  return (
    <>
      <span className="we-mark">[</span>
      {text && <span className="we-link-text">{text}</span>}
      {hasCloseBracket && !hasOpenParen && <span className="we-mark">]</span>}
      {hasOpenParen && <span className="we-mark">](</span>}
      {urlPart !== null && (
        <span className="we-link-url-progress">{urlPart}</span>
      )}
      {hasCloseParen && <span className="we-mark">)</span>}
    </>
  );
}

// ── Component ──────────────────────────────────────────────────

export interface LinkOverlayProps {
  source: string;
  /** Viewport-relative rect of the link/progress span — tooltip anchors above. */
  anchorRect: DOMRect;
  /** .we-wrap element — for local coordinate conversion. */
  wrapEl: HTMLElement;
  /** True when editing a complete existing link (shows input). */
  isEditing: boolean;
  onChange: (markdown: string) => void;
  onDismiss: () => void;
  /** Called with -1 (up) or +1 (down) when arrow keys are pressed in the overlay. */
  onNavigate: (direction: -1 | 1) => void;
}

export function LinkOverlay({
  source,
  anchorRect,
  wrapEl,
  isEditing,
  onChange,
  onDismiss,
  onNavigate,
}: LinkOverlayProps) {
  const [editSrc, setEditSrc] = useState(source);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [isEditing]);

  useEffect(() => {
    setEditSrc(source);
  }, [source]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (editSrc.trim()) onChange(editSrc);
      else onDismiss();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onNavigate(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onNavigate(1);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEditSrc(val);
    if (/^\[[^\]\n]+\]\([^)\n]+\)$/.test(val)) {
      onChange(val);
    }
  };

  // Position ABOVE the anchor.
  // `top + translateY(-100%)` places the tooltip's bottom 6px above anchor.top.
  const wrapRect = wrapEl.getBoundingClientRect();
  const top = anchorRect.top - wrapRect.top - 6;
  const left = Math.max(8, anchorRect.left - wrapRect.left);

  return (
    <div
      className="we-link-overlay"
      style={{ top, left, transform: "translateY(-100%)" }}
      // Always prevent default on mousedown so the editor's selection never
      // changes before focus transfers. We then manually focus the input so
      // it still receives keyboard input. Without this, selectionchange fires
      // while activeElement is still the editor, detectOverlay() finds no link
      // under the (now-moved) selection, and the overlay self-dismisses.
      onMouseDown={(e) => {
        e.preventDefault();
        if (isEditing) inputRef.current?.focus();
      }}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="we-link-overlay-input"
          value={editSrc}
          placeholder="[link text](https://…)"
          spellCheck={false}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div className="we-link-overlay-source">
          <StyledSource src={source} />
        </div>
      )}
    </div>
  );
}
