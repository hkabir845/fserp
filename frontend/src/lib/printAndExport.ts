/**
 * CSV + download helpers (UTF-8 BOM for Excel) and print-oriented utilities.
 */

import { formatDateTime } from '@/utils/date'

const CSV_BOM = '\uFEFF'

export function escapeCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCsvText(header: string[], rows: unknown[][]): string {
  const lines = [header.map(escapeCsvCell).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','))
  }
  return lines.join('\r\n')
}

export function downloadTextFile(
  baseName: string,
  text: string,
  contentType: string = 'text/csv;charset=utf-8',
  options?: { withBom?: boolean }
) {
  const withBom = options?.withBom ?? (contentType.includes('csv') || contentType.includes('text'))
  const body = withBom ? CSV_BOM + text : text
  const blob = new Blob([body], { type: contentType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = baseName
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadCsvFile(filename: string, csv: string) {
  downloadTextFile(filename.endsWith('.csv') ? filename : `${filename}.csv`, csv, 'text/csv;charset=utf-8', { withBom: true })
}

export function formatTimestampForFilename(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(
    d.getSeconds()
  )}`
}

export function safeFilenameSegment(raw: string | null | undefined, fallback = 'export'): string {
  const t = (raw || fallback).trim() || fallback
  return t.replace(/[^\w.-]+/g, '_').slice(0, 64)
}

export function formatPrintDateTime(d = new Date()): string {
  return formatDateTime(d)
}
