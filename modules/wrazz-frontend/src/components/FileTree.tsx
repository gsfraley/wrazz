import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { Entry, createFile, createDir, moveEntry, deleteEntry, listEntries } from "../api/files";
import { ChevronRight, ChevronDown, Download, FilePlus, FolderPlus, Pencil, Trash2, Menu } from "../icons";
import { useActiveContext } from "../lib/context";
import { useContextMenu } from "../lib/contextMenu";
import { cx } from "../lib/utils";
import type { ContextMenuItem } from "./ContextMenu";
import ConfirmModal from "./modals/ConfirmModal";
import styles from "./FileTree.module.css";

function pathToUrl(path: string): string {
  return path.replace(/^\/|\/$/g, "");
}

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export interface FileTreeHandle {
  newFile: (parentPath?: string) => void;
  newDir: (parentPath?: string) => void;
}

export interface FileTreeProps {
  activePath: string | null;
  onOpen: (path: string) => void;
  onDeleted: (path: string) => void;
  reloadKey: number;
  width: number;
  draftPaths: Set<string>;
}

// ── Path helpers ───────────────────────────────────────────────────────────

function entryName(path: string): string {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  return clean.split("/").pop() ?? path;
}

function parentDir(path: string): string {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = clean.split("/");
  parts.pop();
  const joined = parts.join("/");
  return joined === "" ? "/" : joined + "/";
}

function sortedEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

// ── Component ──────────────────────────────────────────────────────────────

