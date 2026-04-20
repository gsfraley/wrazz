import { AppStatus } from "../types";

interface Props {
  title: string | null;
  status: AppStatus | null;
}

export default function StatusBar({ title, status }: Props) {
  return (
    <footer className="status-bar">
      <span className={status?.kind === "error" ? "status-error" : ""}>
        {status?.message ?? ""}
      </span>
      <span>{title ?? ""}</span>
    </footer>
  );
}
