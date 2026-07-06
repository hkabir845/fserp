'use client'

import { Calendar } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
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
  name?: string
  disabled?: boolean
  required?: boolean
  /** Inclusive minimum calendar day (`YYYY-MM-DD`). */
  min?: string
  /** Inclusive maximum calendar day (`YYYY-MM-DD`). */
  max?: string
  'aria-label'?: string
}

export type CompanyDateInputHandle = {
  /** Parse the visible text into `value` — call before form submit if the user may not have blurred the field. */
  commit: () => boolean
}

const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * Company date field: type dates manually (tenant format) or pick from the calendar.
 * Replaces native `<input type="date">` for consistent locale and keyboard entry.
 */
export const CompanyDateInput = forwardRef<CompanyDateInputHandle, CompanyDateInputProps>(
  function CompanyDateInput(
    {
      value,
      onChange,
      className,
      id,
      name,
      disabled,
      required,
      min,
      max,
      'aria-label': ariaLabel,
    },
    ref
  ) {
    const { dateFormat } = useCompanyLocale()
    const placeholder = dateFormatInputPlaceholder(dateFormat)
    const [text, setText] = useState(() => (value ? formatCompanyDate(value, dateFormat) : ''))
    const [invalid, setInvalid] = useState(false)
    const pickerRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
      setText(value ? formatCompanyDate(value, dateFormat) : '')
      setInvalid(false)
    }, [value, dateFormat])

    const applyIso = useCallback(
      (iso: string) => {
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
      [dateFormat, max, min, onChange]
    )

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
        return applyIso(iso)
      },
      [applyIso, dateFormat, onChange, required, text]
    )

    useImperativeHandle(ref, () => ({ commit: () => commit() }), [commit])

    const openPicker = () => {
      if (disabled) return
      const el = pickerRef.current
      if (!el) return
      if (typeof el.showPicker === 'function') {
        try {
          el.showPicker()
          return
        } catch {
          /* fall through */
        }
      }
      el.focus()
    }

    const pickerValue = ISO_YMD.test(value) ? value : ''

    const invalidTitle =
      invalid &&
      (min || max
        ? `Enter a valid date as ${placeholder}${min ? ` (from ${formatCompanyDate(min, dateFormat)})` : ''}${max ? ` (through ${formatCompanyDate(max, dateFormat)})` : ''}`
        : `Enter a valid date as ${placeholder}`)

    return (
      <div className="relative inline-flex w-full min-w-0 max-w-full items-center">
        <input
          id={id}
          name={name}
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
          aria-label={ariaLabel}
          title={invalidTitle || undefined}
          className={`min-w-0 flex-1 pr-10 ${invalid ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/30' : ''} ${className || ''}`}
        />
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={pickerValue}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => {
            const iso = e.target.value
            if (!iso) return
            applyIso(iso)
          }}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={openPicker}
          className="absolute right-0 top-0 flex h-full items-center justify-center rounded-r-md px-2.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label={ariaLabel ? `${ariaLabel} — calendar` : 'Open calendar'}
          tabIndex={-1}
        >
          <Calendar className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      </div>
    )
  }
)
