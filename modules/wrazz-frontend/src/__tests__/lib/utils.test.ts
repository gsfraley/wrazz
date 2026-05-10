import { describe, it, expect } from "vitest";
import { pathToDisplayTitle, cx, assertNever } from "@/lib/utils";

describe("pathToDisplayTitle", () => {
  it("strips .md extension", () => {
    expect(pathToDisplayTitle("/notes/hello.md")).toBe("hello");
  });

  it("replaces dashes and underscores with spaces", () => {
    expect(pathToDisplayTitle("/foo/my-note_file.md")).toBe("my note file");
  });

  it("handles root files", () => {
    expect(pathToDisplayTitle("/hello.md")).toBe("hello");
  });

  it("handles paths without extension", () => {
    expect(pathToDisplayTitle("/foo/bar")).toBe("bar");
  });
});

describe("cx", () => {
  it("joins truthy class names", () => {
    expect(cx("a", "b", "c")).toBe("a b c");
  });

  it("filters falsy values", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
  });

  it("returns empty string for all falsy", () => {
    expect(cx(false, null, undefined)).toBe("");
  });
});

describe("assertNever", () => {
  it("throws for any value passed", () => {
    expect(() => assertNever("oops" as never)).toThrow();
  });
});
