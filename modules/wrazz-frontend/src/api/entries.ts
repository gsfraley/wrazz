import { useEffect, useState } from 'react'

export interface Entry {
  id: string
  title: string
  content: string
  tags: string[]
  created_at: string
  updated_at: string
}

const BASE = '/api'

export async function listEntries(): Promise<Entry[]> {
  const res = await fetch(`${BASE}/entries`)
  if (!res.ok) throw new Error('Failed to list entries')
  return res.json()
}

export async function getEntry(id: string): Promise<Entry> {
  const res = await fetch(`${BASE}/entries/${id}`)
  if (!res.ok) throw new Error(`Failed to load entry ${id}`)
  return res.json()
}

export async function createEntry(title: string, content: string, tags: string[] = []): Promise<Entry> {
  const res = await fetch(`${BASE}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, tags }),
  })
  if (!res.ok) throw new Error('Failed to create entry')
  return res.json()
}

export async function updateEntry(id: string, patch: Partial<Pick<Entry, 'title' | 'content' | 'tags'>>): Promise<Entry> {
  const res = await fetch(`${BASE}/entries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`Failed to update entry ${id}`)
  return res.json()
}

export async function deleteEntry(id: string): Promise<void> {
  const res = await fetch(`${BASE}/entries/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to delete entry ${id}`)
}

export interface SlotOutput {
  slot: string
  html: string
}

export async function getSlots(id: string): Promise<SlotOutput[]> {
  const res = await fetch(`${BASE}/entries/${id}/slots`)
  if (!res.ok) return []
  return res.json()
}

export function useEntries() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listEntries()
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [])

  return { entries, loading, setEntries }
}
