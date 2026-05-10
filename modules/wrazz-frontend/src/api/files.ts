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

function pathToUrl(path: string): string {
  return path.replace(/^\/|\/$/g, "");
}

export async function listEntries(path = "/"): Promise<Entry[]> {
  const params = new URLSearchParams({ path });
  const resp = await apiFetch(`/api/entries?${params}`);
  return resp.json();
}

export async function getFile(path: string): Promise<FileEntry> {
  const resp = await apiFetch(`/api/files/${pathToUrl(path)}`);
  return resp.json();
}

export async function getFileContent(path: string): Promise<FileContent> {
  const resp = await apiFetch(`/api/content/${pathToUrl(path)}`);
  return resp.json();
}

export async function createFile(
  path: string,
  title: string | null,
  tags: string[],
  content: string,
): Promise<FileEntry> {
  const resp = await apiFetch(`/api/files/${pathToUrl(path)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, tags, content }),
  });
  return resp.json();
}

export async function updateFile(
  path: string,
  title: string | null,
  tags: string[],
  content: string,
): Promise<FileEntry> {
  const resp = await apiFetch(`/api/files/${pathToUrl(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, tags, content }),
  });
  return resp.json();
}

export async function deleteEntry(path: string): Promise<void> {
  await apiFetch(`/api/entries/${pathToUrl(path)}`, { method: "DELETE" });
}

export async function createDir(path: string): Promise<void> {
  await apiFetch(`/api/dirs/${pathToUrl(path)}`, { method: "POST" });
}

export async function moveEntry(fromPath: string, toPath: string): Promise<void> {
  await apiFetch(`/api/entries/${pathToUrl(fromPath)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to_path: toPath }),
  });
}

export async function listAllFilePaths(path = "/"): Promise<string[]> {
  const entries = await listEntries(path).catch(() => []);
  const paths: string[] = [];
  await Promise.all(
    entries.map(async (e) => {
      if (e.kind === "file") {
        paths.push(e.path);
      } else {
        paths.push(...(await listAllFilePaths(e.path)));
      }
    }),
  );
  return paths;
}
