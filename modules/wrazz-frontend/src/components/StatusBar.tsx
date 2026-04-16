interface Props {
  activeId: string | null;
  message: string | null;
}

export default function StatusBar({ activeId, message }: Props) {
  return (
    <footer className="status-bar">
      <span>{message ?? ""}</span>
      <span>{activeId ?? ""}</span>
    </footer>
  );
}
