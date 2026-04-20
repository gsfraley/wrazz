import { useEffect, useRef, useState } from "react";

// ── Link source parser ─────────────────────────────────────────

interface ParsedLink {
  text: string;
  url: string;
}

function parseLink(src: string): ParsedLink {
  const m = src.match(/^\[([^\]\n]*)\](?:\(([^)\n]*)\))?$/);
  return { text: m?.[1] ?? "", url: m?.[2] ?? "" };
}

// ── Styled source display ──────────────────────────────────────
// Renders [text](url) with the same per-part coloring as the inline editor.

function StyledSource({ src }: { src: string }) {
  const m = src.match(/^(\[)([^\]]*?)(\](?:\()?)([^)]*)(\)?)?$/);
  if (!m) return <span className="we-link-overlay-raw">{src}</span>;

  const [, open, text, mid, url, close] = m;
  return (
    <>
      {open && <span className="we-mark">{open}</span>}
      {text && <span className="we-link-text">{text}</span>}
      {mid && <span className="we-mark">{mid}</span>}
      {url && <span className="we-link-url-progress">{url}</span>}
      {close && <span className="we-mark">{close}</span>}
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

  const { text: parsedText, url: parsedUrl } = parseLink(
    isEditing ? editSrc : source
  );

  return (
    <div
      className="we-link-overlay"
      style={{ top, left, transform: "translateY(-100%)" }}
      // Prevent mousedown from moving the editor's selection before focus
      // transfers to the input. Without this the selectionchange fires while
      // activeElement is still the editor, detectOverlay() runs, and closes
      // the overlay before the click completes.
      onMouseDown={(e) => {
        if (e.target !== inputRef.current) e.preventDefault();
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

      {/* Dim hint showing the rendered link text + URL when we have enough. */}
      {(parsedText || parsedUrl) && (
        <div className="we-link-overlay-hint">
          {parsedText && <span className="we-link-text">{parsedText}</span>}
          {parsedUrl && (
            <span className="we-link-overlay-url"> {parsedUrl}</span>
          )}
        </div>
      )}
    </div>
  );
}
