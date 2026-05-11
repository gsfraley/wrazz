import type {
  Context,
  FileEntry,
  DirEntry,
  RootEntry,
  TreeEntry,
  OpenFile,
} from "@/lib/plugin";
import { useDocumentStore } from "@/stores/documentStore";
import { useTreeStore } from "@/stores/treeStore";
import { useDraftStore } from "@/stores/draftStore";
import { useUIStore } from "@/stores/uiStore";
import { ApiError } from "@/lib/apiError";
import * as filesApi from "@/api/files";
import type { Entry } from "@/api/files";

// ── Path helpers ──────────────────────────────────────────────────────────────

function parentDir(path: string): string {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = clean.split("/");
  parts.pop();
  const joined = parts.join("/");
  return joined === "" ? "/" : joined + "/";
}

function entryName(path: string): string {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  return clean.split("/").pop() ?? path;
}

// ── Unique-name retry ─────────────────────────────────────────────────────────

async function tryUniqueName(
  create: (name: string) => Promise<void>,
  base: string,
  ext: string,
): Promise<void> {
  for (let i = 0; i <= 9; i++) {
    const name = i === 0 ? `${base}${ext}` : `${base}-${i + 1}${ext}`;
    try {
      await create(name);
      return;
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) continue;
      throw err;
    }
  }
  throw new Error(`Could not find a unique name for ${base}${ext}`);
}

// ── Entry builders ────────────────────────────────────────────────────────────

function buildFileEntry(raw: Entry & { kind: "file" }, draftPaths: Set<string>): FileEntry {
  return {
    kind: "file",
    path: raw.path,
    title: raw.title,
    hasDraft: draftPaths.has(raw.path),

    async open() {
      await useDocumentStore.getState().openFile(raw.path);
    },

    async delete() {
      await filesApi.deleteEntry(raw.path);
      await useTreeStore.getState().refreshDir(parentDir(raw.path));
      const { activePath, closeFile } = useDocumentStore.getState();
      if (activePath === raw.path) closeFile();
    },

    async move(into, name) {
      const newName = name ?? entryName(raw.path);
      const prefix = into.path === "/" ? "" : into.path.replace(/\/$/, "");
      const newPath = `${prefix}/${newName}`;
      await filesApi.moveEntry(raw.path, newPath);
      const srcParent = parentDir(raw.path);
      await useTreeStore.getState().refreshDir(srcParent);
      if (into.path !== srcParent) await useTreeStore.getState().refreshDir(into.path);
      const { activePath, openFile } = useDocumentStore.getState();
      if (activePath === raw.path) await openFile(newPath);
    },
  };
}

function buildChildren(
  rawChildren: Entry[] | undefined,
  treeState: ReturnType<typeof useTreeStore.getState>,
  draftPaths: Set<string>,
): TreeEntry[] | null {
  if (!rawChildren) return null;
  return rawChildren.map((c) => {
    if (c.kind === "file") return buildFileEntry(c, draftPaths);
    return buildDirEntry(c, treeState, draftPaths);
  });
}

function buildDirEntry(
  raw: Entry & { kind: "dir" },
  treeState: ReturnType<typeof useTreeStore.getState>,
  draftPaths: Set<string>,
): DirEntry {
  const rawChildren = treeState.children.get(raw.path);
  const children = buildChildren(rawChildren, treeState, draftPaths);

  return {
    kind: "dir",
    path: raw.path,
    isExpanded: treeState.expanded.has(raw.path),
    children,

    async newFile(opts) {
      if (!treeState.expanded.has(raw.path)) await useTreeStore.getState().ensureExpanded(raw.path);
      await tryUniqueName(
        async (name) => {
          const prefix = raw.path.replace(/\/$/, "");
          const path = `${prefix}/${name}`;
          await filesApi.createFile(path, opts?.title ?? null, [], opts?.content ?? "");
          await useTreeStore.getState().refreshDir(raw.path);
          useUIStore.getState().setInlineEditPath(path);
          await useDocumentStore.getState().openFile(path);
        },
        "untitled",
        ".md",
      );
    },

    async newDir() {
      if (!treeState.expanded.has(raw.path)) await useTreeStore.getState().ensureExpanded(raw.path);
      await tryUniqueName(
        async (name) => {
          const prefix = raw.path.replace(/\/$/, "");
          const path = `${prefix}/${name}/`;
          await filesApi.createDir(path);
          await useTreeStore.getState().refreshDir(raw.path);
          useUIStore.getState().setInlineEditPath(path);
        },
        "new-folder",
        "",
      );
    },

    async createFile(name, opts) {
      const prefix = raw.path.replace(/\/$/, "");
      const path = `${prefix}/${name}`;
      await filesApi.createFile(path, opts?.title ?? null, [], opts?.content ?? "");
      await useTreeStore.getState().refreshDir(raw.path);
    },

    async createDir(name) {
      const prefix = raw.path.replace(/\/$/, "");
      const path = `${prefix}/${name}/`;
      await filesApi.createDir(path);
      await useTreeStore.getState().refreshDir(raw.path);
    },

    async delete() {
      await filesApi.deleteEntry(raw.path);
      useTreeStore.getState().collapseDir(raw.path);
      await useTreeStore.getState().refreshDir(parentDir(raw.path));
      const { activePath, closeFile } = useDocumentStore.getState();
      if (activePath?.startsWith(raw.path)) closeFile();
    },

    async move(into, name) {
      const newName = name ?? entryName(raw.path);
      const prefix = into.path === "/" ? "" : into.path.replace(/\/$/, "");
      const newPath = `${prefix}/${newName}/`;
      await filesApi.moveEntry(raw.path, newPath);
      useTreeStore.getState().collapseDir(raw.path);
      const srcParent = parentDir(raw.path);
      await useTreeStore.getState().refreshDir(srcParent);
      if (into.path !== srcParent) await useTreeStore.getState().refreshDir(into.path);
    },
  };
}

