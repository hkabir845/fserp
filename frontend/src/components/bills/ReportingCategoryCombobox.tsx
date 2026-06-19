'use client'

import { useMemo } from 'react'
import {
  splitReportingCategoryOptions,
  type ReportingCategoryOption,
} from '@/lib/reportingCategorySelect'
import {
  SearchableGroupedCombobox,
  type GroupedComboboxGroup,
} from './SearchableGroupedCombobox'

export function ReportingCategoryCombobox({
  categories,
  value,
  onChange,
  className,
  id,
  placeholder = 'Search category…',
  emptyLabel = '— Select category —',
  standardGroupLabel = 'Standard categories',
  customGroupLabel = 'Your custom labels',
}: {
  categories: ReportingCategoryOption[]
  value: string
  onChange: (categoryId: string) => void
  className?: string
  id?: string
  placeholder?: string
  emptyLabel?: string
  standardGroupLabel?: string
  customGroupLabel?: string
}) {
  const groups = useMemo((): GroupedComboboxGroup[] => {
    const { standard, custom } = splitReportingCategoryOptions(categories)
    const toOpt = (c: ReportingCategoryOption) => ({
      value: c.id,
      label: c.label,
      description: c.hint || c.bill_create_disallowed_reason || undefined,
      searchText: `${c.id} ${c.label} ${c.hint || ''}`,
      title: c.hint || c.bill_create_disallowed_reason || undefined,
      disabled: c.bill_create_allowed === false,
    })
    const out: GroupedComboboxGroup[] = []
    if (standard.length > 0) {
      out.push({ label: standardGroupLabel, options: standard.map(toOpt) })
    }
    if (custom.length > 0) {
      out.push({ label: customGroupLabel, options: custom.map(toOpt) })
    }
    if (out.length === 0 && categories.length > 0) {
      out.push({ label: 'Categories', options: categories.map(toOpt) })
    }
    return out
  }, [categories, standardGroupLabel, customGroupLabel])

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
