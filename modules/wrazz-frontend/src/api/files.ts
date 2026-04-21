export interface FileEntry {
  path: string;
  title: string;
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

export async function listEntries(path: string = "/"): Promise<Entry[]> {
  const params = new URLSearchParams({ path });
  const resp = await fetch(`/api/entries?${params}`);
  if (!resp.ok) throw new Error(`list failed: ${resp.status}`);
  return resp.json();
}

export async function getFile(path: string): Promise<FileEntry> {
  const resp = await fetch(`/api/files/${pathToUrl(path)}`);
  if (!resp.ok) throw new Error(`get failed: ${resp.status}`);
  return resp.json();
}

export async function getFileContent(path: string): Promise<FileContent> {
  const resp = await fetch(`/api/content/${pathToUrl(path)}`);
  if (!resp.ok) throw new Error(`get content failed: ${resp.status}`);
  return resp.json();
}

export async function createFile(
  path: string,
  title: string,
  tags: string[],
  content: string,
): Promise<FileEntry> {
  const resp = await fetch(`/api/files/${pathToUrl(path)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, tags, content }),
  });
  if (!resp.ok) throw new Error(`create failed: ${resp.status}`);
  return resp.json();
}

export async function updateFile(
  path: string,
  title: string,
  tags: string[],
  content: string,
): Promise<FileEntry> {
  const resp = await fetch(`/api/files/${pathToUrl(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, tags, content }),
  });
  if (!resp.ok) throw new Error(`update failed: ${resp.status}`);
  return resp.json();
}

export async function deleteEntry(path: string): Promise<void> {
  const resp = await fetch(`/api/entries/${pathToUrl(path)}`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error(`delete failed: ${resp.status}`);
}

export async function createDir(path: string): Promise<void> {
  const resp = await fetch(`/api/dirs/${pathToUrl(path)}`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`create dir failed: ${resp.status}`);
}

export async function moveEntry(
  fromPath: string,
  toPath: string,
): Promise<void> {
  const resp = await fetch(`/api/entries/${pathToUrl(fromPath)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to_path: toPath }),
  });
  if (!resp.ok) throw new Error(`move failed: ${resp.status}`);
}
