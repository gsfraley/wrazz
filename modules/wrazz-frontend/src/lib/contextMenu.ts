import { useUIStore } from "@/stores/uiStore";
import type { ContextMenuItem } from "@/components/ContextMenu";

export type VerticalAnchor =
  | "top-to-pointer"
  | "top-to-element-top"
  | "top-to-element-bottom";

export type HorizontalAnchor =
  | "left-to-pointer"
  | "left-to-element-left"
  | "left-to-element-right"
  | "right-to-element-left"
  | "right-to-element-right";

export type OpenCtxFn = (
  e: React.MouseEvent,
  items: ContextMenuItem[],
  vertical?: VerticalAnchor,
  horizontal?: HorizontalAnchor,
) => void;

export function useContextMenu(): OpenCtxFn {
  return useUIStore((s) => s.openCtxMenu);
}
