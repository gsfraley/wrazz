import { useDocumentStore } from "@/stores/documentStore";
import { pathToDisplayTitle } from "@/lib/utils";
import styles from "@/components/StatusBar.module.css";

export default function StatusBar() {
  const { activePath, draft, status } = useDocumentStore();
  const title = draft?.title || (activePath ? pathToDisplayTitle(activePath) : null);

  return (
    <footer className={styles.statusBar}>
      <span className={status?.kind === "error" ? styles.statusError : ""}>
        {status?.message ?? ""}
      </span>
      <span>{title ?? ""}</span>
    </footer>
  );
}
