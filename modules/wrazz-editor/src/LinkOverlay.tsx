import { useEffect, useRef, useState } from "react";

// ── Link source parser ─────────────────────────────────────────

interface ParsedLink {
  text: string;
  url: string;
  complete: boolean;
}

function parseLink(src: string): ParsedLink {
  const m = src.match(/^\[([^\]\n]*)\](?:\(([^)\n]*)\))?$/);
  if (!m) return { text: "", url: "", complete: false };
  return {
    text: m[1] ?? "",
    url: m[2] ?? "",
    complete: m[2] !== undefined && src.endsWith(")"),
  };
}

// ── Component ──────────────────────────────────────────────────

export interface LinkOverlayProps {
  /**
   * Current markdown source for the link, e.g.
   * - "[" or "[hello](https://ex" — in-progress (display only)
   * - "[hello](https://ex.com)" — complete link being edited (input mode)
   */
  source: string;
  /** Viewport-relative rect of the link/progress span — anchor below this. */
  anchorRect: DOMRect;
  /** .we-wrap element — for local coordinate conversion. */
  wrapEl: HTMLElement;
  /** True when the overlay is editing a complete existing link (shows input). */
  isEditing: boolean;
  /** Called with the new markdown when the user commits an edit. */
  onChange: (markdown: string) => void;
  /** Called to close without changes. */
  onDismiss: () => void;
}

export function LinkOverlay({
  source,
  anchorRect,
  wrapEl,
  isEditing,
  onChange,
  onDismiss,
}: LinkOverlayProps) {
  const [editSrc, setEditSrc] = useState(source);
  const inputRef = useRef<HTMLInputElement>(null);

  // When switching into edit mode, focus and place cursor at end.
  useEffect(() => {
    if (!isEditing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [isEditing]);

  // Keep editSrc in sync if source changes while editing (e.g. arrow key moves
  // away and back into a different link).
  useEffect(() => {
    setEditSrc(source);
  }, [source]);

  const parsed = parseLink(isEditing ? editSrc : source);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (editSrc.trim()) onChange(editSrc);
      else onDismiss();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEditSrc(val);
    // Auto-commit the moment the pattern closes: [text](url)
    if (/^\[[^\]\n]+\]\([^)\n]+\)$/.test(val)) {
      onChange(val);
    }
  };

  // Position just below the anchor, in .we-wrap-local coordinates.
  const wrapRect = wrapEl.getBoundingClientRect();
  const top = anchorRect.bottom - wrapRect.top + 6;
  const left = Math.max(8, anchorRect.left - wrapRect.left);

  return (
    <div className="we-link-overlay" style={{ top, left }}>
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
        <div className="we-link-overlay-source">{source}</div>
      )}

      {(parsed.text || parsed.url) && (
        <div className="we-link-overlay-preview">
          <span className="we-link-overlay-label">→</span>
          {parsed.text && (
            <span className="we-link-preview-text">{parsed.text}</span>
          )}
          {parsed.url && (
            <span className="we-link-overlay-url">{parsed.url}</span>
          )}
        </div>
      )}
    </div>
  );
}
