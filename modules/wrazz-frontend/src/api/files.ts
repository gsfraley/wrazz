export interface FileEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

/// Percent-encodes forward slashes so the ID survives as a single path segment.
function encodeId(id: string): string {
  return id.replace(/\//g, "%2F");
}

export async function listFiles(): Promise<FileEntry[]> {
  const resp = await fetch("/api/files");
  if (!resp.ok) throw new Error(`list failed: ${resp.status}`);
  return resp.json();
}

export async function getFile(id: string): Promise<FileEntry> {
  const resp = await fetch(`/api/files/${encodeId(id)}`);
  if (!resp.ok) throw new Error(`get failed: ${resp.status}`);
  return resp.json();
}

export async function createFile(
  title: string,
  content: string,
  tags: string[]
): Promise<FileEntry> {
  const resp = await fetch("/api/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content, tags }),
  });
  if (!resp.ok) throw new Error(`create failed: ${resp.status}`);
  return resp.json();
}

export async function updateFile(
  id: string,
  title: string,
  content: string,
  tags: string[]
): Promise<FileEntry> {
  const resp = await fetch(`/api/files/${encodeId(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content, tags }),
  });
  if (!resp.ok) throw new Error(`update failed: ${resp.status}`);
  return resp.json();
}

export async function deleteFile(id: string): Promise<void> {
  const resp = await fetch(`/api/files/${encodeId(id)}`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error(`delete failed: ${resp.status}`);
}
