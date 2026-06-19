'use client'

import { useMemo } from 'react'
import { SearchableGroupedCombobox } from '@/components/bills/SearchableGroupedCombobox'
import { employeeReferenceGroups, type EmployeeReferenceRow } from '@/lib/referenceComboboxOptions'

export function EmployeeReferenceCombobox({
  value,
  onChange,
  employees,
  className,
  id,
  emptyValue = 0,
  emptyLabel = 'Select employee…',
  placeholder = 'Search employees…',
}: {
  value: number
  onChange: (employeeId: number) => void
  employees: EmployeeReferenceRow[]
  className?: string
  id?: string
  emptyValue?: number
  emptyLabel?: string
  placeholder?: string
}) {
  const groups = useMemo(() => employeeReferenceGroups(employees), [employees])
  const strValue = value > 0 ? String(value) : String(emptyValue)

  return (
    <SearchableGroupedCombobox
      id={id}
      value={strValue}
      onChange={(v) => onChange(parseInt(v, 10) || emptyValue)}
      groups={groups}
      emptyOption={{ value: String(emptyValue), label: emptyLabel }}
      className={className}
      placeholder={placeholder}
    />
  )
}
