import type { ContentPlugin } from "./types";
import { esc } from "../utils";

function headingClass(depth: number): string {
  if (depth >= 3) return "we-h3";
  if (depth === 2) return "we-h2";
  return "we-h1";
}

function markHtml(depth: number): string {
  if (depth <= 3) {
    return `<span class="we-heading-mark" contenteditable="false">${esc("#".repeat(depth) + " ")}</span>`;
  }
  return `<span class="we-heading-mark" contenteditable="false" data-heading-depth="${depth}">${depth}#</span>`;
}

export const heading: ContentPlugin = {
  name: "heading",
  interaction: { kind: "line-prefix", pattern: /^(#{1,6}) /, activation: "line-mark" },

  extract(el: Element): string {
    let mark = "";
    let content = "";
    for (const child of el.childNodes) {
      const childEl = child as HTMLElement;
      if (childEl.classList?.contains?.("we-heading-mark")) {
        const depth = childEl.dataset?.headingDepth;
        mark = depth ? "#".repeat(parseInt(depth)) + " " : (child.textContent ?? "");
      } else {
        content += child.textContent ?? "";
      }
    }
    return mark + content;
  },

  // content: the heading text, already inline-rendered by the renderer
  render(m, content = "<br>") {
    const depth = m[1].length;
    return (
      `<div class="we-line ${headingClass(depth)}">` +
      markHtml(depth) +
      content +
      `</div>`
    );
  },

  transformLine(line, isCaretLine, _caretCol) {
    const m = line.match(/^(#{1,6})([^# \n])/);
    if (!m) return null;
    return {
      line: m[1] + " " + line.slice(m[1].length),
      colDelta: isCaretLine ? -m[1].length : 0,
    };
  },

  onKeyboardEvent(e, ctx) {
    if (e.type !== "keydown") return false;

    const { value, getCursor, setCursor, setValue, deactivate } = ctx;
    const lines = value.split("\n");
    const { line, col } = getCursor();
    const lineText = lines[line] ?? "";
    const m = lineText.match(/^(#{1,6}) /);
    if (!m) return false;
    const depth = m[1].length;

    if (e.key === "#") {
      if (depth >= 6) return true; // consume, clamp at 6
      lines[line] = "#".repeat(depth + 1) + " " + lineText.slice(m[0].length);
      setValue(lines.join("\n"));
      setCursor({ line, col });
      return true;
    }

    if (e.key === "Backspace" || e.key === "Delete") {
      if (depth > 1) {
        lines[line] = "#".repeat(depth - 1) + " " + lineText.slice(m[0].length);
        setValue(lines.join("\n"));
        setCursor({ line, col });
      } else {
        lines[line] = lineText.slice(m[0].length);
        setValue(lines.join("\n"));
        setCursor({ line, col: 0 });
        deactivate();
      }
      return true;
    }

    if (e.key === "ArrowLeft") {
      if (line > 0) {
        const prevText = lines[line - 1] ?? "";
        const prevM = prevText.match(/^(#{1,6}) /);
        const prevLen = prevM
          ? prevText.slice(prevM[0].length).length
          : prevText.length;
        setCursor({ line: line - 1, col: prevLen });
      }
      deactivate();
      return true;
    }

    if (e.key === "ArrowRight") {
      deactivate();
      return false; // let browser advance cursor into content
    }

    if (e.key === "ArrowUp") {
      if (line > 0) setCursor({ line: line - 1, col });
      deactivate();
      return true;
    }

    if (e.key === "ArrowDown") {
      if (line < lines.length - 1) setCursor({ line: line + 1, col });
      deactivate();
      return true;
    }

    // Printable character: exit mark, insert at col 0, move cursor after it
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      lines[line] =
        lineText.slice(0, m[0].length) + e.key + lineText.slice(m[0].length);
      setValue(lines.join("\n"));
      setCursor({ line, col: 1 });
      deactivate();
      return true;
    }

    return false;
  },
};
