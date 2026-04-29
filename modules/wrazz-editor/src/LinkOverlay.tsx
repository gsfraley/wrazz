import { useEffect, useRef, useState } from "react";

// ── Styled source display ──────────────────────────────────────
// Renders [text](url) with per-part code coloring.

function StyledSource({ src }: { src: string }) {
  const m = src.match(/^\[([^\]]*)\]?(?:\(([^)]*)\)?)?$/);
  if (!m) return <span>{src}</span>;

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
      {urlPart !== null && <span className="we-link-url-progress">{urlPart}</span>}
      {hasCloseParen && <span className="we-mark">)</span>}
    </>
  );
}

// ── Component ──────────────────────────────────────────────────

export interface LinkOverlayProps {
  source: string;
  anchorRect: DOMRect;
  wrapEl: HTMLElement;
  isEditing: boolean;
  onChange: (markdown: string) => void;
  onDismiss: () => void;
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
    setEditSrc(source);
  }, [source]);

  // Native mousedown listener on the input: preventDefault stops the browser
  // from moving focus away from the editor before we explicitly transfer it,
  // which would fire selectionchange and mistakenly dismiss the overlay.
  // We then call focus() ourselves so the input actually receives focus.
  useEffect(() => {
    if (!isEditing) return;
    const el = inputRef.current;
    if (!el) return;
    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
    el.addEventListener("mousedown", handleMouseDown);
    return () => el.removeEventListener("mousedown", handleMouseDown);
  }, [isEditing]);

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

  const wrapRect = wrapEl.getBoundingClientRect();
  const top = anchorRect.top - wrapRect.top - 6;
  const left = Math.max(8, anchorRect.left - wrapRect.left);

  return (
    <div
      className="we-link-overlay"
      style={{ top, left, transform: "translateY(-100%)" }}
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
