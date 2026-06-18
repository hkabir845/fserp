import type { ReactNode } from 'react'

export type ReportingCategoryOption = {
  id: string
  label: string
  tenant_defined?: boolean
  bill_create_allowed?: boolean
  bill_create_disallowed_reason?: string | null
  hint?: string | null
}

function optionTitle(c: ReportingCategoryOption): string | undefined {
  return c.hint || c.bill_create_disallowed_reason || undefined
}

export function splitReportingCategoryOptions<T extends ReportingCategoryOption>(
  rows: T[],
): { standard: T[]; custom: T[] } {
  const standard: T[] = []
  const custom: T[] = []
  for (const row of rows) {
    if (row.tenant_defined) custom.push(row)
    else standard.push(row)
  }
  return { standard, custom }
}

export function ReportingCategorySelectOptions({
  categories,
  standardGroupLabel = 'Standard categories',
  customGroupLabel = 'Your custom labels',
}: {
  categories: ReportingCategoryOption[]
  standardGroupLabel?: string
  customGroupLabel?: string
}): ReactNode {
  const { standard, custom } = splitReportingCategoryOptions(categories)
  if (!standard.length && !custom.length) return null
  if (!custom.length) {
    return (
      <>
        {standard.map((c) => (
          <option key={c.id} value={c.id} title={optionTitle(c)}>
            {c.label}
          </option>
        ))}
      </>
    )
  }
  if (!standard.length) {
    return (
      <>
        {custom.map((c) => (
          <option key={c.id} value={c.id} title={optionTitle(c)}>
            {c.label}
          </option>
        ))}
      </>
    )
  }
  return (
    <>
      <optgroup label={standardGroupLabel}>
        {standard.map((c) => (
          <option key={c.id} value={c.id} title={optionTitle(c)}>
            {c.label}
          </option>
        ))}
      </optgroup>
      <optgroup label={customGroupLabel}>
        {custom.map((c) => (
          <option key={c.id} value={c.id} title={optionTitle(c)}>
            {c.label}
          </option>
        ))}
      </optgroup>
    </>
  )
}
