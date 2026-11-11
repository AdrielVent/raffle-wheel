// Shared event helpers (kept out of App.tsx so React Fast Refresh stays component-only).

// SHPE Events Google Drive folder — end-of-event attendance sheets are filed here.
export const SHPE_DRIVE_FOLDER_ID = '1SdR0qAdPE_zqdDJJ5khZvC89KII_Nedv'
export const SHPE_DRIVE_FOLDER_URL = `https://drive.google.com/drive/folders/${SHPE_DRIVE_FOLDER_ID}?usp=sharing`

export function isArchived(event: { archived_at?: string | null } | null | undefined): boolean {
  return Boolean(event?.archived_at)
}

/** Public check-in URL encoded into every QR code (hash route, safe on GitHub Pages). */
export function buildCheckInUrl(event: { slug: string; name: string; id: string }): string {
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}#/e/${event.slug}?name=${encodeURIComponent(event.name)}&id=${encodeURIComponent(event.id)}`
}
