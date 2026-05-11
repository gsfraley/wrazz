import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import * as filesApi from "@/api/files";
import * as draftsLib from "@/lib/drafts";

vi.mock("@/api/files");
vi.mock("@/lib/drafts");
vi.mock("@/stores/draftStore", () => ({
  useDraftStore: {
    getState: () => ({
      clearStoredDraft: vi.fn().mockResolvedValue(undefined),
      persistDraft: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock("@/stores/treeStore", () => ({
  useTreeStore: {
    getState: () => ({
      refreshDir: vi.fn().mockResolvedValue(undefined),
      revealPath: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

const mockFile = {
  path: "/foo.md",
  title: "Foo",
  tags: [],
  created_at: "2024-01-01",
  updated_at: "2024-01-01",
};

describe("documentStore", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      activePath: null,
      activeFile: null,
      draft: null,
      isDirty: false,
      status: null,
    });
    vi.clearAllMocks();
  });

  it("openFile sets activePath, activeFile, and draft from server", async () => {
    vi.mocked(filesApi.getFile).mockResolvedValue(mockFile);
    vi.mocked(filesApi.getFileContent).mockResolvedValue({ content: "hello" });
    vi.mocked(draftsLib.getDraft).mockResolvedValue(undefined);

    await useDocumentStore.getState().openFile("/foo.md");

    const state = useDocumentStore.getState();
    expect(state.activePath).toBe("/foo.md");
    expect(state.activeFile).toEqual(mockFile);
    expect(state.draft?.content).toBe("hello");
    expect(state.isDirty).toBe(false);
    expect(state.status).toBeNull();
  });

  it("openFile prefers stored draft over server content", async () => {
    vi.mocked(filesApi.getFile).mockResolvedValue(mockFile);
    vi.mocked(filesApi.getFileContent).mockResolvedValue({ content: "server" });
    vi.mocked(draftsLib.getDraft).mockResolvedValue({
      path: "/foo.md", title: "Draft Title", content: "local draft", tags: [], savedAt: Date.now(),
    });

    await useDocumentStore.getState().openFile("/foo.md");

    const state = useDocumentStore.getState();
    expect(state.draft?.content).toBe("local draft");
    expect(state.isDirty).toBe(true);
  });

  it("openFile sets error status on failure", async () => {
    vi.mocked(filesApi.getFile).mockRejectedValue(new Error("network error"));

    await useDocumentStore.getState().openFile("/foo.md");

    const state = useDocumentStore.getState();
    expect(state.status?.kind).toBe("error");
    expect(state.activePath).toBeNull();
  });

  it("closeFile clears all active state", () => {
    useDocumentStore.setState({
      activePath: "/foo.md",
      activeFile: mockFile,
      draft: { title: "t", content: "c", tags: [] },
      isDirty: true,
      status: null,
    });

    useDocumentStore.getState().closeFile();

    const state = useDocumentStore.getState();
    expect(state.activePath).toBeNull();
    expect(state.draft).toBeNull();
    expect(state.isDirty).toBe(false);
  });

  it("changeDraft marks isDirty", () => {
    useDocumentStore.setState({ activePath: "/foo.md", draft: { title: "", content: "", tags: [] } });
    useDocumentStore.getState().changeDraft({ title: "New", content: "body", tags: [] });
    expect(useDocumentStore.getState().isDirty).toBe(true);
  });
});
