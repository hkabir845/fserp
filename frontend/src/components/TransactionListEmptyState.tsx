'use client'

import type { ReactNode } from 'react'
import { FilterX } from 'lucide-react'

interface TransactionListEmptyStateProps {
  title: string
  description: string
  icon?: ReactNode
  hasActiveFilters?: boolean
  onClearFilters?: () => void
  action?: ReactNode
  className?: string
}

export function TransactionListEmptyState({
  title,
  description,
  icon,
  hasActiveFilters = false,
  onClearFilters,
  action,
  className = '',
}: TransactionListEmptyStateProps) {
  return (
    <div className={`flex flex-col items-center px-6 py-14 text-center ${className}`}>
      {icon ? <div className="mb-4 rounded-full bg-slate-100 p-4">{icon}</div> : null}
      <p className="font-medium text-slate-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {hasActiveFilters && onClearFilters ? (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <FilterX className="h-3.5 w-3.5" aria-hidden />
          Clear filters
        </button>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
