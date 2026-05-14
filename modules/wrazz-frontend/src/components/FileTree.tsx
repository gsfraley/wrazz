import { useState, useEffect, useRef } from "react";
import { useTreeStore } from "@/stores/treeStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useDraftStore } from "@/stores/draftStore";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useFileTreeOperations } from "@/components/tree/useFileTreeOperations";
import FileRow from "@/components/tree/FileRow";
import DirRow from "@/components/tree/DirRow";
import { Menu, Check, Plus, ChevronDown } from "@/icons";
import { cx } from "@/lib/utils";
import { buildContext, buildTargetForPath } from "@/lib/buildContext";
import { hooksForContextMenu, contextMenuItems } from "@/lib/pluginRegistry";
import type { Entry } from "@/api/files";
import type { DirEntry, RootEntry } from "@/lib/plugin";
import styles from "@/components/FileTree.module.css";

function sortedEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

function entryName(path: string): string {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  return clean.split("/").pop() ?? path;
}

export interface FileTreeProps {
  width: number;
}

export default function FileTree({ width }: FileTreeProps) {
  const { root, expanded, children, toggleDir } = useTreeStore();
  const { activePath } = useDocumentStore();
  const { draftPaths } = useDraftStore();
  const { setActiveCtx, openCtxMenu } = useUIStore();
  const { workspaces, activeWorkspaceId, setActive, createWorkspace } = useWorkspaceStore();
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const ops = useFileTreeOperations();
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  async function handleNewWorkspace() {
    setPickerOpen(false);
    const name = window.prompt("Workspace name:");
    if (!name?.trim()) return;
    const ws = await createWorkspace(name.trim());
    setActive(ws.id);
  }

  // Scroll the active file into view whenever it changes or a directory expands to reveal it.
  useEffect(() => {
    if (!activePath) return;
    const el = document.querySelector(`[data-tree-path="${activePath}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activePath, expanded]);

  function openMenuForPath(e: React.MouseEvent, path: string) {
    const ctx = buildContext();
    if (!ctx) return;
    const target = buildTargetForPath(path);
    const hooks = hooksForContextMenu(ctx, target);
    const items = contextMenuItems(ctx, target, hooks);
    if (items.length > 0) openCtxMenu(e, items);
  }

  async function handleDelete(path: string) {
    const ctx = buildContext();
    if (!ctx) return;
    const ok = await ctx.confirm(`Delete "${entryName(path)}"?`);
    if (!ok) return;
    const target = buildTargetForPath(path);
    if (target.kind === "file" || target.kind === "dir") await target.delete();
  }

  async function handleNewFile(dirPath: string) {
    const target = buildTargetForPath(dirPath);
    if (target.kind === "dir" || target.kind === "root") {
      await (target as DirEntry | RootEntry).newFile();
    }
  }

  async function handleNewDir(dirPath: string) {
    const target = buildTargetForPath(dirPath);
    if (target.kind === "dir" || target.kind === "root") {
      await (target as DirEntry | RootEntry).newDir();
    }
  }

  function renderEntries(entries: Entry[], depth: number): React.ReactNode {
    const fileIndent = depth * 16 + 24;
    const dirIndent = depth * 16 + 6;

    return sortedEntries(entries).map((entry) => {
      const isEditing = ops.editingPath === entry.path;
      const isDragOver = dragOverPath === entry.path;

      if (entry.kind === "dir") {
        const isOpen = expanded.has(entry.path);
        return (
          <div key={entry.path}>
            <DirRow
              path={entry.path}
              isOpen={isOpen}
              isEditing={isEditing}
              isDragOver={isDragOver}
              indent={dirIndent}
              editValue={ops.editValue}
              editInputRef={ops.editInputRef}
              onToggle={() => { void toggleDir(entry.path); }}
              onStartEdit={() => ops.startEdit(entry.path)}
              onCommitEdit={() => { void ops.commitEdit(); }}
              onCancelEdit={ops.cancelEdit}
              onEditValueChange={ops.setEditValue}
              onNewFile={() => { void handleNewFile(entry.path); }}
              onNewDir={() => { void handleNewDir(entry.path); }}
              onDeleteConfirm={() => { void handleDelete(entry.path); }}
              onDragStart={(e) => { e.stopPropagation(); setDragPath(entry.path); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverPath(entry.path); }}
              onDragLeave={(e) => { e.stopPropagation(); setDragOverPath(null); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragPath) void ops.moveEntry(dragPath, entry.path);
                setDragPath(null);
                setDragOverPath(null);
              }}
              onDragEnd={() => { setDragPath(null); setDragOverPath(null); }}
              onContextMenu={(e) => openMenuForPath(e, entry.path)}
            />
            {isOpen && renderEntries(children.get(entry.path) ?? [], depth + 1)}
          </div>
        );
      }

      return (
        <FileRow
          key={entry.path}
          path={entry.path}
          indent={fileIndent}
          isActive={entry.path === activePath}
          hasDraft={draftPaths.has(entry.path)}
          isEditing={isEditing}
          isDragOver={isDragOver}
          editValue={ops.editValue}
          editInputRef={ops.editInputRef}
          onOpen={() => { void useDocumentStore.getState().openFile(entry.path); }}
          onStartEdit={() => ops.startEdit(entry.path)}
          onCommitEdit={() => { void ops.commitEdit(); }}
          onCancelEdit={ops.cancelEdit}
          onEditValueChange={ops.setEditValue}
          onDeleteConfirm={() => { void handleDelete(entry.path); }}
          onDragStart={(e) => { e.stopPropagation(); setDragPath(entry.path); }}
          onDragEnd={() => { setDragPath(null); setDragOverPath(null); }}
          onContextMenu={(e) => openMenuForPath(e, entry.path)}
        />
      );
    });
  }

  return (
    <aside className={styles.sidebar} style={{ width }} onClick={() => setActiveCtx("fileTree")}>
      <div className={styles.sidebarHeader} ref={pickerRef}>
        <button
          className={styles.workspaceBtn}
          onClick={() => setPickerOpen((o) => !o)}
          title="Switch workspace"
        >
          <span className={styles.workspaceBtnLabel}>{activeWorkspace?.name ?? "Workspace"}</span>
          <ChevronDown size={12} className={cx(styles.workspaceBtnChevron, pickerOpen && styles.workspaceBtnChevronOpen)} />
        </button>
        <div className={styles.sidebarMenu}>
          <button
            className={styles.sidebarMenuBtn}
            onClick={(e) => openMenuForPath(e, "/")}
            aria-label="Workspace menu"
          >
            <Menu size={14} />
          </button>
        </div>
        {pickerOpen && (
          <div className={styles.wsDropdown}>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                className={cx(styles.wsItem, ws.id === activeWorkspaceId && styles.wsItemActive)}
                onClick={() => { setActive(ws.id); setPickerOpen(false); }}
              >
                <span className={styles.wsItemCheck}>
                  {ws.id === activeWorkspaceId && <Check size={12} />}
                </span>
                <span className={styles.wsItemName}>{ws.name}</span>
              </button>
            ))}
            <button
              className={cx(styles.wsItem, styles.wsItemNew)}
              onClick={() => { void handleNewWorkspace(); }}
            >
              <span className={styles.wsItemCheck}><Plus size={12} /></span>
              <span className={styles.wsItemName}>New workspace</span>
            </button>
          </div>
        )}
      </div>
      <div
        className={styles.tree}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest(`.${styles.treeRow}`)) return;
          openMenuForPath(e, "/");
        }}
      >
        {renderEntries(root, 0)}
        {dragPath !== null && (
          <div
            className={cx(styles.treeRootDrop, dragOverPath === "/" && styles.dragOver)}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverPath("/"); }}
            onDragLeave={(e) => { e.stopPropagation(); setDragOverPath(null); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragPath) void ops.moveEntry(dragPath, "/");
              setDragPath(null);
              setDragOverPath(null);
            }}
          >
            Move to root
          </div>
        )}
      </div>
    </aside>
  );
}
