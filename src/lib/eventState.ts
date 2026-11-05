export type PublicState = 'invalid_event' | 'open' | 'closed' | 'ended'

export function getPublicState(event: { status: 'open' | 'closed' | 'ended'; registration_open: boolean } | null): PublicState {
  if (!event) {
    return 'invalid_event'
  }

  if (event.status === 'ended') {
    return 'ended'
  }

  if (event.status === 'closed' || !event.registration_open) {
    return 'closed'
  }

  return 'open'
}

export function canDrawFromSnapshot(entries: Array<{ ineligible: boolean }>) {
  return entries.some((entry) => !entry.ineligible)
}
