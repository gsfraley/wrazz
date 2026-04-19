import { FileEntry } from "../api/files";

interface Props {
  files: FileEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onLogout: () => void;
}

export default function FileList({ files, activeId, onSelect, onNew, onLogout }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-heading">Files</span>
        <div className="sidebar-header-actions">
          <button onClick={onNew}>+ New</button>
          <button onClick={onLogout}>sign out</button>
        </div>
      </div>
      <ul className="file-list">
        {files.map((f) => (
          <li
            key={f.id}
            className={`file-item${f.id === activeId ? " active" : ""}`}
            onClick={() => onSelect(f.id)}
          >
            {f.title}
          </li>
        ))}
      </ul>
    </aside>
  );
}
