'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import api from '@/lib/api'

export type ReferenceCodeKind =
  | 'nozzle'
  | 'customer'
  | 'vendor'
  | 'item'
  | 'tank'
  | 'employee'
  | 'fixed_asset'
  | 'loan'
  | 'loan_counterparty'
  | 'payroll'

type SuggestPayload = {
  prefix: string
  used_suffixes: number[]
  choice_suffixes: number[]
  choice_codes: string[]
  default_suffix: number
  default_code: string
}

type Props = {
  kind: ReferenceCodeKind
  value: string
  onChange: (fullCode: string) => void
  disabled?: boolean
  id?: string
  label?: string
  className?: string
}

/**
 * Read-only preview of the next auto-assigned reference code (PREFIX-n, gap-aware).
 * The server assigns the code on save; deleted numbers are reused in ascending order.
 */
export function ReferenceCodePicker({
  kind,
  value,
  onChange,
  disabled = false,
  id,
  label = 'Reference number',
  className = '',
}: Props) {
  const [data, setData] = useState<SuggestPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(!disabled)
  const helpId = useId()
  const errId = useId()
  const autofillOnce = useRef(false)

  const load = useCallback(() => {
    if (disabled) return
    setErr(null)
    setData(null)
    setLoading(true)
    void api
      .get<SuggestPayload>('/reference-codes/suggested/', { params: { kind } })
      .then((r) => setData(r.data))
      .catch(() => setErr('Could not load the next reference number.'))
      .finally(() => setLoading(false))
  }, [kind, disabled])

  useEffect(() => {
    autofillOnce.current = false
  }, [kind])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (disabled || !data || autofillOnce.current) return
    if (value && value.length > 0) {
      autofillOnce.current = true
      return
    }
    onChange(data.default_code)
    autofillOnce.current = true
  }, [data, value, disabled, onChange])

  const displayValue = value || data?.default_code || ''
  const hint = data
    ? `Assigned automatically on save (format ${data.prefix}-<number>, next ${data.default_code}). Freed numbers are reused.`
    : 'The system assigns the next free reference number when you save.'

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-foreground">
        {label} <span className="text-muted-foreground/70 font-normal">(auto)</span>
      </label>
      {err && (
        <p id={errId} className="text-sm text-warning-foreground mb-2" role="status">
          {err}
          <button
            type="button"
            onClick={() => load()}
            className="ml-2 text-primary hover:underline font-medium"
          >
            Retry
          </button>
        </p>
      )}
      <input
        id={id}
        type="text"
        name={id}
        className="w-full px-3 py-2 border border-border rounded-lg bg-muted/40 text-foreground/85 font-mono"
        value={loading && !displayValue ? 'Loading…' : displayValue}
        readOnly
        aria-busy={loading}
        aria-readonly="true"
        aria-describedby={err ? errId : helpId}
      />
      <p id={helpId} className="mt-1.5 text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  )
}
