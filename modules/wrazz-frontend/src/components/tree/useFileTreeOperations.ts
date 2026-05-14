import { useState, useRef, useEffect } from "react";
import { moveEntry } from "@/api/files";
import { useTreeStore } from "@/stores/treeStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

function activeWorkspaceId(): string | null {
  return useWorkspaceStore.getState().activeWorkspaceId;
}

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
  setEditValue: (v: string) => void;
  startEdit: (path: string) => void;
  commitEdit: () => Promise<void>;
  cancelEdit: () => void;
  moveEntry: (src: string, destDir: string) => Promise<void>;
}

export function useFileTreeOperations(): FileTreeOps {
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const { refreshDir, collapseDir } = useTreeStore();
  const { activePath, openFile } = useDocumentStore();
  const { inlineEditPath, setInlineEditPath } = useUIStore();

  // Consume inlineEditPath from uiStore to start inline rename.
  // Set by plugins (Rename context menu item, createFile/createDir after creation).
  useEffect(() => {
    if (inlineEditPath !== null) {
      setEditingPath(inlineEditPath);
      setEditValue(entryName(inlineEditPath));
      setInlineEditPath(null);
    }
  }, [inlineEditPath, setInlineEditPath]);

  // Focus and select the input whenever editingPath changes.
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

    const wsId = activeWorkspaceId();
    if (!wsId) return;
    try {
      await moveEntry(wsId, editingPath, newPath);
      if (isDir) collapseDir(editingPath);
      await refreshDir(parent);
      if (!isDir && editingPath === activePath) await openFile(newPath);
    } catch {
      // Silently revert — TODO: surface via notification system
    }
  }

  async function doMove(src: string, destDir: string) {
    const isDir = src.endsWith("/");
    if (isDir && destDir.startsWith(src)) return;
    const srcName = entryName(src);
    const prefix = destDir === "/" ? "" : destDir.replace(/\/$/, "");
    const newPath = isDir ? `${prefix}/${srcName}/` : `${prefix}/${srcName}`;
    if (newPath === src) return;

    const wsId = activeWorkspaceId();
    if (!wsId) return;
    try {
      await moveEntry(wsId, src, newPath);
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
    setEditValue,
    startEdit,
    commitEdit,
    cancelEdit,
    moveEntry: doMove,
  };
}
