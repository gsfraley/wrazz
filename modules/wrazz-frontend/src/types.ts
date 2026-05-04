export type AppStatus =
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export interface Draft {
  title: string;
  content: string;
  tags: string[];
}
