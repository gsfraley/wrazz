/**
 * Inline modifier system.
 *
 * A Modifier owns:
 *   - pattern        — regex matching a complete instance
 *   - render()       — HTML string for a complete match
 *   - extract()      — reconstruct markdown from the rendered DOM element
 *                      (required when render() hides source chars, e.g. links)
 *   - spanClass      — CSS class on the outermost wrapper span so the editor
 *                      can identify which modifier owns an element
 *
 * The rendering pipeline iterates MODIFIERS in order; first match wins.
 * Bold must precede italic so `**` beats `*`.
 *
 * Progress rendering (link-in-progress) is handled separately below so that
 * the core pipeline stays modifier-agnostic.
 */

// ── Utilities ──────────────────────────────────────────────────

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Modifier interface ─────────────────────────────────────────

export interface Modifier {
  name: string;
  pattern: RegExp;
  render: (match: RegExpMatchArray) => string;
  extract?: (el: Element) => string;
  spanClass?: string;
}

// ── Modifier definitions ───────────────────────────────────────

const bold: Modifier = {
  name: "bold",
  pattern: /\*\*[^*\n]+\*\*/,
  render(m) {
    return (
      `<strong><span class="we-mark">**</span>` +
      esc(m[0].slice(2, -2)) +
      `<span class="we-mark">**</span></strong>`
    );
  },
};

const italic: Modifier = {
  name: "italic",
  pattern: /\*[^*\n]+\*/,
  render(m) {
    return (
      `<em><span class="we-mark">*</span>` +
      esc(m[0].slice(1, -1)) +
      `<span class="we-mark">*</span></em>`
    );
  },
};

const link: Modifier = {
  name: "link",
  pattern: /\[([^\]\n]*)\]\(([^)\n]*)\)/,
  spanClass: "we-link",
  render(m) {
    return (
      `<span class="we-link" data-href="${esc(m[2])}">` +
      `<span class="we-link-text">${esc(m[1])}</span>` +
      `</span>`
    );
  },
  extract(el) {
    const text = el.querySelector(".we-link-text")?.textContent ?? "";
    const href = el.getAttribute("data-href") ?? "";
    return `[${text}](${href})`;
  },
};

/** Priority-ordered list of modifiers. */
export const MODIFIERS: Modifier[] = [bold, italic, link];

// ── Pre-compiled sticky patterns for the hot path ─────────────

const stickyPatterns = new Map<string, RegExp>(
  MODIFIERS.map((m) => [m.name, new RegExp(m.pattern.source, "y")])
);

// ── Core inline renderer ───────────────────────────────────────

export function renderInlineHtml(text: string): string {
  let result = "";
  let i = 0;

  while (i < text.length) {
    let matched = false;

    for (const mod of MODIFIERS) {
      const re = stickyPatterns.get(mod.name)!;
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) {
        result += mod.render(m);
        i += m[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      result += esc(text[i]);
      i++;
    }
  }

  return result;
}

// ── Link-in-progress detection ─────────────────────────────────

export interface ProgressLink {
  /** Index in the line string where the `[` starts. */
  start: number;
  /** Index just past the last character of the in-progress source. */
  end: number;
  /** The raw partial markdown, e.g. `[hello](https://ex`. */
  src: string;
}

/**
 * Returns the in-progress link span that contains `col` on this line,
 * or null if there is none.
 *
 * A "progress" link is an unclosed `[…](…` pattern — the `)` has not
 * yet been typed — that overlaps the cursor column.
 */
export function findProgressLink(
  lineText: string,
  col: number
): ProgressLink | null {
  // Scan backwards from the cursor for the most recent `[` that starts
  // an unclosed link pattern.
  const slice = lineText.slice(0, col);

  // Match from the last `[` that has not been closed by `](...)`
  const re = /\[([^\]\n]*)(?:\](\([^)\n]*)?)?\s*$/;
  const m = re.exec(slice);
  if (!m) return null;

  const start = m.index;
  const end = start + m[0].length; // extends to cursor

  // Make sure this isn't already a complete `[text](url)` match.
  const completeRe = new RegExp(link.pattern.source, "y");
  completeRe.lastIndex = start;
  if (completeRe.exec(lineText)) return null;

  return { start, end, src: m[0] };
}

/**
 * Render an in-progress `[text](url_partial` span.
 * All source characters are preserved as text nodes so extractText()
 * can reconstruct them via textContent.
 */
