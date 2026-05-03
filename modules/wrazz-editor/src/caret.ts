import type { CaretPos } from "./plugins/index";

export function saveCaretPos(root: HTMLElement): CaretPos {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { line: 0, col: 0 };

  const range = sel.getRangeAt(0);

  // Find the top-level line div.
  let node: Node | null = range.startContainer;
  while (node && node.parentNode !== root) node = node.parentNode;
  const lineIdx = node
    ? Array.prototype.indexOf.call(root.children, node)
    : -1;
  if (lineIdx < 0) return { line: 0, col: 0 };

  const lineEl = root.children[lineIdx] as HTMLElement;

  // Clone the range from line-start to caret into a fragment, then count
  // only editable text. cloneContents handles element-level caret positions
  // correctly without conflating child-index offsets with char offsets.
  const measure = document.createRange();
  measure.setStart(lineEl, 0);
  measure.setEnd(range.startContainer, range.startOffset);
  const frag = measure.cloneContents();

  let col = 0;
  const countEditable = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      col += (n.textContent ?? "").length;
      return;
    }
    if ((n as Element).getAttribute?.("contenteditable") === "false") return;
    for (const child of n.childNodes) countEditable(child);
  };
  countEditable(frag);

  return { line: lineIdx, col };
}

export function restoreCaretPos(root: HTMLElement, pos: CaretPos): void {
  const sel = window.getSelection();
  if (!sel) return;

  const lineEl = root.children[pos.line] as HTMLElement | undefined;
  if (!lineEl) return;

  let remaining = pos.col;
  let target: Text | null = null;
  let targetOff = 0;

  // Walk text nodes that are NOT inside a contenteditable="false" subtree.
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      let p: Node | null = n.parentNode;
      while (p && p !== lineEl) {
        if ((p as Element).getAttribute?.("contenteditable") === "false")
          return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

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
