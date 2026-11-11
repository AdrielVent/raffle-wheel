import writeXlsxFile from 'write-excel-file/browser'

export type AttendanceExportRow = {
  id?: string
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

/** Fill colour for raffle winners' rows (also kept when the file is opened in Google Sheets). */
export const WINNER_FILL = '#FFFF00'

type ExportCell = { type?: typeof String; value: string; fontWeight?: 'bold'; backgroundColor?: string }

/**
 * Builds cell matrices with explicit text typing and formula injection prevention.
 * Rows for attendees in `winnerIds` (picked by the wheel) are filled yellow.
 */
export function buildAttendanceRows(
  eventName: string,
  entries: AttendanceExportRow[],
  winnerIds: ReadonlySet<string> = new Set(),
) {
  const rows: ExportCell[][] = [EXCEL_HEADERS]

  for (const entry of entries) {
    const fill = entry.id && winnerIds.has(entry.id) ? { backgroundColor: WINNER_FILL } : {}
    rows.push([
      { type: String, value: sanitizeSpreadsheetText(eventName), ...fill },
      { type: String, value: sanitizeSpreadsheetText(entry.first_name), ...fill },
      { type: String, value: sanitizeSpreadsheetText(entry.last_name), ...fill },
      { type: String, value: sanitizeSpreadsheetText(entry.hofstra_email ?? ''), ...fill },
      { type: String, value: formatUtcTimestamp(entry.checked_in_at), ...fill },
    ])
  }

  return rows
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * Same table as the Excel export, as tab-separated text and as an HTML table. Pasting the
 * HTML into Google Sheets keeps the yellow fill on the winners' rows.
 */
export function buildAttendanceClipboard(
  eventName: string,
  entries: AttendanceExportRow[],
  winnerIds: ReadonlySet<string> = new Set(),
) {
  const rows = buildAttendanceRows(eventName, entries, winnerIds)
  const text = rows.map((r) => r.map((c) => c.value.replace(/[\t\n]/g, ' ')).join('\t')).join('\n')
  const html =
    '<table>' +
    rows
      .map(
        (r, i) =>
          '<tr>' +
          r
            .map((c) => {
              const tag = i === 0 ? 'th' : 'td'
              const style = c.backgroundColor ? ` style="background-color:${c.backgroundColor}"` : ''
              return `<${tag}${style}>${escapeHtml(c.value)}</${tag}>`
            })
            .join('') +
          '</tr>',
      )
      .join('') +
    '</table>'
  return { text, html }
}

/**
 * Downloads a genuine .xlsx workbook containing all event attendance records.
 */
export async function downloadAttendanceExcel(
  eventName: string,
  eventSlug: string,
  entries: AttendanceExportRow[],
  winnerIds: ReadonlySet<string> = new Set(),
) {
  const rows = buildAttendanceRows(eventName, entries, winnerIds)
  const safeSlug = (eventSlug || 'event').replace(/[^a-zA-Z0-9_-]/g, '_')
  const fileName = `${safeSlug}-attendance.xlsx`

  const result = writeXlsxFile(rows as any, {
    columns: EXCEL_COLUMNS,
  })
  await result.toFile(fileName)
}