const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(
  { activePath, onOpen, onDeleted, reloadKey, width, draftPaths },
  ref,
) {
  const [root, setRoot] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Map<string, Entry[]>>(new Map());
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const { setCtx: setActivePane } = useActiveContext();
  const openCtx = useContextMenu();

  useImperativeHandle(ref, () => ({
    newFile: (parentPath = "/") => doNewFile(parentPath),
    newDir: (parentPath = "/") => doNewDir(parentPath),
  }));

  useEffect(() => {
    const input = editInputRef.current;
    if (!editingPath || !input) return;
    input.focus();
    if (editingPath.endsWith("/")) {
      input.select();
    } else {
      const dot = input.value.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    }
  }, [editingPath]);

  useEffect(() => {
    async function refresh() {
      const rootEntries = await listEntries("/").catch(() => []);
      setRoot(rootEntries);
      const refreshed = new Map<string, Entry[]>();
      await Promise.all(
        [...expandedRef.current].map(async (p) => {
          const entries = await listEntries(p).catch(() => []);
          refreshed.set(p, entries);
        }),
      );
      setChildren(refreshed);
    }
    refresh();
  }, [reloadKey]);

  // ── Data helpers ─────────────────────────────────────────────────────────

  async function refreshDir(dirPath: string) {
    const entries = await listEntries(dirPath).catch(() => []);
    if (dirPath === "/") {
      setRoot(entries);
    } else {
      setChildren((prev) => new Map(prev).set(dirPath, entries));
    }
  }

  async function ensureExpanded(dirPath: string) {
    if (expanded.has(dirPath)) return;
    const entries = await listEntries(dirPath).catch(() => []);
    setExpanded((prev) => new Set([...prev, dirPath]));
    setChildren((prev) => new Map(prev).set(dirPath, entries));
  }

  async function toggleDir(dirPath: string) {
    if (expanded.has(dirPath)) {
      setExpanded((prev) => { const s = new Set(prev); s.delete(dirPath); return s; });
    } else {
      await ensureExpanded(dirPath);
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async function doNewFile(parentPath: string) {
    if (parentPath !== "/") await ensureExpanded(parentPath);
    const dir = parentPath === "/" ? "" : parentPath.replace(/\/$/, "");
    for (let i = 0; i <= 9; i++) {
      const name = i === 0 ? "untitled.md" : `untitled-${i + 1}.md`;
      const path = `${dir}/${name}`;
      try {
        const file = await createFile(path, null, [], "");
        await refreshDir(parentPath);
        setEditingPath(file.path);
        setEditValue(entryName(file.path));
        onOpen(file.path);
        return;
      } catch { /* conflict — try next suffix */ }
    }
  }

  async function doNewDir(parentPath: string) {
    if (parentPath !== "/") await ensureExpanded(parentPath);
    const dir = parentPath === "/" ? "" : parentPath.replace(/\/$/, "");
    for (let i = 0; i <= 9; i++) {
      const name = i === 0 ? "new-folder" : `new-folder-${i + 1}`;
      const path = `${dir}/${name}`;
      try {
        await createDir(path);
        await refreshDir(parentPath);
        setEditingPath(`${path}/`);
        setEditValue(name);
        return;
      } catch { /* conflict — try next suffix */ }
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  // No confirmation — used by the context menu (right-click is itself deliberate).
  async function doDelete(path: string) {
    const parent = parentDir(path);
    try {
      await deleteEntry(path);
      if (path.endsWith("/")) {
        setExpanded((prev) => { const s = new Set(prev); s.delete(path); return s; });
        setChildren((prev) => { const m = new Map(prev); m.delete(path); return m; });
      }
      await refreshDir(parent);
      onDeleted(path);
    } catch { /* delete failed */ }
  }

  // Confirmation — used by the visible trash icon (single accidental click is plausible).
  function doDeleteConfirm(path: string) {
    setConfirmPath(path);
  }

  // ── Rename (inline edit) ──────────────────────────────────────────────────

  function startEdit(path: string) {
    setEditingPath(path);
    setEditValue(entryName(path));
  }

  async function commitEdit() {
    if (!editingPath) return;
    const newName = editValue.trim();
    const oldName = entryName(editingPath);
    setEditingPath(null);

    if (!newName || newName === oldName) return;

    const isDir = editingPath.endsWith("/");
    const parent = parentDir(editingPath);
    const dirPrefix = parent === "/" ? "" : parent.replace(/\/$/, "");
    const newPath = isDir ? `${dirPrefix}/${newName}/` : `${dirPrefix}/${newName}`;

    try {
      await moveEntry(editingPath, newPath);
      if (isDir) {
        setExpanded((prev) => { const s = new Set(prev); s.delete(editingPath); return s; });
        setChildren((prev) => { const m = new Map(prev); m.delete(editingPath); return m; });
      }
      await refreshDir(parent);
      if (!isDir && editingPath === activePath) onOpen(newPath);
    } catch { /* rename failed — silently revert */ }
  }

  // ── Drag and drop ─────────────────────────────────────────────────────────

  async function handleDrop(destDir: string) {
    const src = dragPath;
    setDragPath(null);
    setDragOverPath(null);
    if (!src) return;

    const isDir = src.endsWith("/");
    if (isDir && destDir.startsWith(src)) return;

    const srcName = entryName(src);
    const prefix = destDir === "/" ? "" : destDir.replace(/\/$/, "");
    const newPath = isDir ? `${prefix}/${srcName}/` : `${prefix}/${srcName}`;

    if (newPath === src) return;

    try {
      await moveEntry(src, newPath);
      const srcParent = parentDir(src);
      await refreshDir(srcParent);
      if (destDir !== srcParent) await refreshDir(destDir);
      if (isDir) {
        setExpanded((prev) => { const s = new Set(prev); s.delete(src); return s; });
        setChildren((prev) => { const m = new Map(prev); m.delete(src); return m; });
      }
      if (!isDir && src === activePath) onOpen(newPath);
    } catch { /* move failed */ }
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  function fileCtxItems(path: string): ContextMenuItem[] {
    return [
      { type: "item", label: "Rename", icon: Pencil, onClick: () => startEdit(path) },
      { type: "separator" },
      { type: "item", label: "Export", icon: Download, onClick: () => triggerDownload(`/api/export/file/${pathToUrl(path)}`) },
      { type: "item", label: "Delete", danger: true, icon: Trash2, onClick: () => doDelete(path) },
    ];
  }

  function dirCtxItems(path: string): ContextMenuItem[] {
    return [
      { type: "item", label: "New file", icon: FilePlus, onClick: () => doNewFile(path) },
      { type: "item", label: "New folder", icon: FolderPlus, onClick: () => doNewDir(path) },
      { type: "separator" },
      { type: "item", label: "Rename", icon: Pencil, onClick: () => startEdit(path) },
      { type: "separator" },
      { type: "item", label: "Export as zip", icon: Download, onClick: () => triggerDownload(`/api/export/dir/${pathToUrl(path)}`) },
      { type: "item", label: "Delete", danger: true, icon: Trash2, onClick: () => doDelete(path) },
    ];
  }

  function backgroundCtxItems(): ContextMenuItem[] {
    return [
      { type: "item", label: "New file", icon: FilePlus, onClick: () => doNewFile("/") },
      { type: "item", label: "New folder", icon: FolderPlus, onClick: () => doNewDir("/") },
    ];
  }

  function workspaceCtxItems(): ContextMenuItem[] {
    return [
      { type: "item", label: "New file", icon: FilePlus, onClick: () => doNewFile("/") },
      { type: "item", label: "New folder", icon: FolderPlus, onClick: () => doNewDir("/") },
      { type: "separator" },
      { type: "item", label: "Export workspace", icon: Download, onClick: () => triggerDownload(`/api/export/dir/`) },
    ];
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderEntries(entries: Entry[], depth: number): React.ReactNode {
    const fileIndent = depth * 16 + 24;
    const dirIndent  = depth * 16 + 6;

    return sortedEntries(entries).map((entry) => {
      const isEditing = editingPath === entry.path;
      const isDragOver = dragOverPath === entry.path;

      if (entry.kind === "dir") {
        const isOpen = expanded.has(entry.path);
        return (
          <div key={entry.path}>
            <div
              className={cx(styles.treeRow, isDragOver && styles.dragOver)}
              style={{ paddingLeft: dirIndent }}
              onClick={() => !isEditing && toggleDir(entry.path)}
              onDoubleClick={() => startEdit(entry.path)}
              onContextMenu={(e) => !isEditing && openCtx(e, dirCtxItems(entry.path))}
              draggable={!isEditing}
              onDragStart={(e) => { e.stopPropagation(); setDragPath(entry.path); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverPath(entry.path); }}
              onDragLeave={(e) => { e.stopPropagation(); setDragOverPath(null); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(entry.path); }}
              onDragEnd={() => { setDragPath(null); setDragOverPath(null); }}
            >
              <span className={styles.treeChevron}>
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
              {isEditing ? (
                <input
                  ref={editInputRef}
                  className={styles.treeEditInput}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                    if (e.key === "Escape") setEditingPath(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className={styles.treeName}>{entryName(entry.path)}</span>
              )}
              {!isEditing && (
                <span className={styles.treeActions}>
                  <button className={styles.btnIcon} onClick={(e) => { e.stopPropagation(); doNewFile(entry.path); }} aria-label="New file in folder">
                    <FilePlus size={13} />
                  </button>
                  <button className={styles.btnIcon} onClick={(e) => { e.stopPropagation(); doNewDir(entry.path); }} aria-label="New folder in folder">
                    <FolderPlus size={13} />
                  </button>
                  <button className={cx(styles.btnIcon, styles.btnIconDanger)} onClick={(e) => { e.stopPropagation(); doDeleteConfirm(entry.path); }} aria-label="Delete folder">
                    <Trash2 size={13} />
                  </button>
                </span>
              )}
            </div>
            {isOpen && renderEntries(children.get(entry.path) ?? [], depth + 1)}
          </div>
        );
      }

      return (
        <div
          key={entry.path}
          className={cx(styles.treeRow, entry.path === activePath && styles.active)}
          style={{ paddingLeft: fileIndent }}
          onClick={() => !isEditing && onOpen(entry.path)}
          onDoubleClick={() => startEdit(entry.path)}
          onContextMenu={(e) => !isEditing && openCtx(e, fileCtxItems(entry.path))}
          draggable={!isEditing}
          onDragStart={(e) => { e.stopPropagation(); setDragPath(entry.path); }}
          onDragEnd={() => { setDragPath(null); setDragOverPath(null); }}
        >
          {isEditing ? (
            <input
              ref={editInputRef}
              className={styles.treeEditInput}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                if (e.key === "Escape") setEditingPath(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className={styles.treeName}>{entryName(entry.path)}</span>
              {draftPaths.has(entry.path) && <span className={styles.treeDraftDot} />}
              <span className={styles.treeActions}>
                <button className={cx(styles.btnIcon, styles.btnIconDanger)} onClick={(e) => { e.stopPropagation(); doDeleteConfirm(entry.path); }} aria-label="Delete file">
                  <Trash2 size={13} />
                </button>
              </span>
            </>
          )}
        </div>
      );
    });
  }

  return (
    <aside className={styles.sidebar} style={{ width }} onClick={() => setActivePane("file-tree")}>
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarHeading}>Workspace</span>
        <div className={styles.sidebarMenu}>
          <button
            className={styles.sidebarMenuBtn}
            onClick={(e) => openCtx(e, workspaceCtxItems(), "top-to-element-bottom", "left-to-element-left")}
            onContextMenu={(e) => openCtx(e, workspaceCtxItems(), "top-to-element-bottom", "left-to-element-left")}
            aria-label="Workspace menu"
          >
            <Menu size={14} />
          </button>
        </div>
      </div>
      <div
        className={styles.tree}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest(`.${styles.treeRow}`)) return;
          openCtx(e, backgroundCtxItems());
        }}
      >
        {renderEntries(root, 0)}
        {dragPath !== null && (
          <div
            className={cx(styles.treeRootDrop, dragOverPath === "/" && styles.dragOver)}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverPath("/"); }}
            onDragLeave={(e) => { e.stopPropagation(); setDragOverPath(null); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop("/"); }}
          >
            Move to root
          </div>
        )}
      </div>
      {confirmPath && (
        <ConfirmModal
          message={`Delete "${entryName(confirmPath)}"?`}
          onConfirm={() => doDelete(confirmPath)}
          onClose={() => setConfirmPath(null)}
        />
      )}
    </aside>
  );
});

export default FileTree;
