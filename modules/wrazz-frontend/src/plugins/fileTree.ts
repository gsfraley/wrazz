import type { Plugin, DirEntry, RootEntry } from "@/lib/plugin";
import { useUIStore } from "@/stores/uiStore";
import { triggerDownload } from "@/lib/triggerDownload";
import { FilePlus, FolderPlus, Pencil, Download, Trash2 } from "@/icons";

function pathToUrl(path: string): string {
  return path.replace(/^\/|\/$/g, "");
}

function entryName(path: string): string {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  return clean.split("/").pop() ?? path;
}

export const fileTreePlugin: Plugin = {
  id: "fileTree",
  hooks: () => [
    // ── Create (dirs and root only) ───────────────────────────────────────────
    {
      type: "contextMenu",
      label: "New file",
      icon: FilePlus,
      group: "create",
      present: (_ctx, target) => target.kind === "dir" || target.kind === "root",
      run: (_ctx, target) => { void (target as DirEntry | RootEntry).newFile(); },
    },
    {
      type: "contextMenu",
      label: "New folder",
      icon: FolderPlus,
      group: "create",
      present: (_ctx, target) => target.kind === "dir" || target.kind === "root",
      run: (_ctx, target) => { void (target as DirEntry | RootEntry).newDir(); },
    },

    // ── Rename (files and dirs, not root) ─────────────────────────────────────
    {
      type: "contextMenu",
      label: "Rename",
      icon: Pencil,
      group: "edit",
      present: (_ctx, target) => target.kind === "file" || target.kind === "dir",
      run: (_ctx, target) => {
        if (target.kind === "file" || target.kind === "dir") {
          useUIStore.getState().setInlineEditPath(target.path);
        }
      },
    },

    // ── Export ────────────────────────────────────────────────────────────────
    {
      type: "contextMenu",
      label: "Export",
      icon: Download,
      group: "export",
      present: (_ctx, target) => target.kind === "file",
      run: (_ctx, target) => { triggerDownload(`/api/export/file/${pathToUrl(target.path)}`); },
    },
    {
      type: "contextMenu",
      label: "Export as zip",
      icon: Download,
      group: "export",
      present: (_ctx, target) => target.kind === "dir" || target.kind === "root",
      run: (_ctx, target) => { triggerDownload(`/api/export/dir/${pathToUrl(target.path)}`); },
    },

    // ── Delete (files and dirs, not root) ─────────────────────────────────────
    {
      type: "contextMenu",
      label: "Delete",
      icon: Trash2,
      group: "danger",
      danger: true,
      present: (_ctx, target) => target.kind === "file" || target.kind === "dir",
      run: async (ctx, target) => {
        const name = entryName(target.path);
        const ok = await ctx.confirm(`Delete "${name}"?`);
        if (!ok) return;
        if (target.kind === "file" || target.kind === "dir") await target.delete();
      },
    },
  ],
};
