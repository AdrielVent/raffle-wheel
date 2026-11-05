import writeXlsxFile from 'write-excel-file/browser'

export type AttendanceExportRow = {
  first_name: string
  last_name: string
  hofstra_email?: string | null
  checked_in_at?: string | null
  ineligible?: boolean
}

export const EXCEL_COLUMNS = [
  { width: 28 }, // Event
  { width: 18 }, // First Name
  { width: 18 }, // Last Name
  { width: 34 }, // Hofstra Email
  { width: 26 }, // Check-in Time (UTC)
]

export const EXCEL_HEADERS = [
  { value: 'Event', fontWeight: 'bold' as const },
  { value: 'First Name', fontWeight: 'bold' as const },
  { value: 'Last Name', fontWeight: 'bold' as const },
  { value: 'Hofstra Email', fontWeight: 'bold' as const },
  { value: 'Check-in Time (UTC)', fontWeight: 'bold' as const },
]

/**
 * Escapes characters that could trigger spreadsheet formula execution (CWE-1236).
 * Prepends an apostrophe if the value begins with =, +, -, @, tab, or carriage return.
 */
export function sanitizeSpreadsheetText(raw: string | null | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${trimmed}`
  }
  return trimmed
}

/**
 * Formats a timestamp into a clearly labeled UTC string: YYYY-MM-DD HH:mm:ss UTC
 */
export function formatUtcTimestamp(dateString?: string | null): string {
  if (!dateString) return 'N/A'
  try {
    const d = new Date(dateString)
    if (isNaN(d.getTime())) return 'N/A'
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
  } catch {
    return 'N/A'
  }
}

/**
 * Builds cell matrices with explicit text typing and formula injection prevention.
 */
export function buildAttendanceRows(eventName: string, entries: AttendanceExportRow[]) {
  const rows: Array<Array<{ type?: typeof String; value: string; fontWeight?: 'bold' }>> = [
    EXCEL_HEADERS,
  ]

  for (const entry of entries) {
    rows.push([
      { type: String, value: sanitizeSpreadsheetText(eventName) },
      { type: String, value: sanitizeSpreadsheetText(entry.first_name) },
      { type: String, value: sanitizeSpreadsheetText(entry.last_name) },
      { type: String, value: sanitizeSpreadsheetText(entry.hofstra_email ?? '') },
      { type: String, value: formatUtcTimestamp(entry.checked_in_at) },
    ])
  }

  return rows
}

/**
 * Downloads a genuine .xlsx workbook containing all event attendance records.
 */
export async function downloadAttendanceExcel(
  eventName: string,
  eventSlug: string,
  entries: AttendanceExportRow[],
) {
  const rows = buildAttendanceRows(eventName, entries)
  const safeSlug = (eventSlug || 'event').replace(/[^a-zA-Z0-9_-]/g, '_')
  const fileName = `${safeSlug}-attendance.xlsx`

  const result = writeXlsxFile(rows as any, {
    columns: EXCEL_COLUMNS,
  })
  await result.toFile(fileName)
}
