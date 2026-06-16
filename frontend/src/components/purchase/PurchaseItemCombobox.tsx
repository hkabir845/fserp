'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

export type PoItemOption = {
  id: number
  sku: string
  name: string
  type: string
  uom?: { id: number; code: string; name: string } | null
}

type Props = {
  items: PoItemOption[]
  value: number | null
  onChange: (itemId: number | null) => void
  placeholder?: string
  disabledIds?: Set<number>
}

export function PurchaseItemCombobox({
  items,
  value,
  onChange,
  placeholder = 'Search by SKU or name…',
  disabledIds,
}: Props) {
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = useMemo(() => items.find((i) => i.id === value) ?? null, [items, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = items
    if (!q) return list.slice(0, 120)
    return list
      .filter((i) => `${i.sku} ${i.name}`.toLowerCase().includes(q))
      .slice(0, 200)
  }, [items, query])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = useCallback(
    (id: number) => {
      if (disabledIds?.has(id)) return
      onChange(id)
      setOpen(false)
      setQuery('')
      inputRef.current?.blur()
    },
    [onChange, disabledIds]
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div ref={wrapRef} className="relative w-full">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((o) => !o)
          if (!open) {
            setTimeout(() => inputRef.current?.focus(), 0)
          }
        }}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-left text-sm shadow-sm ring-indigo-500/0 transition hover:border-gray-400 focus-visible:outline focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className="min-w-0 flex-1 truncate text-gray-900">
          {selected ? (
            <>
              <span className="font-medium tabular-nums text-gray-600">{selected.sku}</span>
              <span className="mx-1.5 text-gray-300">·</span>
              <span>{selected.name}</span>
              {selected.uom?.code ? (
                <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-900">
                  {selected.uom.code}
                </span>
              ) : null}
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                {selected.type.replace('_', ' ')}
              </span>
            </>
          ) : (
            <span className="text-gray-500">{placeholder}</span>
          )}
        </span>
        <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5"
        >
          <div className="border-b border-gray-100 p-2">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              autoComplete="off"
              autoCorrect="off"
            />
            <p className="mt-1.5 px-1 text-[11px] text-gray-500">
              {items.length} purchasable items · showing {filtered.length}
            </p>
          </div>
          <ul className="max-h-[min(320px,50vh)] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-gray-500">No matches. Try another search.</li>
            ) : (
              filtered.map((i) => {
                const dis = disabledIds?.has(i.id)
                return (
                  <li key={i.id} role="option" aria-selected={value === i.id} aria-disabled={dis}>
                    <button
                      type="button"
                      disabled={dis}
                      onClick={() => pick(i.id)}
                      className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="shrink-0 font-mono text-xs font-semibold text-indigo-700">{i.sku}</span>
                      <span className="min-w-0 flex-1 leading-snug text-gray-900">{i.name}</span>
                      {i.uom?.code ? (
                        <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-900">
                          {i.uom.code}
                        </span>
                      ) : null}
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                        {i.type.replace('_', ' ')}
                      </span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}

      {selected && (
        <button
          type="button"
          className="mt-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          onClick={() => onChange(null)}
        >
          Clear selection
        </button>
      )}
    </div>
  )
}
