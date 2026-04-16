import { useState, useCallback } from 'react'
import type { Entry } from '../api/entries'
import { updateEntry } from '../api/entries'

interface Props {
  entry: Entry
}

// Source-mode editor — Markdown is always visible as written.
// This is a minimal textarea stub; the real implementation will be a custom
// component with variable font support and paper-feel typography.
export default function Editor({ entry }: Props) {
  const [content, setContent] = useState(entry.content)
  const [saving, setSaving] = useState(false)

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await updateEntry(entry.id, { content })
    } finally {
      setSaving(false)
    }
  }, [entry.id, content])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      save()
    }
  }

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <span className="editor-title">{entry.title}</span>
        <button className="save-button" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {/* TODO: replace with custom paper-feel source editor */}
      <textarea
        className="editor-textarea"
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck
      />
    </div>
  )
}
