import type { ComponentType } from "react";

// ── Tree entry handles ────────────────────────────────────────────────────────

export interface CreateFileOpts {
  title?: string;
  content?: string;
}

export interface FileEntry {
  kind: "file";
  path: string;
  title: string | null;
  hasDraft: boolean;
  open(): Promise<void>;
  delete(): Promise<void>;
  move(into: DirEntry | RootEntry, name?: string): Promise<void>;
}

export interface DirEntry {
  kind: "dir";
  path: string;
  isExpanded: boolean;
  children: TreeEntry[] | null;
  newFile(opts?: CreateFileOpts): Promise<void>;
  newDir(): Promise<void>;
  createFile(name: string, opts?: CreateFileOpts): Promise<void>;
  createDir(name: string): Promise<void>;
  delete(): Promise<void>;
  move(into: DirEntry | RootEntry, name?: string): Promise<void>;
}

export interface RootEntry {
  kind: "root";
  path: "/";
  children: TreeEntry[] | null;
  newFile(opts?: CreateFileOpts): Promise<void>;
  newDir(): Promise<void>;
  createFile(name: string, opts?: CreateFileOpts): Promise<void>;
  createDir(name: string): Promise<void>;
}

export type TreeEntry = FileEntry | DirEntry | RootEntry;

// ── Open file handle ──────────────────────────────────────────────────────────

export interface OpenFile {
  path: string;
  title: string | null;
  isDirty: boolean;
  save(): Promise<void>;
  discard(): Promise<void>;
  close(): void;
}

// ── Context ───────────────────────────────────────────────────────────────────

export type ActiveContext = "fileTree" | "editor" | null;

export interface FileTreeContext {
  root: RootEntry;
  selected: TreeEntry | null;
}

export interface EditorContext {
  files: OpenFile[];
  activeFile: OpenFile | null;
}

export interface UserSnapshot {
  id: string;
  displayName: string;
  email: string | null;
  isAdmin: boolean;
}

export interface Context {
  active: ActiveContext;
  fileTree: FileTreeContext;
  editor: EditorContext;
  user: UserSnapshot;
  notify(message: string, kind?: "ok" | "error"): void;
  confirm(message: string): Promise<boolean>;
  openModal(id: "profile" | "admin"): void;
  openPalette(): void;
  logout(): Promise<void>;
}

// ── Result ────────────────────────────────────────────────────────────────────

export type Result = void | Promise<void>;

// ── Hooks ─────────────────────────────────────────────────────────────────────

export type Hook =
  | {
      type: "keyboard";
      // "Mod-s", "Mod-Shift-z", etc. Mod = Cmd on Mac, Ctrl elsewhere.
      shortcut: string;
      // Optional label links this shortcut to a matching command hook for hint display.
      label?: string;
      run: (ctx: Context) => Result;
    }
  | {
      type: "command";
      label: string;
      keywords?: string[];
      icon?: ComponentType<{ size?: number }>;
      // When false, only shows in the palette when the user is actively searching.
      defaultVisible?: boolean;
      // Display group for the no-query palette view (e.g. "CURRENT FILE", "WORKSPACE").
      group?: string;
      present: (ctx: Context) => boolean;
      run: (ctx: Context) => Result;
    }
  | {
      type: "contextMenu";
      label: string;
      danger?: boolean;
      icon?: ComponentType<{ size?: number }>;
      // Items sharing a group are kept together; separators are inserted between groups.
      group?: string;
      present: (ctx: Context, target: TreeEntry) => boolean;
      run: (ctx: Context, target: TreeEntry) => Result;
    };

// ── Plugin ────────────────────────────────────────────────────────────────────

export interface Plugin {
  id: string;
  hooks: () => Hook[];
}
