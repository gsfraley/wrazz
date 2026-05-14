import { apiFetch } from "@/lib/apiError";

export interface WorkspaceSummary {
  id: string;
  name: string;
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const resp = await apiFetch("/api/workspaces");
  return resp.json();
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const resp = await apiFetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return resp.json();
}

export async function renameWorkspace(id: string, name: string): Promise<WorkspaceSummary> {
  const resp = await apiFetch(`/api/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return resp.json();
}

export async function deleteWorkspace(id: string): Promise<void> {
  await apiFetch(`/api/workspaces/${id}`, { method: "DELETE" });
}
