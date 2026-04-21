import { FileEntry } from "../api/files";
import { FilePlus } from "../icons";

interface Props {
  files: FileEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export default function FileList({ files, activeId, onSelect, onNew }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-heading">Files</span>
        <button className="btn-icon" onClick={onNew} aria-label="New file">
          <FilePlus />
        </button>
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
