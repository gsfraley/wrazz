import { memo } from "react";
import { Trash2 } from "@/icons";
import { cx } from "@/lib/utils";
import styles from "@/components/FileTree.module.css";
import InlineEditInput from "@/components/tree/InlineEditInput";
import type { RefObject } from "react";

function entryName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

interface FileRowProps {
  path: string;
  indent: number;
  isActive: boolean;
  hasDraft: boolean;
  isEditing: boolean;
  isDragOver: boolean;
  editValue: string;
  editInputRef: RefObject<HTMLInputElement | null>;
  onOpen: () => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onEditValueChange: (v: string) => void;
  onDeleteConfirm: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const FileRow = memo(function FileRow({
  path,
  indent,
  isActive,
  hasDraft,
  isEditing,
  isDragOver,
  editValue,
  editInputRef,
  onOpen,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onEditValueChange,
  onDeleteConfirm,
  onDragStart,
  onDragEnd,
  onContextMenu,
}: FileRowProps) {
  return (
    <div
      className={cx(
        styles.treeRow,
        isActive && styles.active,
        isDragOver && styles.dragOver,
      )}
      style={{ paddingLeft: indent }}
      data-tree-path={path}
      onClick={() => !isEditing && onOpen()}
      onDoubleClick={() => onStartEdit()}
      onContextMenu={(e) => !isEditing && onContextMenu(e)}
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
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
          {hasDraft && <span className={styles.treeDraftDot} />}
          <span className={styles.treeActions}>
            <button
              className={cx(styles.btnIcon, styles.btnIconDanger)}
              onClick={(e) => { e.stopPropagation(); onDeleteConfirm(); }}
              aria-label="Delete file"
            >
              <Trash2 size={13} />
            </button>
          </span>
        </>
      )}
    </div>
  );
});

export default FileRow;
