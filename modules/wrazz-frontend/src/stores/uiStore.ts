import { create } from "zustand";
import { assertNever } from "@/lib/utils";
import type { ActionContext } from "@/lib/actions";
import type { ContextMenuProps, ContextMenuItem } from "@/components/ContextMenu";
import type { VerticalAnchor, HorizontalAnchor } from "@/lib/contextMenu";

interface UIState {
  sidebarWidth: number;
  activeCtx: ActionContext | null;
  ctxMenu: ContextMenuProps | null;

  setSidebarWidth: (w: number) => void;
  setActiveCtx: (ctx: ActionContext | null) => void;
  openCtxMenu: (
    e: React.MouseEvent,
    items: ContextMenuItem[],
    vertical?: VerticalAnchor,
    horizontal?: HorizontalAnchor,
  ) => void;
  closeCtxMenu: () => void;
}

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 520;
export const SIDEBAR_DEFAULT = 240;

export const useUIStore = create<UIState>((set) => ({
  sidebarWidth: SIDEBAR_DEFAULT,
  activeCtx: null,
  ctxMenu: null,

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
}));
