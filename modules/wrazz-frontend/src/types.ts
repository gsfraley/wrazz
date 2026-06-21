export type AppStatus =
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export interface DesktopPrefs {
  buttonSide: "left" | "right";
  detected: {
    side: "left" | "right";
    source: "env" | "gnome" | "kde" | "default" | "macos" | "windows";
  };
  overrides: {
    buttonSide: "left" | "right" | null;
  };
}

export interface Draft {
  title: string;
  content: string;
  tags: string[];
}
