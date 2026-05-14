import { create } from "zustand";
import { listEntries } from "@/api/files";
import type { Entry } from "@/api/files";
import { useWorkspaceStore } from "@/stores/workspaceStore";

function activeWorkspaceId(): string | null {
  return useWorkspaceStore.getState().activeWorkspaceId;
}

interface TreeState {
  root: Entry[];
  expanded: Set<string>;
  children: Map<string, Entry[]>;

  reload: () => Promise<void>;
  refreshDir: (dirPath: string) => Promise<void>;
  ensureExpanded: (dirPath: string) => Promise<void>;
  toggleDir: (dirPath: string) => Promise<void>;
  collapseDir: (dirPath: string) => void;
  revealPath: (filePath: string) => Promise<void>;
}

export const useTreeStore = create<TreeState>((set, get) => ({
  root: [],
  expanded: new Set(),
  children: new Map(),

  reload: async () => {
    const wsId = activeWorkspaceId();
    if (!wsId) { set({ root: [], children: new Map() }); return; }
    const rootEntries = await listEntries(wsId, "/").catch(() => []);
    const { expanded } = get();
    const refreshed = new Map<string, Entry[]>();
    await Promise.all(
      [...expanded].map(async (p) => {
        const entries = await listEntries(wsId, p).catch(() => []);
        refreshed.set(p, entries);
      }),
    );
    set({ root: rootEntries, children: refreshed });
  },

  refreshDir: async (dirPath) => {
    const wsId = activeWorkspaceId();
    if (!wsId) return;
    const entries = await listEntries(wsId, dirPath).catch(() => []);
    if (dirPath === "/") {
      set({ root: entries });
    } else {
      set((s) => ({ children: new Map(s.children).set(dirPath, entries) }));
    }
  },

  ensureExpanded: async (dirPath) => {
    const wsId = activeWorkspaceId();
    if (!wsId) return;
    const { expanded } = get();
    if (expanded.has(dirPath)) return;
    const entries = await listEntries(wsId, dirPath).catch(() => []);
    set((s) => ({
      expanded: new Set([...s.expanded, dirPath]),
      children: new Map(s.children).set(dirPath, entries),
    }));
  },

  toggleDir: async (dirPath) => {
    const { expanded } = get();
    if (expanded.has(dirPath)) {
      set((s) => {
        const next = new Set(s.expanded);
        next.delete(dirPath);
        return { expanded: next };
      });
    } else {
      await get().ensureExpanded(dirPath);
    }
  },

  collapseDir: (dirPath) => {
    set((s) => {
      const nextExp = new Set(s.expanded);
      nextExp.delete(dirPath);
      const nextCh = new Map(s.children);
      nextCh.delete(dirPath);
      return { expanded: nextExp, children: nextCh };
    });
  },

  revealPath: async (filePath) => {
    const parts = filePath.split("/").filter(Boolean);
    parts.pop();
    const ancestors: string[] = [];
    for (let i = 1; i <= parts.length; i++) {
      ancestors.push("/" + parts.slice(0, i).join("/") + "/");
    }
    for (const dir of ancestors) {
      await get().ensureExpanded(dir);
    }
  },
}));
