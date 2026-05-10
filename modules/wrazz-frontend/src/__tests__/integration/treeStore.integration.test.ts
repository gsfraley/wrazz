import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTreeStore } from "@/stores/treeStore";
import * as filesApi from "@/api/files";

vi.mock("@/api/files");

const rootEntries = [
  { kind: "file" as const, path: "/readme.md", title: "Readme", tags: [], created_at: "", updated_at: "" },
  { kind: "dir" as const, path: "/journal/", created_at: "", updated_at: "" },
];

const journalEntries = [
  { kind: "file" as const, path: "/journal/day1.md", title: "Day 1", tags: [], created_at: "", updated_at: "" },
  { kind: "file" as const, path: "/journal/day2.md", title: "Day 2", tags: [], created_at: "", updated_at: "" },
];

describe("Tree store integration", () => {
  beforeEach(() => {
    useTreeStore.setState({ root: [], expanded: new Set(), children: new Map() });
    vi.clearAllMocks();
  });

  it("reload fetches root and re-fetches expanded dirs", async () => {
    vi.mocked(filesApi.listEntries).mockImplementation(async (path = "/") => {
      if (path === "/") return rootEntries;
      if (path === "/journal/") return journalEntries;
      return [];
    });

    // Pre-expand journal/
    useTreeStore.setState({ expanded: new Set(["/journal/"]) });

    await useTreeStore.getState().reload();

    const state = useTreeStore.getState();
    expect(state.root).toEqual(rootEntries);
    expect(state.children.get("/journal/")).toEqual(journalEntries);
  });

  it("ensureExpanded only fetches once for same dir", async () => {
    vi.mocked(filesApi.listEntries).mockResolvedValue(journalEntries);

    await useTreeStore.getState().ensureExpanded("/journal/");
    await useTreeStore.getState().ensureExpanded("/journal/"); // second call should be a no-op

    expect(filesApi.listEntries).toHaveBeenCalledTimes(1);
  });

  it("toggleDir expands then collapses", async () => {
    vi.mocked(filesApi.listEntries).mockResolvedValue(journalEntries);

    // Toggle open
    await useTreeStore.getState().toggleDir("/journal/");
    expect(useTreeStore.getState().expanded.has("/journal/")).toBe(true);

    // Toggle closed
    await useTreeStore.getState().toggleDir("/journal/");
    expect(useTreeStore.getState().expanded.has("/journal/")).toBe(false);
  });

  it("refreshDir updates root entries", async () => {
    const newRoot = [{ kind: "file" as const, path: "/new.md", title: null, tags: [], created_at: "", updated_at: "" }];
    vi.mocked(filesApi.listEntries).mockResolvedValue(newRoot);

    await useTreeStore.getState().refreshDir("/");

    expect(useTreeStore.getState().root).toEqual(newRoot);
  });

  it("collapseDir removes expansion state and children", () => {
    useTreeStore.setState({
      expanded: new Set(["/journal/"]),
      children: new Map([["/journal/", journalEntries]]),
    });

    useTreeStore.getState().collapseDir("/journal/");

    const state = useTreeStore.getState();
    expect(state.expanded.has("/journal/")).toBe(false);
    expect(state.children.has("/journal/")).toBe(false);
  });
});
