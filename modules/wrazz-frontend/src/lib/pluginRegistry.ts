import type { Plugin, Hook, Context, TreeEntry } from "@/lib/plugin";
import type { ContextMenuItem } from "@/components/ContextMenu";

type KeyboardHook    = Extract<Hook, { type: "keyboard" }>;
type CommandHook     = Extract<Hook, { type: "command" }>;
type ContextMenuHook = Extract<Hook, { type: "contextMenu" }>;

interface PluginEntry {
  plugin: Plugin;
  hooks: Hook[];
}

const _entries: PluginEntry[] = [];

export function registerPlugin(plugin: Plugin): () => void {
  const hooks = plugin.hooks();
  const entry: PluginEntry = { plugin, hooks };
  _entries.push(entry);
  return () => {
    const i = _entries.indexOf(entry);
    if (i !== -1) _entries.splice(i, 1);
  };
}

function allHooks(): Hook[] {
  return _entries.flatMap((e) => e.hooks);
}

// ── Shortcut matching ─────────────────────────────────────────────────────────

export function matchesShortcut(shortcut: string, e: KeyboardEvent): boolean {
  const parts = shortcut.toLowerCase().split("-");
  const key = parts[parts.length - 1];
  const needsMod   = parts.includes("mod");
  const needsShift = parts.includes("shift");
  const needsAlt   = parts.includes("alt");
  const hasMod = e.ctrlKey || e.metaKey;
  return (
    e.key.toLowerCase() === key &&
    hasMod      === needsMod   &&
    e.shiftKey  === needsShift &&
    e.altKey    === needsAlt
  );
}

// ── Hook queries ──────────────────────────────────────────────────────────────

export function hooksForKeyboard(e: KeyboardEvent): KeyboardHook[] {
  return allHooks().filter(
    (h): h is KeyboardHook =>
      h.type === "keyboard" && matchesShortcut(h.shortcut, e),
  );
}

export function hooksForPalette(ctx: Context): CommandHook[] {
  return allHooks().filter(
    (h): h is CommandHook => h.type === "command" && h.present(ctx),
  );
}

export function hooksForContextMenu(ctx: Context, target: TreeEntry): ContextMenuHook[] {
  return allHooks().filter(
    (h): h is ContextMenuHook =>
      h.type === "contextMenu" && h.present(ctx, target),
  );
}

// Finds a keyboard shortcut whose label matches a command label, for palette hints.
export function shortcutForLabel(label: string): string | undefined {
  return (allHooks().find(
    (h): h is KeyboardHook => h.type === "keyboard" && h.label === label,
  ) as KeyboardHook | undefined)?.shortcut;
}

// Converts context menu hooks to ContextMenuItem[], inserting separators between groups.
export function contextMenuItems(
  ctx: Context,
  target: TreeEntry,
  hooks: ContextMenuHook[],
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  let lastGroup: string | undefined = undefined;
  for (const h of hooks) {
    if (lastGroup !== undefined && h.group !== lastGroup) {
      items.push({ type: "separator" });
    }
    items.push({
      type: "item",
      label: h.label,
      danger: h.danger,
      icon: h.icon,
      onClick: () => { void h.run(ctx, target); },
    });
    lastGroup = h.group;
  }
  return items;
}
