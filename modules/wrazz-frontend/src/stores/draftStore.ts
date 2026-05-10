import { create } from "zustand";
import { getAllDraftPaths, clearDraft, saveDraft } from "@/lib/drafts";

interface DraftState {
  draftPaths: Set<string>;
  initializeDraftPaths: () => Promise<void>;
  addDraftPath: (path: string) => void;
  removeDraftPath: (path: string) => void;
  persistDraft: (path: string, title: string, content: string, tags: string[]) => Promise<void>;
  clearStoredDraft: (path: string) => Promise<void>;
}

export const useDraftStore = create<DraftState>((set) => ({
  draftPaths: new Set(),

  initializeDraftPaths: async () => {
    const paths = await getAllDraftPaths().catch(() => []);
    set({ draftPaths: new Set(paths) });
  },

  addDraftPath: (path) =>
    set((s) => s.draftPaths.has(path) ? s : { draftPaths: new Set([...s.draftPaths, path]) }),

  removeDraftPath: (path) =>
    set((s) => {
      const next = new Set(s.draftPaths);
      next.delete(path);
      return { draftPaths: next };
    }),

  persistDraft: async (path, title, content, tags) => {
    await saveDraft(path, title, content, tags).catch(() => {});
    set((s) => s.draftPaths.has(path) ? s : { draftPaths: new Set([...s.draftPaths, path]) });
  },

  clearStoredDraft: async (path) => {
    await clearDraft(path).catch(() => {});
    set((s) => {
      const next = new Set(s.draftPaths);
      next.delete(path);
      return { draftPaths: next };
    });
  },
}));
