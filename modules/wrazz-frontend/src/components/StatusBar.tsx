import { AppStatus } from "../types";
import styles from "./StatusBar.module.css";

export interface StatusBarProps {
  title: string | null;
  status: AppStatus | null;
}

export default function StatusBar({ title, status }: StatusBarProps) {
  return (
    <footer className={styles.statusBar}>
      <span className={status?.kind === "error" ? styles.statusError : ""}>
        {status?.message ?? ""}
      </span>
      <span>{title ?? ""}</span>
    </footer>
  );
}
