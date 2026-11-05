const prefix = 'raffle-wheel:v1'

export function getReceiptKey(eventSlug: string): string {
  return `${prefix}:receipt:${eventSlug}`
}

export function getPreferenceKey(eventId: string, preference: string): string {
  return `${prefix}:pref:${eventId}:${preference}`
}
