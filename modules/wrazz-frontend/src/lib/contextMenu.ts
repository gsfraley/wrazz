import { createContext, useContext } from "react";
import type { MouseEvent } from "react";
import type { ContextMenuItem } from "../components/ContextMenu";

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
  e: MouseEvent,
  items: ContextMenuItem[],
  vertical?: VerticalAnchor,
  horizontal?: HorizontalAnchor,
) => void;

export const ContextMenuCtx = createContext<OpenCtxFn>(() => {});

export function useContextMenu(): OpenCtxFn {
  return useContext(ContextMenuCtx);
}
