import { createContext, useContext } from "react";
import type { ActionContext } from "./actions";

interface ActiveContextValue {
  ctx: ActionContext | null;
  setCtx: (c: ActionContext | null) => void;
}

export const ActiveContextCtx = createContext<ActiveContextValue>({
  ctx: null,
  setCtx: () => {},
});

export function useActiveContext() {
  return useContext(ActiveContextCtx);
}
