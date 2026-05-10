import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useDocumentStore } from "@/stores/documentStore";
import StatusBar from "@/components/StatusBar";

describe("StatusBar integration", () => {
  beforeEach(() => {
    useDocumentStore.setState({ activePath: null, activeFile: null, draft: null, isDirty: false, status: null });
  });

  it("shows nothing when no file open", () => {
    render(<StatusBar />);
    // Both spans should be empty/blank
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent?.trim()).toBe("");
  });

  it("shows file title from draft", () => {
    useDocumentStore.setState({
      activePath: "/notes/hello-world.md",
      draft: { title: "Hello World", content: "", tags: [] },
    });
    render(<StatusBar />);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("falls back to path-derived title when draft title is empty", () => {
    useDocumentStore.setState({
      activePath: "/notes/my-note.md",
      draft: { title: "", content: "", tags: [] },
    });
    render(<StatusBar />);
    expect(screen.getByText("my note")).toBeInTheDocument();
  });

  it("shows error status message", () => {
    useDocumentStore.setState({
      status: { kind: "error", message: "Save failed." },
    });
    render(<StatusBar />);
    expect(screen.getByText("Save failed.")).toBeInTheDocument();
  });

  it("shows ok status message", () => {
    useDocumentStore.setState({
      status: { kind: "ok", message: "Saved" },
    });
    render(<StatusBar />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});