function buildRootEntry(
  treeState: ReturnType<typeof useTreeStore.getState>,
  draftPaths: Set<string>,
): RootEntry {
  const children = buildChildren(treeState.root, treeState, draftPaths);

  return {
    kind: "root",
    path: "/",
    children,

    async newFile(opts) {
      await tryUniqueName(
        async (name) => {
          const path = `/${name}`;
          await filesApi.createFile(path, opts?.title ?? null, [], opts?.content ?? "");
          await useTreeStore.getState().refreshDir("/");
          useUIStore.getState().setInlineEditPath(path);
          await useDocumentStore.getState().openFile(path);
        },
        "untitled",
        ".md",
      );
    },

    async newDir() {
      await tryUniqueName(
        async (name) => {
          const path = `/${name}/`;
          await filesApi.createDir(path);
          await useTreeStore.getState().refreshDir("/");
          useUIStore.getState().setInlineEditPath(path);
        },
        "new-folder",
        "",
      );
    },

    async createFile(name, opts) {
      const path = `/${name}`;
      await filesApi.createFile(path, opts?.title ?? null, [], opts?.content ?? "");
      await useTreeStore.getState().refreshDir("/");
    },

    async createDir(name) {
      const path = `/${name}/`;
      await filesApi.createDir(path);
      await useTreeStore.getState().refreshDir("/");
    },
  };
}

// ── buildTargetForPath ────────────────────────────────────────────────────────
// Builds a TreeEntry handle for any path without needing the full tree traversal.
// Used by FileTree when building context menu targets at right-click time.

export function buildTargetForPath(path: string): TreeEntry {
  const treeState = useTreeStore.getState();
  const draftPaths = useDraftStore.getState().draftPaths;

  if (path === "/") {
    return buildRootEntry(treeState, draftPaths);
  }

  if (path.endsWith("/")) {
    // Synthetic Entry for a dir we know by path
    const raw = { kind: "dir" as const, path, created_at: "", updated_at: "" };
    return buildDirEntry(raw, treeState, draftPaths);
  }

  const raw = {
    kind: "file" as const,
    path,
    title: null as string | null,
    tags: [] as string[],
    created_at: "",
    updated_at: "",
  };
  return buildFileEntry(raw, draftPaths);
}

// ── buildContext ──────────────────────────────────────────────────────────────

export function buildContext(): Context | null {
  const { user, activeCtx, openModal, openConfirm, performLogout, setPaletteOpen } = useUIStore.getState();
  if (!user) return null;

  const treeState = useTreeStore.getState();
  const docState  = useDocumentStore.getState();
  const draftPaths = useDraftStore.getState().draftPaths;

  const root = buildRootEntry(treeState, draftPaths);

  const openFile: OpenFile | null = docState.activePath
    ? {
        path: docState.activePath,
        title: docState.activeFile?.title ?? null,
        isDirty: docState.isDirty,
        async save()    { await docState.saveFile(); },
        async discard() { await docState.discardChanges(); },
        close()         { docState.closeFile(); },
      }
    : null;

  return {
    active: activeCtx,
    fileTree: { root, selected: null },
    editor: {
      files: openFile ? [openFile] : [],
      activeFile: openFile,
    },
    user: {
      id:          user.id,
      displayName: user.display_name,
      email:       user.email,
      isAdmin:     user.is_admin,
    },
    notify(message, kind = "ok") {
      useDocumentStore.getState().setStatus({ kind, message });
    },
    confirm: openConfirm,
    openModal,
    openPalette: () => setPaletteOpen(true),
    logout: performLogout,
  };
}
