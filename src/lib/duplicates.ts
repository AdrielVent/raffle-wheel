export type EntryName = {
  id: string
  first_name: string
  last_name: string
}

export function findDuplicateNameIds(entries: EntryName[]): Set<string> {
  const buckets = new Map<string, string[]>()

  for (const entry of entries) {
    const key = `${entry.first_name.trim().toLocaleLowerCase()}|${entry.last_name.trim().toLocaleLowerCase()}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(entry.id)
    } else {
      buckets.set(key, [entry.id])
    }
  }

  const duplicateIds = new Set<string>()
  for (const ids of buckets.values()) {
    if (ids.length > 1) {
      ids.forEach((id) => duplicateIds.add(id))
    }
  }

  return duplicateIds
}
