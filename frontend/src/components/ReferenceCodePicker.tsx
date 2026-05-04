'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import api from '@/lib/api'

export type ReferenceCodeKind = 'nozzle' | 'customer' | 'vendor' | 'item' | 'tank' | 'employee'

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

const KIND_EMPLOYEE: ReferenceCodeKind = 'employee'

/**
 * Suggested reference codes: editable text (standard ERP pattern) with
 * quick-pick suggestions via datalist. The server is authoritative for
 * format rules (except employees, which accept any unique code). Leave the
 * field empty to use automatic assignment when the API allows it.
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
  const listId = useId()
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
      .catch(() => setErr('Could not load suggestions. You can still type a code or leave the field empty for the next free number.'))
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

  if (disabled) {
    return (
      <div className={className}>
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-2">
          {label}
        </label>
        <input
          id={id}
          type="text"
          value={value}
          readOnly
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
        />
      </div>
    )
  }

  const isEmployee = kind === KIND_EMPLOYEE
  const hasSuggestions = Boolean(data?.choice_codes?.length)
  const listOptions = data?.choice_codes && data.choice_codes.length > 0 ? data.choice_codes : data ? [data.default_code] : []
  const placeholder =
    data?.default_code && !isEmployee
      ? data.default_code
      : isEmployee
        ? 'e.g. EMP-00001 or a unique code'
        : 'PREFIX-1'
  const hint = data
    ? isEmployee
      ? `Use the suggested form (e.g. ${data.default_code}) or any other unique code. Or clear the field to auto-assign.`
      : `Format: ${data.prefix}-<number> (example ${data.default_code}). Clear the field to let the system assign the next free number.`
    : isEmployee
      ? 'Enter a unique employee code, or leave empty to auto-assign.'
      : 'Enter a code in the form PREFIX-123, or leave empty to auto-assign.'

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-2">
        {label} <span className="text-gray-400 font-normal">(suggested, editable)</span>
      </label>
      {err && (
        <p id={errId} className="text-sm text-amber-800 mb-2" role="status">
          {err}
          <button
            type="button"
            onClick={() => load()}
            className="ml-2 text-blue-600 hover:underline font-medium"
          >
            Retry
          </button>
        </p>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          id={id}
          type="text"
          name={id}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={loading && !value ? 'Loading…' : placeholder}
          list={hasSuggestions && !err ? listId : undefined}
          autoComplete="off"
          spellCheck={false}
          aria-busy={loading}
          aria-invalid={err ? 'true' : undefined}
          aria-describedby={err ? errId : helpId}
        />
        {data && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="shrink-0 text-sm text-gray-600 hover:text-gray-900 px-2 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50"
          >
            Clear (auto-assign)
          </button>
        )}
      </div>
      {hasSuggestions && !err && (
        <datalist id={listId}>
          {listOptions.map((code) => (
            <option key={code} value={code} />
          ))}
        </datalist>
      )}
      <p id={helpId} className="mt-1.5 text-xs text-gray-500">
        {hint}
      </p>
      {data && data.used_suffixes.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">In use: suffixes {data.used_suffixes.join(', ')}</p>
      )}
    </div>
  )
}
