import { esc } from "./utils";
import { PLUGINS, INLINE_PLUGINS, LINE_PREFIX_PLUGINS } from "./plugins/index";

// ── Plugin output tagging ──────────────────────────────────────
//
// Inserts data-we-plugin on the outermost element of a plugin's rendered
// HTML so the editor can identify ownership without checking plugin names.

function tagPluginOutput(html: string, name: string): string {
  const m = html.match(/^<([a-zA-Z][a-zA-Z0-9-]*)/);
  if (m) {
    return `<${m[1]} data-we-plugin="${name}"` + html.slice(m[0].length);
  }
  return `<span data-we-plugin="${name}">${html}</span>`;
}

// ── Pre-compiled sticky patterns for inline hot path ──────────

const stickyPatterns = new Map<string, RegExp>(
  INLINE_PLUGINS.map((p) => [
    p.name,
    new RegExp(p.interaction.pattern.source, "y"),
  ])
);

// ── Rendering ─────────────────────────────────────────────────

export function renderInlineHtml(text: string): string {
  let result = "";
  let i = 0;

  while (i < text.length) {
    let matched = false;

    for (const plugin of INLINE_PLUGINS) {
      const re = stickyPatterns.get(plugin.name)!;
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) {
        result += tagPluginOutput(plugin.render(m), plugin.name);
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

export function renderLineHtml(line: string): string {
  for (const plugin of LINE_PREFIX_PLUGINS) {
    const m = plugin.interaction.pattern.exec(line);
    if (m) {
      const content = renderInlineHtml(line.slice(m[0].length)) || "<br>";
      return tagPluginOutput(plugin.render(m, content), plugin.name);
    }
  }

  const body = renderInlineHtml(line);
  return `<div class="we-line">${body || "<br>"}</div>`;
}

export function valueToHtml(value: string): string {
  return value
    .split("\n")
    .map((line) => renderLineHtml(line))
    .join("");
}

// ── Extraction ─────────────────────────────────────────────────

export function extractLineText(lineEl: Element): string {
  const linePluginName = (lineEl as HTMLElement).dataset?.wePlugin;
  if (linePluginName) {
    const plugin = PLUGINS.find((p) => p.name === linePluginName);
    if (plugin?.extract) return plugin.extract(lineEl);
  }

  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    const el = node as HTMLElement;
    const pluginName = el.dataset?.wePlugin;
    const plugin = pluginName ? PLUGINS.find((p) => p.name === pluginName) : null;
    if (plugin?.extract) {
      text += plugin.extract(el);
      return;
    }
    for (const child of el.childNodes) walk(child);
  };

  for (const child of lineEl.childNodes) walk(child);
  return text;
}

export function extractText(root: HTMLElement): string {
  const lines: string[] = [];
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      lines.push(child.textContent ?? "");
    } else if ((child as Element).classList?.contains("we-line")) {
      lines.push(extractLineText(child as Element));
    }
  }
  return lines.join("\n");
}
