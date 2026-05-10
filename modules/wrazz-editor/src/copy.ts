// Count editable characters in a cloned DOM fragment, skipping contenteditable=false spans.
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

/**
 * Builds the plain-text markdown string to place on the clipboard for the
 * current selection inside `el`. Returns null when selection is collapsed.
 * `value` is the current markdown source string.
 */
export function buildCopyText(el: HTMLDivElement, value: string): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;

  const lineCount = el.children.length;
  if (lineCount === 0) return null;

  const lineIdxOf = (node: Node, fallback: number): number => {
    if (node === el) return Math.max(0, Math.min(fallback, lineCount - 1));
    let n: Node | null = node;
    while (n && n.parentNode !== el) n = n.parentNode;
    if (!n) return Math.max(0, Math.min(fallback, lineCount - 1));
    const idx = Array.prototype.indexOf.call(el.children, n);
    return idx >= 0 ? idx : Math.max(0, Math.min(fallback, lineCount - 1));
  };

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

  const startIdx = lineIdxOf(range.startContainer, 0);
  const endIdx = lineIdxOf(range.endContainer, lineCount - 1);
  const startCol = colAt(el.children[startIdx] as HTMLElement, range.startContainer, range.startOffset);
  const endCol = colAt(el.children[endIdx] as HTMLElement, range.endContainer, range.endOffset);

  const srcLines = value.split("\n");
  const pfxLen = (i: number) => {
    const m = (srcLines[i] ?? "").match(/^(#{1,6}) /);
    return m ? m[0].length : 0;
  };

  const parts: string[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const line = srcLines[i] ?? "";
    const pfx = pfxLen(i);
    const from = i === startIdx ? (startCol === 0 ? 0 : Math.min(pfx + startCol, line.length)) : 0;
    const to = i === endIdx ? Math.min(pfx + endCol, line.length) : line.length;
    parts.push(line.slice(from, to));
  }

  return parts.join("\n");
}
