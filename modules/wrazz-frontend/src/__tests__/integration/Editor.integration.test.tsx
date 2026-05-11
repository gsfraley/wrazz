import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useDocumentStore } from "@/stores/documentStore";
import Editor from "@/components/Editor";

// Mock wrazz-editor since it's a complex DOM component
vi.mock("wrazz-editor", () => ({
  WrazzEditor: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <textarea
      data-testid="wrazz-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: () => ({ setActiveCtx: vi.fn() }),
}));

const mockFile = {
  path: "/test.md",
  title: "Test File",
  tags: [],
  created_at: "2024-01-01",
  updated_at: "2024-01-01",
};

describe("Editor component", () => {
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

  it("shows empty state when no file selected", () => {
    render(<Editor />);
    expect(screen.getByText(/select a file/i)).toBeInTheDocument();
  });

  it("shows editor when file and draft are set", () => {
    useDocumentStore.setState({
      activePath: "/test.md",
      activeFile: mockFile,
      draft: { title: "Test File", content: "Hello world", tags: [] },
      isDirty: false,
    });

    render(<Editor />);

    expect(screen.getByDisplayValue("Test File")).toBeInTheDocument(); // title input
    expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument(); // editor
  });

  it("shows unsaved indicator when isDirty", () => {
    useDocumentStore.setState({
      activePath: "/test.md",
      activeFile: mockFile,
      draft: { title: "Test", content: "body", tags: [] },
      isDirty: true,
    });

    render(<Editor />);
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument();
  });

  it("calls changeDraft when title changes", () => {
    useDocumentStore.setState({
      activePath: "/test.md",
      activeFile: mockFile,
      draft: { title: "Old", content: "body", tags: [] },
    });

    const spy = vi.spyOn(useDocumentStore.getState(), "changeDraft");

    render(<Editor />);
    const titleInput = screen.getByDisplayValue("Old");
    fireEvent.change(titleInput, { target: { value: "New" } });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ title: "New" }));
  });
});
