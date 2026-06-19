'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { safeSelectInput } from '@/utils/safeSelectInput'

export type GroupedComboboxOption = {
  value: string
  label: string
  searchText?: string
  description?: string
  disabled?: boolean
  title?: string
}

export type GroupedComboboxGroup = {
  label: string
  options: GroupedComboboxOption[]
}

type FlatRow =
  | { kind: 'header'; label: string }
  | { kind: 'option'; option: GroupedComboboxOption; flatIndex: number }

function normalizeSearch(s: string): string {
  return s.trim().toLowerCase()
}

function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeSearch(query)
  if (!q) return true
  const h = haystack.toLowerCase()
  return q.split(/\s+/).every((token) => token.length > 0 && h.includes(token))
}

export function SearchableGroupedCombobox({
  value,
  onChange,
  groups,
  emptyOption,
  className = 'w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500',
  listClassName = 'left-0 z-50 mt-1 max-h-72 w-max min-w-full max-w-[min(42rem,calc(100vw-2rem))] overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg',
  id,
  placeholder = 'Search or select…',
}: {
  value: string
  onChange: (value: string) => void
  groups: GroupedComboboxGroup[]
  emptyOption?: { value: string; label: string } | null
  className?: string
  listClassName?: string
  id?: string
  placeholder?: string
}) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  const allOptions = useMemo(() => {
    const opts: GroupedComboboxOption[] = []
    if (emptyOption) opts.push({ value: emptyOption.value, label: emptyOption.label })
    for (const g of groups) opts.push(...g.options)
    return opts
  }, [groups, emptyOption])

  const selectedLabel = useMemo(() => {
    if (emptyOption && value === emptyOption.value) return emptyOption.label
    const hit = allOptions.find((o) => o.value === value && (!emptyOption || o.value !== emptyOption.value))
    return hit?.label || ''
  }, [allOptions, emptyOption, value])

  const { flatRows, selectableOptions } = useMemo(() => {
    const selectable: GroupedComboboxOption[] = []
    const rows: FlatRow[] = []
    let flatIndex = 0

    const pushOption = (opt: GroupedComboboxOption) => {
      const searchText = opt.searchText ?? opt.label
      if (!matchesQuery(searchText, query)) return
      if (opt.disabled) {
        rows.push({ kind: 'option', option: opt, flatIndex: -1 })
        return
      }
      rows.push({ kind: 'option', option: opt, flatIndex })
      selectable.push(opt)
      flatIndex += 1
    }

    if (emptyOption && matchesQuery(emptyOption.label, query)) {
      pushOption({ value: emptyOption.value, label: emptyOption.label })
    }

    for (const group of groups) {
      const visible = group.options.filter((opt) =>
        matchesQuery(opt.searchText ?? opt.label, query)
      )
      if (visible.length === 0) continue
      rows.push({ kind: 'header', label: group.label })
      for (const opt of visible) pushOption(opt)
    }

    return { flatRows: rows, selectableOptions: selectable }
  }, [groups, emptyOption, query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
  }, [])

  const pick = useCallback(
    (opt: GroupedComboboxOption) => {
      if (opt.disabled) return
      onChange(opt.value)
      close()
      inputRef.current?.blur()
    },
    [close, onChange]
  )

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open, close])

  useEffect(() => {
    if (!open) return
    setActiveIndex(selectableOptions.length > 0 ? 0 : -1)
  }, [open, query, selectableOptions.length])

  const inputDisplay = open ? query : selectedLabel || ''

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={inputDisplay}
          title={selectedLabel || placeholder}
          className={`${className} pr-8 ${open ? '' : 'truncate'}`}
          onFocus={(e) => {
            setOpen(true)
            setQuery(selectedLabel)
            safeSelectInput(e.currentTarget)
          }}
          onChange={(e) => {
            setOpen(true)
            setQuery(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
              inputRef.current?.blur()
              return
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (!open) setOpen(true)
              setActiveIndex((i) =>
                selectableOptions.length === 0 ? -1 : Math.min(i + 1, selectableOptions.length - 1)
              )
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex((i) => (selectableOptions.length === 0 ? -1 : Math.max(i - 1, 0)))
              return
            }
            if (e.key === 'Enter') {
              if (!open || activeIndex < 0 || !selectableOptions[activeIndex]) return
              e.preventDefault()
              pick(selectableOptions[activeIndex])
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show options"
          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) {
              close()
              inputRef.current?.blur()
            } else {
              setOpen(true)
              setQuery('')
              inputRef.current?.focus()
            }
          }}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className={`absolute ${listClassName}`}
        >
          {flatRows.length === 0 ? (
            <li className="px-3 py-2 text-gray-500">No matches. Try another search.</li>
          ) : (
            flatRows.map((row, idx) => {
              if (row.kind === 'header') {
                return (
                  <li
                    key={`h-${row.label}-${idx}`}
                    className="mt-1 border-t border-gray-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 first:mt-0 first:border-t-0"
                  >
                    {row.label}
                  </li>
                )
              }
              const opt = row.option
              const active = !opt.disabled && row.flatIndex === activeIndex
              return (
                <li
                  key={`${opt.value}-${idx}`}
                  role="option"
                  aria-selected={active}
                  aria-disabled={opt.disabled}
                  title={opt.title}
                  className={`cursor-pointer px-3 py-1.5 ${
                    opt.disabled ? 'cursor-not-allowed opacity-40' : ''
                  } ${active ? 'bg-blue-50 text-blue-900' : 'text-gray-900 hover:bg-gray-50'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => {
                    if (row.flatIndex >= 0) setActiveIndex(row.flatIndex)
                  }}
                  onClick={() => pick(opt)}
                >
                  <div className="whitespace-normal break-words leading-snug">{opt.label}</div>
                  {opt.description ? (
                    <div className="mt-0.5 whitespace-normal break-words text-xs leading-snug text-gray-500">
                      {opt.description}
                    </div>
                  ) : null}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
