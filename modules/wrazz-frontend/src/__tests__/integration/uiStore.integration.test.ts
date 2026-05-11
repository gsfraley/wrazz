import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "@/stores/uiStore";

describe("UIStore integration", () => {
  beforeEach(() => {
    useUIStore.setState({ activeCtx: null, ctxMenu: null });
  });

  it("openCtxMenu sets ctxMenu with computed position", () => {
    const mockEvent = {
      preventDefault: () => {},
      stopPropagation: () => {},
      clientX: 100,
      clientY: 200,
      currentTarget: {
        getBoundingClientRect: () => ({ top: 50, bottom: 80, left: 20, right: 100 }),
      },
    } as unknown as React.MouseEvent;

    useUIStore.getState().openCtxMenu(mockEvent, [
      { type: "item", label: "Test", onClick: () => {} },
    ]);

    const menu = useUIStore.getState().ctxMenu;
    expect(menu).not.toBeNull();
    expect(menu?.items).toHaveLength(1);
    expect(menu?.items[0]).toMatchObject({ type: "item", label: "Test" });
  });

  it("closeCtxMenu clears the menu", () => {
    useUIStore.setState({
      ctxMenu: {
        vertical: { top: 100 },
        horizontal: { left: 100 },
        items: [],
        onClose: () => {},
      },
    });

    useUIStore.getState().closeCtxMenu();
    expect(useUIStore.getState().ctxMenu).toBeNull();
  });

  it("setActiveCtx updates the context", () => {
    useUIStore.getState().setActiveCtx("editor");
    expect(useUIStore.getState().activeCtx).toBe("editor");

    useUIStore.getState().setActiveCtx("fileTree");
    expect(useUIStore.getState().activeCtx).toBe("fileTree");

    useUIStore.getState().setActiveCtx(null);
    expect(useUIStore.getState().activeCtx).toBeNull();
  });
});
