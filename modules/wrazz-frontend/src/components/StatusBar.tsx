import { useEffect, useState } from 'react'
import { getSlots, type SlotOutput } from '../api/entries'

interface Props {
  entryId: string | null
}

export default function StatusBar({ entryId }: Props) {
  const [slots, setSlots] = useState<SlotOutput[]>([])

  useEffect(() => {
    if (!entryId) { setSlots([]); return }
    getSlots(entryId).then(setSlots)
  }, [entryId])

  const statusSlots = slots.filter(s => s.slot === 'status-bar')

  return (
    <footer className="status-bar">
      {statusSlots.map((s, i) => (
        // Extension HTML is sandboxed — dangerouslySetInnerHTML is intentional here.
        // The server owns extension code; this is not user-controlled input.
        <span key={i} dangerouslySetInnerHTML={{ __html: s.html }} />
      ))}
    </footer>
  )
}
