'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { productOptionLabel } from '@/lib/aquacultureMedicineUnits'
import { isBuiltinMedicineSku } from './medicineUtils'

export type MedicineCatalogItem = {
  id: number
  name: string
  unit?: string
  category?: string
  item_number?: string
}

type PickerOption = {
  id: number
  label: string
  searchText: string
  group: 'builtin' | 'other'
}

const MAX_PER_GROUP = 80

function normalizeSearch(s: string): string {
  return s.trim().toLowerCase()
}

function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeSearch(query)
  if (!q) return true
  const h = haystack.toLowerCase()
  return q.split(/\s+/).every((token) => token.length > 0 && h.includes(token))
}

function buildSearchText(item: MedicineCatalogItem): string {
  return `${item.name} ${item.item_number || ''} ${item.category || ''} ${item.unit || ''}`
}

type Props = {
  items: MedicineCatalogItem[]
  value: string
  onChange: (itemId: string) => void
  onPick?: (itemId: string) => void
  className?: string
  placeholder?: string
}

export function MedicineProductSelect({
  items,
  value,
  onChange,
  onPick,
  className = '',
  placeholder = 'Type or select medicine…',
}: Props) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  const selectedItem = useMemo(() => {
    const id = value.trim() !== '' ? Number.parseInt(value, 10) : NaN
    return Number.isFinite(id) ? items.find((i) => i.id === id) : undefined
  }, [value, items])

  const selectedLabel = selectedItem
    ? productOptionLabel(selectedItem.name, selectedItem.unit)
    : ''

  const { builtinOptions, otherOptions, flatOptions } = useMemo(() => {
    const builtin: PickerOption[] = []
    const other: PickerOption[] = []
    for (const item of items) {
      const searchText = buildSearchText(item)
      if (!matchesQuery(searchText, query)) continue
      const opt: PickerOption = {
        id: item.id,
        label: productOptionLabel(item.name, item.unit),
        searchText,
        group: isBuiltinMedicineSku(item.item_number) ? 'builtin' : 'other',
      }
      if (opt.group === 'builtin') {
        if (builtin.length < MAX_PER_GROUP) builtin.push(opt)
      } else if (other.length < MAX_PER_GROUP) {
        other.push(opt)
      }
    }
    return {
      builtinOptions: builtin,
      otherOptions: other,
      flatOptions: [...builtin, ...other],
    }
  }, [items, query])

  const trimmedQuery = normalizeSearch(query)
  const builtinTruncated =
    trimmedQuery === '' &&
    items.filter((i) => isBuiltinMedicineSku(i.item_number)).length > MAX_PER_GROUP &&
    builtinOptions.length >= MAX_PER_GROUP
  const otherTruncated =
    trimmedQuery === '' &&
    items.filter((i) => !isBuiltinMedicineSku(i.item_number)).length > MAX_PER_GROUP &&
    otherOptions.length >= MAX_PER_GROUP

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
  }, [])

  const pick = useCallback(
    (opt: PickerOption) => {
      const id = String(opt.id)
      onChange(id)
      onPick?.(id)
      close()
      inputRef.current?.blur()
    },
    [close, onChange, onPick],
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
    setActiveIndex(flatOptions.length > 0 ? 0 : -1)
  }, [open, query, flatOptions.length])

  const inputDisplay = open ? query : selectedLabel
  const showBuiltinGroup = builtinOptions.length > 0
  const showOtherGroup = otherOptions.length > 0

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={inputDisplay}
          className={`${className} pr-8`}
          onFocus={() => {
            setOpen(true)
            setQuery(selectedLabel)
            requestAnimationFrame(() => inputRef.current?.select())
          }}
          onChange={(e) => {
            setOpen(true)
            setQuery(e.target.value)
            if (value.trim()) onChange('')
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
              setActiveIndex((i) => (flatOptions.length === 0 ? -1 : Math.min(i + 1, flatOptions.length - 1)))
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex((i) => (flatOptions.length === 0 ? -1 : Math.max(i - 1, 0)))
              return
            }
            if (e.key === 'Enter') {
              if (!open || activeIndex < 0 || !flatOptions[activeIndex]) return
              e.preventDefault()
              pick(flatOptions[activeIndex])
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show medicine products"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
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
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full min-w-[16rem] overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {flatOptions.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">
              No matches. Try another word from the product name or SKU.
            </li>
          ) : (
            <>
              {showBuiltinGroup ? (
                <li className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                  Standard pond care (built-in)
                  {builtinTruncated ? ` · first ${MAX_PER_GROUP} — type to narrow` : ''}
                </li>
              ) : null}
              {builtinOptions.map((opt, idx) => {
                const flatIdx = idx
                const active = flatIdx === activeIndex
                return (
                  <li
                    key={`builtin-${opt.id}`}
                    role="option"
                    aria-selected={active}
                    className={`cursor-pointer px-3 py-1.5 truncate ${
                      active ? 'bg-teal-50 text-teal-950' : 'text-slate-900 hover:bg-slate-50'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(flatIdx)}
                    onClick={() => pick(opt)}
                  >
                    {opt.label}
                  </li>
                )
              })}
              {showOtherGroup ? (
                <li
                  className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 ${
                    showBuiltinGroup ? 'mt-1 border-t border-slate-100' : ''
                  }`}
                >
                  {showBuiltinGroup ? 'Other medicine & treatment' : 'Medicine & treatment'}
                  {otherTruncated ? ` · first ${MAX_PER_GROUP} — type to narrow` : ''}
                </li>
              ) : null}
              {otherOptions.map((opt, idx) => {
                const flatIdx = builtinOptions.length + idx
                const active = flatIdx === activeIndex
                return (
                  <li
                    key={`other-${opt.id}`}
                    role="option"
                    aria-selected={active}
                    className={`cursor-pointer px-3 py-1.5 truncate ${
                      active ? 'bg-teal-50 text-teal-950' : 'text-slate-900 hover:bg-slate-50'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(flatIdx)}
                    onClick={() => pick(opt)}
                  >
                    {opt.label}
                  </li>
                )
              })}
            </>
          )}
        </ul>
      )}
    </div>
  )
}
