import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTreeStore } from "@/stores/treeStore";
import * as filesApi from "@/api/files";

vi.mock("@/api/files");

const mockEntries = [
  { kind: "file" as const, path: "/a.md", title: null, tags: [], created_at: "", updated_at: "" },
  { kind: "dir" as const, path: "/folder/", created_at: "", updated_at: "" },
];

describe("treeStore", () => {
  beforeEach(() => {
    useTreeStore.setState({ root: [], expanded: new Set(), children: new Map() });
    vi.clearAllMocks();
  });

  it("reload populates root", async () => {
    vi.mocked(filesApi.listEntries).mockResolvedValue(mockEntries);
    await useTreeStore.getState().reload();
    expect(useTreeStore.getState().root).toEqual(mockEntries);
  });

  it("ensureExpanded fetches and stores children", async () => {
    const childEntries = [{ kind: "file" as const, path: "/folder/b.md", title: null, tags: [], created_at: "", updated_at: "" }];
    vi.mocked(filesApi.listEntries).mockResolvedValue(childEntries);
    await useTreeStore.getState().ensureExpanded("/folder/");
    const state = useTreeStore.getState();
    expect(state.expanded.has("/folder/")).toBe(true);
    expect(state.children.get("/folder/")).toEqual(childEntries);
  });

  it("toggleDir collapses already-expanded dir", async () => {
    useTreeStore.setState({ expanded: new Set(["/folder/"]) });
    await useTreeStore.getState().toggleDir("/folder/");
    expect(useTreeStore.getState().expanded.has("/folder/")).toBe(false);
  });

  it("collapseDir removes from expanded and children", () => {
    useTreeStore.setState({
      expanded: new Set(["/folder/"]),
      children: new Map([["/folder/", []]]),
    });
    useTreeStore.getState().collapseDir("/folder/");
    const state = useTreeStore.getState();
    expect(state.expanded.has("/folder/")).toBe(false);
    expect(state.children.has("/folder/")).toBe(false);
  });
});
