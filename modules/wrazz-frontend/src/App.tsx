import EntryList from './components/EntryList'
import Editor from './components/Editor'
import StatusBar from './components/StatusBar'
import { useEntries } from './api/entries'
import { useState } from 'react'

export default function App() {
  const { entries, loading } = useEntries()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = entries.find(e => e.id === selectedId) ?? null

  return (
    <div className="app">
      <aside className="sidebar">
        {loading ? (
          <p className="loading">Loading…</p>
        ) : (
          <EntryList entries={entries} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </aside>
      <main className="editor-pane">
        {selected ? (
          <Editor entry={selected} />
        ) : (
          <div className="empty-state">Select an entry or create a new one.</div>
        )}
      </main>
      <StatusBar entryId={selectedId} />
    </div>
  )
}
