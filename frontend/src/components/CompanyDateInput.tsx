'use client'

import { useEffect, useState } from 'react'
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
}

/**
 * Date field that follows company `date_format` from `/companies/current/`.
 * Native `<input type="date">` uses the browser locale (often MM/DD/YY on en-US systems),
 * so this uses a text field formatted and parsed with tenant settings instead.
 */
export function CompanyDateInput({
  value,
  onChange,
  className,
  id,
  disabled,
  required,
}: CompanyDateInputProps) {
  const { dateFormat } = useCompanyLocale()
  const placeholder = dateFormatInputPlaceholder(dateFormat)
  const [text, setText] = useState(() => (value ? formatCompanyDate(value, dateFormat) : ''))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setText(value ? formatCompanyDate(value, dateFormat) : '')
    setInvalid(false)
  }, [value, dateFormat])

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      setInvalid(false)
      onChange('')
      return
    }
    const iso = parseCompanyDate(trimmed, dateFormat)
    if (!iso) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onChange(iso)
    setText(formatCompanyDate(iso, dateFormat))
  }

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
      onBlur={() => commit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(text)
        }
      }}
      disabled={disabled}
      required={required}
      aria-invalid={invalid || undefined}
      title={invalid ? `Enter a valid date as ${placeholder}` : undefined}
      className={`${invalid ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/30' : ''} ${className || ''}`}
    />
  )
}
