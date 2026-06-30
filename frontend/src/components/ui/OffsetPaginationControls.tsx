'use client'

import { OFFSET_PAGE_SIZE_OPTIONS } from '@/lib/pagination'

type Props = {
  page: number
  pageSize: number
  total: number
  onPageChange: (p: number) => void
  onPageSizeChange: (n: number) => void
  disabled?: boolean
  pageSizeOptions?: readonly number[]
}

export function OffsetPaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  disabled,
  pageSizeOptions = OFFSET_PAGE_SIZE_OPTIONS,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(total, safePage * pageSize)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <div>
        Showing <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Rows</span>
          <select
            value={pageSize}
            disabled={disabled}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded-md border border-border bg-white px-2 py-1.5 text-foreground shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="rounded-md border border-border bg-white px-3 py-1.5 font-medium text-foreground/85 shadow-sm hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <span className="tabular-nums text-foreground/85">
          Page {safePage} / {totalPages}
        </span>
        <button
          type="button"
          disabled={disabled || safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="rounded-md border border-border bg-white px-3 py-1.5 font-medium text-foreground/85 shadow-sm hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}
