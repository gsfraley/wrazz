import { create } from "zustand";
import { assertNever } from "@/lib/utils";
import { logout as logoutApi } from "@/api/auth";
import type { CurrentUser } from "@/api/auth";
import type { ActiveContext } from "@/lib/plugin";
import type { ContextMenuProps, ContextMenuItem } from "@/components/ContextMenu";
import type { VerticalAnchor, HorizontalAnchor } from "@/lib/contextMenu";
import { useDocumentStore } from "@/stores/documentStore";

export type { ActiveContext };

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;
export const SIDEBAR_DEFAULT = 240;

interface UIState {
  sidebarWidth: number;
  activeCtx: ActiveContext;
  ctxMenu: ContextMenuProps | null;

  // Auth
  user: CurrentUser | null;

  // Modals
  activeModal: "profile" | "admin" | "desktop-settings" | null;

  // Inline rename trigger (set by plugin/tree ops; consumed by useFileTreeOperations)
  inlineEditPath: string | null;

  // Command palette
  paletteOpen: boolean;

  // Confirm dialog
  confirmRequest: { message: string; resolve: (ok: boolean) => void } | null;

  // Actions
  setSidebarWidth: (w: number) => void;
  setActiveCtx: (ctx: ActiveContext) => void;
  openCtxMenu: (
    e: React.MouseEvent,
    items: ContextMenuItem[],
    vertical?: VerticalAnchor,
    horizontal?: HorizontalAnchor,
  ) => void;
  closeCtxMenu: () => void;
  setUser: (user: CurrentUser | null) => void;
  openModal: (id: "profile" | "admin" | "desktop-settings") => void;
  closeModal: () => void;
  setInlineEditPath: (path: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  openConfirm: (message: string) => Promise<boolean>;
  closeConfirm: (ok: boolean) => void;
  performLogout: () => Promise<void>;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarWidth: SIDEBAR_DEFAULT,
  activeCtx: null,
  ctxMenu: null,
  user: null,
  activeModal: null,
  inlineEditPath: null,
  paletteOpen: false,
  confirmRequest: null,

  setSidebarWidth: (w) =>
    set({ sidebarWidth: Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w)) }),

  setActiveCtx: (activeCtx) => set({ activeCtx }),

  openCtxMenu: (e, items, vertical = "top-to-pointer", horizontal = "left-to-pointer") => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();

    const ctxVertical =
      vertical === "top-to-pointer"        ? { top: e.clientY + 4 } :
      vertical === "top-to-element-top"    ? { top: rect.top }      :
      vertical === "top-to-element-bottom" ? { top: rect.bottom }   :
      assertNever(vertical);

    const ctxHorizontal =
      horizontal === "left-to-pointer"        ? { left: e.clientX - 4 }                   :
      horizontal === "left-to-element-left"   ? { left: rect.left }                       :
      horizontal === "left-to-element-right"  ? { left: rect.right }                      :
      horizontal === "right-to-element-left"  ? { right: window.innerWidth - rect.left }  :
      horizontal === "right-to-element-right" ? { right: window.innerWidth - rect.right } :
      assertNever(horizontal);

    set({
      ctxMenu: {
        vertical: ctxVertical,
        horizontal: ctxHorizontal,
        items,
        onClose: () => set({ ctxMenu: null }),
      },
    });
  },

  closeCtxMenu: () => set({ ctxMenu: null }),

  setUser: (user) => set({ user }),

  openModal: (id) => set({ activeModal: id }),

  closeModal: () => set({ activeModal: null }),

  setInlineEditPath: (path) => set({ inlineEditPath: path }),

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  openConfirm: (message) =>
    new Promise<boolean>((resolve) => {
      set({ confirmRequest: { message, resolve } });
    }),

  closeConfirm: (ok) => {
    const { confirmRequest } = get();
    if (confirmRequest) {
      confirmRequest.resolve(ok);
      set({ confirmRequest: null });
    }
  },

  performLogout: async () => {
    await logoutApi();
    set({ user: null });
    useDocumentStore.getState().closeFile();
  },
}));
