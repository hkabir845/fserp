/** Deep links from Data Bank year-close records into read-only archive reports. */

export type DataBankArchiveLinkInput = {
  pondId: number
  periodStart: string
  periodEnd: string
  label?: string
  closeId?: number
}

/** Management P&L for one pond and closed fiscal period (read-only browse). */
export function aquacultureArchivePlReportHref(input: DataBankArchiveLinkInput): string {
  const q = new URLSearchParams({
    report: 'aquaculture-pl-management',
    category: 'aquaculture',
    start_date: input.periodStart.slice(0, 10),
    end_date: input.periodEnd.slice(0, 10),
    pond_id: String(input.pondId),
  })
  if (input.closeId != null) q.set('archive_close_id', String(input.closeId))
  if (input.label?.trim()) q.set('archive_label', input.label.trim())
  return `/reports?${q.toString()}`
}

export function parseArchivePlSearchParams(
  params: URLSearchParams
): { start: string; end: string; pondId: string; label: string; closeId: string } | null {
  const start = (params.get('start_date') || '').trim().slice(0, 10)
  const end = (params.get('end_date') || '').trim().slice(0, 10)
  const pondId = (params.get('pond_id') || '').trim()
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return null
  }
  return {
    start,
    end,
    pondId: /^\d+$/.test(pondId) ? pondId : '',
    label: (params.get('archive_label') || '').trim(),
    closeId: (params.get('archive_close_id') || '').trim(),
  }
}
