import { useState, useRef, useEffect } from "react";
import { createFile, createDir, deleteEntry, moveEntry } from "@/api/files";
import { useTreeStore } from "@/stores/treeStore";
import { useDocumentStore } from "@/stores/documentStore";
import { ApiError } from "@/lib/apiError";

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

export interface FileTreeOps {
  editingPath: string | null;
  editValue: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  startEdit: (path: string) => void;
  commitEdit: () => Promise<void>;
  cancelEdit: () => void;
  setEditValue: (v: string) => void;
  newFile: (parentPath?: string) => Promise<void>;
  newDir: (parentPath?: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  moveEntry: (src: string, destDir: string) => Promise<void>;
}

export function useFileTreeOperations(): FileTreeOps {
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const { ensureExpanded, refreshDir, collapseDir } = useTreeStore();
  const { activePath, openFile, closeFile } = useDocumentStore();

  // Focus and select the edit input whenever editingPath changes.
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

  function startEdit(path: string) {
    setEditingPath(path);
    setEditValue(entryName(path));
  }

  function cancelEdit() {
    setEditingPath(null);
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
      if (isDir) collapseDir(editingPath);
      await refreshDir(parent);
      if (!isDir && editingPath === activePath) {
        await openFile(newPath);
      }
    } catch {
      // Silently revert — TODO: surface via notification system
    }
  }

  async function doNewFile(parentPath = "/") {
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
        await openFile(file.path);
        return;
      } catch (err) {
        if (err instanceof ApiError && err.isConflict) continue;
        break;
      }
    }
  }

  async function doNewDir(parentPath = "/") {
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
      } catch (err) {
        if (err instanceof ApiError && err.isConflict) continue;
        break;
      }
    }
  }

  async function doDelete(path: string) {
    const parent = parentDir(path);
    try {
      await deleteEntry(path);
      if (path.endsWith("/")) collapseDir(path);
      await refreshDir(parent);
      // Close active file if it was deleted.
      if (activePath && (activePath === path || activePath.startsWith(path))) {
        closeFile();
      }
    } catch {
      // TODO: surface via notification system
    }
  }

  async function doMove(src: string, destDir: string) {
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
      if (isDir) collapseDir(src);
      if (!isDir && src === activePath) await openFile(newPath);
    } catch {
      // TODO: surface via notification system
    }
  }

  return {
    editingPath,
    editValue,
    editInputRef,
    startEdit,
    commitEdit,
    cancelEdit,
    setEditValue,
    newFile: doNewFile,
    newDir: doNewDir,
    deleteEntry: doDelete,
    moveEntry: doMove,
  };
}
