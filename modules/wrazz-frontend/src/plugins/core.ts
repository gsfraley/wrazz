import type { Plugin } from "@/lib/plugin";
import { Save, RotateCcw, FilePlus, FolderPlus, Download } from "@/icons";
import { triggerDownload } from "@/lib/triggerDownload";

export const corePlugin: Plugin = {
  id: "core",
  hooks: () => [
    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    {
      type: "keyboard",
      shortcut: "Mod-k",
      run: (ctx) => { ctx.openPalette(); },
    },
    {
      type: "keyboard",
      shortcut: "Mod-s",
      label: "Save",
      run: async (ctx) => { await ctx.editor.activeFile?.save(); },
    },

    // ── Command palette ───────────────────────────────────────────────────────
    {
      type: "command",
      label: "Save",
      keywords: ["save", "write"],
      icon: Save,
      group: "CURRENT FILE",
      present: (ctx) => ctx.editor.activeFile !== null,
      run: async (ctx) => { await ctx.editor.activeFile?.save(); },
    },
    {
      type: "command",
      label: "Discard changes",
      keywords: ["discard", "revert", "reset"],
      icon: RotateCcw,
      group: "CURRENT FILE",
      present: (ctx) => ctx.editor.activeFile?.isDirty === true,
      run: async (ctx) => { await ctx.editor.activeFile?.discard(); },
    },
    {
      type: "command",
      label: "Export file",
      keywords: ["export", "download"],
      icon: Download,
      group: "CURRENT FILE",
      present: (ctx) => ctx.editor.activeFile !== null,
      run: (ctx) => {
        const path = ctx.editor.activeFile?.path;
        if (path) triggerDownload(`/api/export/file/${path.replace(/^\/|\/$/g, "")}`);
      },
    },
    {
      type: "command",
      label: "New file",
      keywords: ["create", "file", "new"],
      icon: FilePlus,
      group: "WORKSPACE",
      present: () => true,
      run: async (ctx) => { await ctx.fileTree.root.newFile(); },
    },
    {
      type: "command",
      label: "New folder",
      keywords: ["create", "folder", "directory", "new"],
      icon: FolderPlus,
      group: "WORKSPACE",
      present: () => true,
      run: async (ctx) => { await ctx.fileTree.root.newDir(); },
    },
    {
      type: "command",
      label: "Export workspace",
      keywords: ["export", "download", "zip", "all"],
      icon: Download,
      group: "WORKSPACE",
      present: () => true,
      run: () => { triggerDownload("/api/export/dir"); },
    },
  ],
};
