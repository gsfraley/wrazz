import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import { useDraftStore } from "@/stores/draftStore";
import { useTreeStore } from "@/stores/treeStore";
import * as filesApi from "@/api/files";
import * as draftsLib from "@/lib/drafts";

vi.mock("@/api/files");
vi.mock("@/lib/drafts");

const mockFile = {
  path: "/note.md",
  title: "My Note",
  tags: ["journal"],
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

describe("Document store integration", () => {
  beforeEach(() => {
    useDocumentStore.setState({ activePath: null, activeFile: null, draft: null, isDirty: false, status: null });
    useDraftStore.setState({ draftPaths: new Set() });
    useTreeStore.setState({ root: [], expanded: new Set(), children: new Map() });
    vi.clearAllMocks();
  });

  it("open → change → save clears dirty flag and removes draft path", async () => {
    vi.mocked(filesApi.getFile).mockResolvedValue(mockFile);
    vi.mocked(filesApi.getFileContent).mockResolvedValue({ content: "original" });
    vi.mocked(filesApi.updateFile).mockResolvedValue({ ...mockFile, title: "Edited" });
    vi.mocked(draftsLib.getDraft).mockResolvedValue(undefined);
    vi.mocked(draftsLib.saveDraft).mockResolvedValue(undefined);
    vi.mocked(draftsLib.clearDraft).mockResolvedValue(undefined);
    vi.mocked(filesApi.listEntries).mockResolvedValue([]);

    // Open the file
    await useDocumentStore.getState().openFile("/note.md");
    expect(useDocumentStore.getState().isDirty).toBe(false);
    expect(useDocumentStore.getState().draft?.content).toBe("original");

    // Change it
    useDocumentStore.getState().changeDraft({ title: "Edited", content: "new body", tags: [] });
    expect(useDocumentStore.getState().isDirty).toBe(true);

    // Manually add to draftPaths (simulating the debounce firing)
    useDraftStore.getState().addDraftPath("/note.md");
    expect(useDraftStore.getState().draftPaths.has("/note.md")).toBe(true);

    // Save
    await useDocumentStore.getState().saveFile();
    expect(useDocumentStore.getState().isDirty).toBe(false);
    expect(useDocumentStore.getState().status?.kind).toBe("ok");
    expect(useDraftStore.getState().draftPaths.has("/note.md")).toBe(false);
  });

  it("open with stored draft restores dirty state", async () => {
    vi.mocked(filesApi.getFile).mockResolvedValue(mockFile);
    vi.mocked(filesApi.getFileContent).mockResolvedValue({ content: "server version" });
    vi.mocked(draftsLib.getDraft).mockResolvedValue({
      path: "/note.md",
      title: "Local Title",
      content: "local draft content",
      tags: ["local"],
      savedAt: Date.now(),
    });

    await useDocumentStore.getState().openFile("/note.md");

    const state = useDocumentStore.getState();
    expect(state.isDirty).toBe(true);
    expect(state.draft?.content).toBe("local draft content");
    expect(state.draft?.title).toBe("Local Title");
  });

  it("discard clears draft and reloads from server", async () => {
    vi.mocked(filesApi.getFile).mockResolvedValue(mockFile);
    vi.mocked(filesApi.getFileContent).mockResolvedValue({ content: "fresh" });
    vi.mocked(draftsLib.getDraft).mockResolvedValue(undefined);
    vi.mocked(draftsLib.clearDraft).mockResolvedValue(undefined);

    useDocumentStore.setState({
      activePath: "/note.md",
      draft: { title: "stale", content: "stale", tags: [] },
      isDirty: true,
    });

    await useDocumentStore.getState().discardChanges();

    expect(useDocumentStore.getState().isDirty).toBe(false);
    expect(useDocumentStore.getState().draft?.content).toBe("fresh");
    expect(draftsLib.clearDraft).toHaveBeenCalledWith("/note.md");
  });

  it("closeFile resets all document state", async () => {
    useDocumentStore.setState({
      activePath: "/note.md",
      activeFile: mockFile,
      draft: { title: "t", content: "c", tags: [] },
      isDirty: true,
    });

    useDocumentStore.getState().closeFile();

    const state = useDocumentStore.getState();
    expect(state.activePath).toBeNull();
    expect(state.activeFile).toBeNull();
    expect(state.draft).toBeNull();
    expect(state.isDirty).toBe(false);
  });
});
