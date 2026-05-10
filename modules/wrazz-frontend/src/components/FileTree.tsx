import { useState, forwardRef, useImperativeHandle } from "react";
import { useTreeStore } from "@/stores/treeStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useDraftStore } from "@/stores/draftStore";
import { useUIStore } from "@/stores/uiStore";
import { useFileTreeOperations } from "@/components/tree/useFileTreeOperations";
import FileRow from "@/components/tree/FileRow";
import DirRow from "@/components/tree/DirRow";
import { Menu } from "@/icons";
import { cx } from "@/lib/utils";
import { triggerDownload } from "@/lib/triggerDownload";
import type { Entry } from "@/api/files";
import type { ContextMenuItem } from "@/components/ContextMenu";
import ConfirmModal from "@/components/modals/ConfirmModal";
import styles from "@/components/FileTree.module.css";

function pathToUrl(path: string): string {
  return path.replace(/^\/|\/$/g, "");
}

function entryName(path: string): string {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  return clean.split("/").pop() ?? path;
}

function sortedEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

export interface FileTreeHandle {
  newFile: (parentPath?: string) => void;
  newDir: (parentPath?: string) => void;
}

export interface FileTreeProps {
  width: number;
}

const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree({ width }, ref) {
  const { root, expanded, children, toggleDir } = useTreeStore();
  const { activePath } = useDocumentStore();
  const { draftPaths } = useDraftStore();
  const { setActiveCtx, openCtxMenu } = useUIStore();

  const ops = useFileTreeOperations();
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    newFile: (parentPath = "/") => { void ops.newFile(parentPath); },
    newDir: (parentPath = "/") => { void ops.newDir(parentPath); },
  }));

  function fileCtxItems(path: string): ContextMenuItem[] {
    return [
      { type: "item", label: "Rename", onClick: () => ops.startEdit(path) },
      { type: "separator" },
      { type: "item", label: "Export", onClick: () => triggerDownload(`/api/export/file/${pathToUrl(path)}`) },
      { type: "item", label: "Delete", danger: true, onClick: () => ops.deleteEntry(path) },
    ];
  }

  function dirCtxItems(path: string): ContextMenuItem[] {
    return [
      { type: "item", label: "New file", onClick: () => ops.newFile(path) },
      { type: "item", label: "New folder", onClick: () => ops.newDir(path) },
      { type: "separator" },
      { type: "item", label: "Rename", onClick: () => ops.startEdit(path) },
      { type: "separator" },
      { type: "item", label: "Export as zip", onClick: () => triggerDownload(`/api/export/dir/${pathToUrl(path)}`) },
      { type: "item", label: "Delete", danger: true, onClick: () => ops.deleteEntry(path) },
    ];
  }

  function backgroundCtxItems(): ContextMenuItem[] {
    return [
      { type: "item", label: "New file", onClick: () => ops.newFile("/") },
      { type: "item", label: "New folder", onClick: () => ops.newDir("/") },
    ];
  }

  function workspaceCtxItems(): ContextMenuItem[] {
    return [
      { type: "item", label: "New file", onClick: () => ops.newFile("/") },
      { type: "item", label: "New folder", onClick: () => ops.newDir("/") },
      { type: "separator" },
      { type: "item", label: "Export workspace", onClick: () => triggerDownload("/api/export/dir/") },
    ];
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
              onNewFile={() => { void ops.newFile(entry.path); }}
              onNewDir={() => { void ops.newDir(entry.path); }}
              onDeleteConfirm={() => setConfirmPath(entry.path)}
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
              onContextMenu={(e) => openCtxMenu(e, dirCtxItems(entry.path))}
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
          onDeleteConfirm={() => setConfirmPath(entry.path)}
          onDragStart={(e) => { e.stopPropagation(); setDragPath(entry.path); }}
          onDragEnd={() => { setDragPath(null); setDragOverPath(null); }}
          onContextMenu={(e) => openCtxMenu(e, fileCtxItems(entry.path))}
        />
      );
    });
  }

  return (
    <aside className={styles.sidebar} style={{ width }} onClick={() => setActiveCtx("file-tree")}>
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarHeading}>Workspace</span>
        <div className={styles.sidebarMenu}>
          <button
            className={styles.sidebarMenuBtn}
            onClick={(e) => openCtxMenu(e, workspaceCtxItems(), "top-to-element-bottom", "left-to-element-left")}
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
          openCtxMenu(e, backgroundCtxItems());
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
      {confirmPath && (
        <ConfirmModal
          message={`Delete "${entryName(confirmPath)}"?`}
          onConfirm={() => { void ops.deleteEntry(confirmPath); }}
          onClose={() => setConfirmPath(null)}
        />
      )}
    </aside>
  );
});

export default FileTree;
