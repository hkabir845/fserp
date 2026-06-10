'use client'

import { useCallback } from 'react'
import { useToast } from '@/components/Toast'
import { extractErrorMessage } from '@/utils/errorHandler'
import { printListView } from '@/utils/printListView'
import {
  downloadCsvFile,
  downloadJsonFile,
  printHtmlDocument,
} from '@/utils/businessDocumentExport'
import { loadPrintBranding } from '@/utils/printBranding'
import api from '@/lib/api'

export type PagedListExportLabels = {
  entity: string
  entities: string
  emptyPrint: string
  emptyExport: string
}

export type UsePagedListExportOptions<TRow> = {
  fetchRows: () => Promise<TRow[]>
  totalCount: number
  labels: PagedListExportLabels
  csvFilenamePrefix: string
  subtitle: () => string
  buildCsv: (rows: TRow[]) => string
} & (
  | {
      printMode?: 'listView'
      printTitle: string
      buildPrintContent: (rows: TRow[], totalCount: number) => string
    }
  | {
      printMode: 'htmlDocument'
      printTitle: string
      buildPrintHtml: (rows: TRow[], subtitle: string, totalCount: number) => string
    }
)

export function usePagedListExport<TRow>(options: UsePagedListExportOptions<TRow>) {
  const toast = useToast()
  const {
    fetchRows,
    totalCount,
    labels,
    csvFilenamePrefix,
    subtitle,
    buildCsv,
    printTitle,
  } = options

  const handlePrint = useCallback(async () => {
    try {
      const rows = await fetchRows()
      if (rows.length === 0) {
        toast.error(labels.emptyPrint)
        return
      }
      const sub = subtitle()
      if (options.printMode === 'htmlDocument') {
        const branding = await loadPrintBranding(api)
        const bodyHtml = options.buildPrintHtml(rows, sub, totalCount)
        const ok = await printHtmlDocument(printTitle, bodyHtml, branding)
        if (!ok) toast.error('Allow pop-ups to print, or check your browser settings.')
        return
      }
      const tableHtml = options.buildPrintContent(rows, totalCount)
      const ok = await printListView({
        title: printTitle,
        subtitle: sub,
        tableHtml,
      })
      if (!ok) toast.error('Allow pop-ups to print, or check your browser settings.')
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Print failed'))
    }
  }, [fetchRows, labels.emptyPrint, options, printTitle, subtitle, toast, totalCount])

  const handleDownloadCsv = useCallback(async () => {
    try {
      const rows = await fetchRows()
      if (rows.length === 0) {
        toast.error(labels.emptyExport)
        return
      }
      downloadCsvFile(
        `${csvFilenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`,
        buildCsv(rows),
      )
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Export failed'))
    }
  }, [buildCsv, csvFilenamePrefix, fetchRows, labels.emptyExport, toast])

  const handleDownloadJson = useCallback(async () => {
    try {
      const rows = await fetchRows()
      if (rows.length === 0) {
        toast.error(labels.emptyExport)
        return
      }
      downloadJsonFile(
        `${csvFilenamePrefix}_${new Date().toISOString().slice(0, 10)}.json`,
        rows,
      )
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Export failed'))
    }
  }, [csvFilenamePrefix, fetchRows, labels.emptyExport, toast])

  return { handlePrint, handleDownloadCsv, handleDownloadJson }
}