export function renderProgressLink(src: string): string {
  // Parse the partial source
  const m = src.match(/^\[([^\]]*)\]?(?:\(([^)]*))?$/);
  const text = m?.[1] ?? "";
  const hasClose = src.includes("](");
  const urlPart = hasClose ? (m?.[2] ?? "") : null;

  let html = `<span class="we-link-progress">`;
  html += `<span class="we-mark">[</span>`;
  if (text) html += `<span class="we-link-text">${esc(text)}</span>`;
  if (src.includes("]")) {
    if (hasClose) {
      html += `<span class="we-mark">](</span>`;
    } else {
      html += `<span class="we-mark">]</span>`;
    }
  }
  if (urlPart !== null) {
    html += `<span class="we-link-url-progress">${esc(urlPart)}</span>`;
  }
  html += `</span>`;
  return html;
}

// ── Line renderer ──────────────────────────────────────────────

/**
 * Render one markdown line to an HTML string.
 * `cursorCol` — when provided (cursor is on this line), enables in-progress
 * link rendering for any unclosed `[…` pattern at the cursor.
 */
export function renderLineHtml(line: string, cursorCol?: number): string {
  let body: string;

  if (cursorCol !== undefined) {
    const prog = findProgressLink(line, cursorCol);
    if (prog) {
      // Render prefix + progress span + suffix separately.
      const prefix = line.slice(0, prog.start);
      const suffix = line.slice(prog.end);
      body =
        renderInlineHtml(prefix) +
        renderProgressLink(prog.src) +
        renderInlineHtml(suffix);
    } else {
      body = renderInlineHtml(line);
    }
  } else {
    body = renderInlineHtml(line);
  }

  // h4+ — same visual weight as h3 but the margin mark shows numeric depth
  const deepMatch = line.match(/^(#{4,}) /);
  if (deepMatch) {
    const depth = deepMatch[1].length;
    const content = line.slice(deepMatch[0].length);
    return (
      `<div class="we-line we-h3">` +
      `<span class="we-mark" data-heading-depth="${depth}">${depth}#</span>` +
      renderInlineHtml(content) +
      `</div>`
    );
  }
  if (line.startsWith("### ")) {
    return (
      `<div class="we-line we-h3">` +
      `<span class="we-mark">### </span>` +
      renderInlineHtml(line.slice(4)) +
      `</div>`
    );
  }
  if (line.startsWith("## ")) {
    return (
      `<div class="we-line we-h2">` +
      `<span class="we-mark">## </span>` +
      renderInlineHtml(line.slice(3)) +
      `</div>`
    );
  }
  if (line.startsWith("# ")) {
    return (
      `<div class="we-line we-h1">` +
      `<span class="we-mark"># </span>` +
      renderInlineHtml(line.slice(2)) +
      `</div>`
    );
  }

  return `<div class="we-line">${body || "<br>"}</div>`;
}

/**
 * Render the full document value to an HTML string.
 * Pass `cursorPos` so in-progress links on the cursor's line render correctly.
 */
export function valueToHtml(
  value: string,
  cursorPos?: { line: number; col: number }
): string {
  return value
    .split("\n")
    .map((line, i) => {
      const col =
        cursorPos && cursorPos.line === i ? cursorPos.col : undefined;
      return renderLineHtml(line, col);
    })
    .join("");
}

// ── Text extraction ────────────────────────────────────────────

/**
 * Reconstruct the markdown source for one line element.
 * Walks direct children; delegates to modifier.extract() when present.
 */
export function extractLineText(lineEl: Element): string {
  let text = "";

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    const el = node as Element;

    // Deep heading mark — reconstruct the original #### prefix.
    const headingDepth = (el as HTMLElement).dataset.headingDepth;
    if (headingDepth) {
      text += "#".repeat(parseInt(headingDepth)) + " ";
      return;
    }

    // Find a modifier that owns this element.
    const mod = MODIFIERS.find(
      (m) => m.spanClass && el.classList.contains(m.spanClass)
    );
    if (mod?.extract) {
      text += mod.extract(el);
      return;
    }

    // Recurse into all other elements (strong, em, we-mark spans, etc.).
    for (const child of el.childNodes) {
      walk(child);
    }
  };

  for (const child of lineEl.childNodes) {
    walk(child);
  }

  return text;
}
