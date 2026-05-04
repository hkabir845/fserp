'use client'

import { useState } from 'react'
import {
  is12HourTimeFormat,
  merge12hTo24,
  split24hTo12,
  toHhMmString,
} from '@/utils/companyLocaleFormats'

const MINUTE_OPTS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function init12Parts(hhmm: string): { h: string; m: string; ap: string } {
  const t = toHhMmString(hhmm)
  if (!t) return { h: '', m: '', ap: '' }
  const s = split24hTo12(t)
  if (!s) return { h: '', m: '', ap: '' }
  return { h: String(s.hour12), m: String(s.minute).padStart(2, '0'), ap: s.ap }
}

type TimeOfDayInputProps = {
  value: string
  onChange: (next: string) => void
  timeFormat: string
  className?: string
  id?: string
  disabled?: boolean
  /** 12h mode: extra classes on the outer flex wrapper (e.g. width). */
  wrapperClassName?: string
}

/**
 * Time-of-day field that follows company `time_format` from `/companies/current/`.
 * 24h: native time input. 12h: hour / minute / AM/PM so the UI matches tenant settings, not the browser locale.
 */
export function TimeOfDayInput({
  value,
  onChange,
  timeFormat,
  className,
  wrapperClassName = '',
  id,
  disabled,
}: TimeOfDayInputProps) {
  const is12 = is12HourTimeFormat(timeFormat)
  const [d12, setD12] = useState(() => init12Parts(value))

  if (!is12) {
    return (
      <input
        id={id}
        type="time"
        value={toHhMmString(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${className || ''}`}
        step={60}
      />
    )
  }

  const push = (h: string, m: string, a: string) => {
    setD12({ h, m, ap: a })
    if (h === '' || m === '' || a === '') {
      onChange('')
      return
    }
    const hour = Number(h)
    const min = Number(m)
    if (Number.isNaN(hour) || Number.isNaN(min)) {
      onChange('')
      return
    }
    onChange(merge12hTo24(hour, min, a as 'AM' | 'PM'))
  }

  return (
    <div
      id={id}
      className={`flex min-w-0 max-w-full items-stretch overflow-hidden rounded-lg border border-gray-300 bg-white ${className || ''} ${wrapperClassName}`}
    >
      <label className="sr-only" htmlFor={id ? `${id}-h` : undefined}>
        Hour
      </label>
      <select
        id={id ? `${id}-h` : undefined}
        value={d12.h}
        onChange={(e) => push(e.target.value, d12.m, d12.ap)}
        disabled={disabled}
        className="min-w-0 flex-1 border-0 border-r border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-0"
        aria-label="Hour, 1–12"
      >
        <option value="">—</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={String(h)}>
            {h}
          </option>
        ))}
      </select>
      <span className="flex shrink-0 items-center bg-slate-50 px-0.5 text-sm text-slate-500" aria-hidden>
        :
      </span>
      <label className="sr-only" htmlFor={id ? `${id}-m` : undefined}>
        Minute
      </label>
      <select
        id={id ? `${id}-m` : undefined}
        value={d12.m}
        onChange={(e) => push(d12.h, e.target.value, d12.ap)}
        disabled={disabled}
        className="min-w-0 flex-1 border-0 border-r border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-0"
        aria-label="Minutes"
      >
        <option value="">—</option>
        {MINUTE_OPTS.map((mm) => (
          <option key={mm} value={mm}>
            {mm}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={id ? `${id}-ap` : undefined}>
        AM or PM
      </label>
      <select
        id={id ? `${id}-ap` : undefined}
        value={d12.ap}
        onChange={(e) => push(d12.h, d12.m, e.target.value)}
        disabled={disabled}
        className="min-w-0 flex-1 border-0 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-0"
        aria-label="AM or PM"
      >
        <option value="">—</option>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}
