export type AppStatus =
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };
