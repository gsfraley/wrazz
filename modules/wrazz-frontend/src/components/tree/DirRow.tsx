import { memo } from "react";
import { ChevronRight, ChevronDown, FilePlus, FolderPlus, Trash2 } from "@/icons";
import { cx } from "@/lib/utils";
import styles from "@/components/FileTree.module.css";
import InlineEditInput from "@/components/tree/InlineEditInput";
import type { RefObject } from "react";

function entryName(path: string): string {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  return clean.split("/").pop() ?? path;
}

interface DirRowProps {
  path: string;
  isOpen: boolean;
  isEditing: boolean;
  isDragOver: boolean;
  indent: number;
  editValue: string;
  editInputRef: RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onEditValueChange: (v: string) => void;
  onNewFile: () => void;
  onNewDir: () => void;
  onDeleteConfirm: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const DirRow = memo(function DirRow({
  path,
  isOpen,
  isEditing,
  isDragOver,
  indent,
  editValue,
  editInputRef,
  onToggle,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onEditValueChange,
  onNewFile,
  onNewDir,
  onDeleteConfirm,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onContextMenu,
}: DirRowProps) {
  return (
    <div
      className={cx(styles.treeRow, isDragOver && styles.dragOver)}
      style={{ paddingLeft: indent }}
      onClick={() => !isEditing && onToggle()}
      onDoubleClick={() => onStartEdit()}
      onContextMenu={(e) => !isEditing && onContextMenu(e)}
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <span className={styles.treeChevron}>
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </span>
      {isEditing ? (
        <InlineEditInput
          inputRef={editInputRef}
          value={editValue}
          onChange={onEditValueChange}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      ) : (
        <>
          <span className={styles.treeName}>{entryName(path)}</span>
          <span className={styles.treeActions}>
            <button className={styles.btnIcon} onClick={(e) => { e.stopPropagation(); onNewFile(); }} aria-label="New file in folder">
              <FilePlus size={13} />
            </button>
            <button className={styles.btnIcon} onClick={(e) => { e.stopPropagation(); onNewDir(); }} aria-label="New folder in folder">
              <FolderPlus size={13} />
            </button>
            <button className={cx(styles.btnIcon, styles.btnIconDanger)} onClick={(e) => { e.stopPropagation(); onDeleteConfirm(); }} aria-label="Delete folder">
              <Trash2 size={13} />
            </button>
          </span>
        </>
      )}
    </div>
  );
});

export default DirRow;
