import type { Entry } from '../api/entries'

interface Props {
  entries: Entry[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function EntryList({ entries, selectedId, onSelect }: Props) {
  return (
    <nav className="entry-list">
      {entries.map(e => (
        <button
          key={e.id}
          className={`entry-list-item ${e.id === selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(e.id)}
        >
          <span className="entry-title">{e.title || 'Untitled'}</span>
          <span className="entry-date">
            {new Date(e.updated_at).toLocaleDateString()}
          </span>
        </button>
      ))}
      {entries.length === 0 && (
        <p className="entry-list-empty">No entries yet.</p>
      )}
    </nav>
  )
}
