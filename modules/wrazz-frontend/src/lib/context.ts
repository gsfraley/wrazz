import { useUIStore } from "@/stores/uiStore";

export function useActiveContext() {
  const ctx = useUIStore((s) => s.activeCtx);
  const setCtx = useUIStore((s) => s.setActiveCtx);
  return { ctx, setCtx };
}
