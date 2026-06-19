'use client'

import { useMemo } from 'react'
import { SearchableGroupedCombobox } from '@/components/bills/SearchableGroupedCombobox'
import type { ReportingMapTarget } from '@/app/reporting-categories/reportingCategoriesScope'
import { reportingMapTargetGroups } from '@/lib/referenceComboboxOptions'

export function ReportingMapTargetCombobox({
  value,
  onChange,
  targets,
  className,
  id,
  emptyLabel = '— select rollup —',
  placeholder = 'Search P&L rollup…',
  missingOption,
}: {
  value: string
  onChange: (code: string) => void
  targets: ReportingMapTarget[]
  className?: string
  id?: string
  emptyLabel?: string
  placeholder?: string
  missingOption?: { value: string; label: string; description?: string }
}) {
  const groups = useMemo(
    () => reportingMapTargetGroups(targets, missingOption),
    [targets, missingOption],
  )

  return (
    <SearchableGroupedCombobox
      id={id}
      value={value}
      onChange={onChange}
      groups={groups}
      emptyOption={{ value: '', label: emptyLabel }}
      className={className}
      placeholder={placeholder}
    />
  )
}
