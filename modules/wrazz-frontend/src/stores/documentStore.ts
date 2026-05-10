import { create } from "zustand";
import { getFile, getFileContent, updateFile } from "@/api/files";
import type { FileEntry } from "@/api/files";
import { getDraft } from "@/lib/drafts";
import { useDraftStore } from "@/stores/draftStore";
import { useTreeStore } from "@/stores/treeStore";
import type { Draft, AppStatus } from "@/types";

interface DocumentState {
  activePath: string | null;
  activeFile: FileEntry | null;
  draft: Draft | null;
  isDirty: boolean;
  status: AppStatus | null;

  openFile: (path: string) => Promise<void>;
  saveFile: () => Promise<void>;
  discardChanges: () => Promise<void>;
  changeDraft: (draft: Draft) => void;
  closeFile: () => void;
  setStatus: (status: AppStatus | null) => void;
}

// Debounce timer lives outside Zustand state — no re-renders needed for the timer itself.
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function parentDir(path: string): string {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = clean.split("/");
  parts.pop();
  const joined = parts.join("/");
  return joined === "" ? "/" : joined + "/";
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  activePath: null,
  activeFile: null,
  draft: null,
  isDirty: false,
  status: null,

  openFile: async (path) => {
    try {
      const [file, { content }, stored] = await Promise.all([
        getFile(path),
        getFileContent(path),
        getDraft(path),
      ]);
      if (stored) {
        set({
          activePath: path,
          activeFile: file,
          draft: { title: stored.title, content: stored.content, tags: stored.tags },
          isDirty: true,
          status: null,
        });
      } else {
        set({
          activePath: path,
          activeFile: file,
          draft: { title: file.title ?? "", content, tags: file.tags },
          isDirty: false,
          status: null,
        });
      }
    } catch {
      set({ status: { kind: "error", message: "Could not load file." } });
    }
  },

  saveFile: async () => {
    const { activePath, draft } = get();
    if (!activePath || !draft) return;
    try {
      const updated = await updateFile(activePath, draft.title.trim() || null, draft.tags, draft.content);
      const draftStore = useDraftStore.getState();
      await draftStore.clearStoredDraft(activePath);
      set({ activeFile: updated, isDirty: false, status: { kind: "ok", message: "Saved" } });
      // Refresh the parent directory in the tree.
      await useTreeStore.getState().refreshDir(parentDir(activePath));
    } catch {
      set({ status: { kind: "error", message: "Save failed." } });
    }
  },

  discardChanges: async () => {
    const { activePath } = get();
    if (!activePath) return;
    await useDraftStore.getState().clearStoredDraft(activePath);
    await get().openFile(activePath);
  },

  changeDraft: (draft) => {
    set({ draft, isDirty: true });
    const { activePath } = get();
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (!activePath) return;
      useDraftStore.getState().persistDraft(activePath, draft.title, draft.content, draft.tags);
    }, 500);
  },

  closeFile: () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    set({ activePath: null, activeFile: null, draft: null, isDirty: false, status: null });
  },

  setStatus: (status) => set({ status }),
}));
