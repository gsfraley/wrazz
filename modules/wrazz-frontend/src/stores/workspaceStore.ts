import { create } from "zustand";
import {
  listWorkspaces,
  createWorkspace as apiCreate,
  renameWorkspace as apiRename,
  deleteWorkspace as apiDelete,
  type WorkspaceSummary,
} from "@/api/workspaces";
import { useUIStore } from "@/stores/uiStore";
import { isDesktop } from "@/lib/api";

function storageKey(userId: string) {
  return `wrazz.active_workspace.${userId}`;
}

function currentUserId(): string | null {
  if (isDesktop()) return "__desktop__";
  return useUIStore.getState().user?.id ?? null;
}

interface WorkspaceState {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;

  load: () => Promise<void>;
  setActive: (id: string) => void;
  createWorkspace: (name: string) => Promise<WorkspaceSummary>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,

  load: async () => {
    const workspaces = await listWorkspaces();
    set({ workspaces });

    if (workspaces.length === 0) return;

    const userId = currentUserId();
    const stored = userId ? localStorage.getItem(storageKey(userId)) : null;
    const valid = stored ? workspaces.find((w) => w.id === stored) : null;
    const active = valid ?? workspaces[0];

    set({ activeWorkspaceId: active.id });
    if (userId) localStorage.setItem(storageKey(userId), active.id);
  },

  setActive: (id) => {
    set({ activeWorkspaceId: id });
    const userId = currentUserId();
    if (userId) localStorage.setItem(storageKey(userId), id);
    // Reload tree and close current doc for the new workspace.
    // Imported lazily to avoid circular deps between stores.
    void import("@/stores/treeStore").then(({ useTreeStore }) => {
      void useTreeStore.getState().reload();
    });
    void import("@/stores/documentStore").then(({ useDocumentStore }) => {
      useDocumentStore.getState().closeFile();
    });
  },

  createWorkspace: async (name) => {
    const ws = await apiCreate(name);
    set((s) => ({ workspaces: [...s.workspaces, ws] }));
    return ws;
  },

  renameWorkspace: async (id, name) => {
    const updated = await apiRename(id, name);
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? updated : w)),
    }));
  },

  deleteWorkspace: async (id) => {
    await apiDelete(id);
    const { workspaces, activeWorkspaceId } = get();
    const remaining = workspaces.filter((w) => w.id !== id);
    set({ workspaces: remaining });
    if (activeWorkspaceId === id) {
      if (remaining.length > 0) get().setActive(remaining[0].id);
      else {
        set({ activeWorkspaceId: null });
        void import("@/stores/treeStore").then(({ useTreeStore }) => {
          void useTreeStore.getState().reload();
        });
        void import("@/stores/documentStore").then(({ useDocumentStore }) => {
          useDocumentStore.getState().closeFile();
        });
      }
    }
  },
}));
