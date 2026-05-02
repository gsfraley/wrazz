import type { ComponentType } from "react";

export type ActionContext = "editor" | "file-tree";

export interface Action {
  id: string;
  label: string;
  keywords?: string[];
  icon?: ComponentType<{ size?: number }>;
  contexts?: ActionContext[];
  handler: () => void;
}

const registry: Action[] = [];

export function registerAction(action: Action): () => void {
  registry.push(action);
  return () => {
    const i = registry.indexOf(action);
    if (i !== -1) registry.splice(i, 1);
  };
}

export function getActions(): readonly Action[] {
  return registry;
}
