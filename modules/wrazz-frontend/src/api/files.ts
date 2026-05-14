import { apiFetch } from "@/lib/apiError";

export interface FileEntry {
  path: string;
  title: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface DirEntry {
  path: string;
  created_at: string;
  updated_at: string;
}

export type Entry =
  | { kind: "file" } & FileEntry
  | { kind: "dir" } & DirEntry;

export interface FileContent {
  content: string;
}

function wsBase(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}`;
}

function pathToUrl(path: string): string {
  return path.replace(/^\/|\/$/g, "");
}

export async function listEntries(workspaceId: string, path = "/"): Promise<Entry[]> {
  const params = new URLSearchParams({ path });
  const resp = await apiFetch(`${wsBase(workspaceId)}/entries?${params}`);
  return resp.json();
}

export async function getFile(workspaceId: string, path: string): Promise<FileEntry> {
  const resp = await apiFetch(`${wsBase(workspaceId)}/files/${pathToUrl(path)}`);
  return resp.json();
}

export async function getFileContent(workspaceId: string, path: string): Promise<FileContent> {
  const resp = await apiFetch(`${wsBase(workspaceId)}/content/${pathToUrl(path)}`);
  return resp.json();
}

export async function createFile(
  workspaceId: string,
  path: string,
  title: string | null,
  tags: string[],
  content: string,
): Promise<FileEntry> {
  const resp = await apiFetch(`${wsBase(workspaceId)}/files/${pathToUrl(path)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, tags, content }),
  });
  return resp.json();
}

export async function updateFile(
  workspaceId: string,
  path: string,
  title: string | null,
  tags: string[],
  content: string,
): Promise<FileEntry> {
  const resp = await apiFetch(`${wsBase(workspaceId)}/files/${pathToUrl(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, tags, content }),
  });
  return resp.json();
}

export async function deleteEntry(workspaceId: string, path: string): Promise<void> {
  await apiFetch(`${wsBase(workspaceId)}/entries/${pathToUrl(path)}`, { method: "DELETE" });
}

export async function createDir(workspaceId: string, path: string): Promise<void> {
  await apiFetch(`${wsBase(workspaceId)}/dirs/${pathToUrl(path)}`, { method: "POST" });
}

export async function moveEntry(workspaceId: string, fromPath: string, toPath: string): Promise<void> {
  await apiFetch(`${wsBase(workspaceId)}/entries/${pathToUrl(fromPath)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to_path: toPath }),
  });
}

export async function listAllFilePaths(workspaceId: string, path = "/"): Promise<string[]> {
  const entries = await listEntries(workspaceId, path).catch(() => []);
  const paths: string[] = [];
  await Promise.all(
    entries.map(async (e) => {
      if (e.kind === "file") {
        paths.push(e.path);
      } else {
        paths.push(...(await listAllFilePaths(workspaceId, e.path)));
      }
    }),
  );
  return paths;
}

export interface FileSummary {
  path: string;
  title: string | null;
}

export async function listAllFiles(workspaceId: string, path = "/"): Promise<FileSummary[]> {
  const entries = await listEntries(workspaceId, path).catch(() => []);
  const files: FileSummary[] = [];
  await Promise.all(
    entries.map(async (e) => {
      if (e.kind === "file") {
        files.push({ path: e.path, title: e.title });
      } else {
        files.push(...(await listAllFiles(workspaceId, e.path)));
      }
    }),
  );
  return files;
}
