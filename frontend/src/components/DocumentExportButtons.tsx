'use client'

import { Download, Printer } from 'lucide-react'

type DocumentExportButtonsProps = {
  onPrint?: () => void
  onDownloadCsv?: () => void
  onDownloadJson?: () => void
  disabled?: boolean
  printLabel?: string
  /** Compact row for modals; default toolbar for list headers. */
  size?: 'toolbar' | 'compact'
}

export function DocumentExportButtons({
  onPrint,
  onDownloadCsv,
  onDownloadJson,
  disabled = false,
  printLabel = 'Print',
  size = 'toolbar',
}: DocumentExportButtonsProps) {
  const hasAny = onPrint || onDownloadCsv || onDownloadJson
  if (!hasAny) return null

  if (size === 'compact') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {onPrint ? (
          <button
            type="button"
            onClick={onPrint}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            {printLabel}
          </button>
        ) : null}
        {onDownloadCsv ? (
          <button
            type="button"
            onClick={onDownloadCsv}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
        ) : null}
        {onDownloadJson ? (
          <button
            type="button"
            onClick={onDownloadJson}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg bg-muted-foreground px-3 py-2 text-sm font-medium text-white hover:bg-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            JSON
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onPrint ? (
        <button
          type="button"
          onClick={onPrint}
          disabled={disabled}
          className="flex items-center space-x-2 rounded-lg border border-border bg-white px-4 py-2.5 font-medium text-foreground shadow-sm transition-all hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Printer className="h-5 w-5" />
          <span>{printLabel}</span>
        </button>
      ) : null}
      {onDownloadCsv ? (
        <button
          type="button"
          onClick={onDownloadCsv}
          disabled={disabled}
          className="flex items-center space-x-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-white shadow-sm transition-all hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-5 w-5" />
          <span>CSV</span>
        </button>
      ) : null}
      {onDownloadJson ? (
        <button
          type="button"
          onClick={onDownloadJson}
          disabled={disabled}
          className="flex items-center space-x-2 rounded-lg bg-muted-foreground px-4 py-2.5 font-medium text-white shadow-sm transition-all hover:bg-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-5 w-5" />
          <span>JSON</span>
        </button>
      ) : null}
    </div>
  )
}
