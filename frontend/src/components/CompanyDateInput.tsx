'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import {
  dateFormatInputPlaceholder,
  formatCompanyDate,
  parseCompanyDate,
} from '@/utils/companyLocaleFormats'

type CompanyDateInputProps = {
  /** Calendar day for the API (`YYYY-MM-DD`). */
  value: string
  onChange: (isoYmd: string) => void
  className?: string
  id?: string
  disabled?: boolean
  required?: boolean
  /** Inclusive minimum calendar day (`YYYY-MM-DD`). */
  min?: string
  /** Inclusive maximum calendar day (`YYYY-MM-DD`). */
  max?: string
}

export type CompanyDateInputHandle = {
  /** Parse the visible text into `value` — call before form submit if the user may not have blurred the field. */
  commit: () => boolean
}

/**
 * Date field that follows company `date_format` from `/companies/current/`.
 * Native `<input type="date">` uses the browser locale (often MM/DD/YY on en-US systems),
 * so this uses a text field formatted and parsed with tenant settings instead.
 */
export const CompanyDateInput = forwardRef<CompanyDateInputHandle, CompanyDateInputProps>(
  function CompanyDateInput(
    { value, onChange, className, id, disabled, required, min, max },
    ref
  ) {
    const { dateFormat } = useCompanyLocale()
    const placeholder = dateFormatInputPlaceholder(dateFormat)
    const [text, setText] = useState(() => (value ? formatCompanyDate(value, dateFormat) : ''))
    const [invalid, setInvalid] = useState(false)

    useEffect(() => {
      setText(value ? formatCompanyDate(value, dateFormat) : '')
      setInvalid(false)
    }, [value, dateFormat])

    const commit = useCallback(
      (raw?: string) => {
        const trimmed = (raw ?? text).trim()
        if (!trimmed) {
          if (required) {
            setInvalid(true)
            return false
          }
          setInvalid(false)
          onChange('')
          return true
        }
        const iso = parseCompanyDate(trimmed, dateFormat)
        if (!iso) {
          setInvalid(true)
          return false
        }
        if (min && iso < min) {
          setInvalid(true)
          return false
        }
        if (max && iso > max) {
          setInvalid(true)
          return false
        }
        setInvalid(false)
        onChange(iso)
        setText(formatCompanyDate(iso, dateFormat))
        return true
      },
      [text, dateFormat, onChange, required, min, max]
    )

    useImperativeHandle(ref, () => ({ commit: () => commit() }), [commit])

    return (
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setInvalid(false)
        }}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || undefined}
        title={
          invalid
            ? min || max
              ? `Enter a valid date as ${placeholder}${min ? ` (from ${formatCompanyDate(min, dateFormat)})` : ''}${max ? ` (through ${formatCompanyDate(max, dateFormat)})` : ''}`
              : `Enter a valid date as ${placeholder}`
            : undefined
        }
        className={`${invalid ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/30' : ''} ${className || ''}`}
      />
    )
  }
)
