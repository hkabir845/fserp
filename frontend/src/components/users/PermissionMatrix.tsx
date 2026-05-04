'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

export type PermItem = { id: string; label: string; group: string }

type Props = {
  catalog: PermItem[]
  selected: string[]
  onChange: (ids: string[]) => void
  idPrefix: string
  className?: string
  listClassName?: string
  showTechnicalIds?: boolean
}

export default function PermissionMatrix({
  catalog,
  selected,
  onChange,
  idPrefix,
  className = '',
  listClassName = 'max-h-60',
  showTechnicalIds = false,
}: Props) {
  const [q, setQ] = useState('')
  const norm = (s: string) => s.toLowerCase().trim()

  const { permGroups, filteredCatalog } = useMemo(() => {
    const qn = norm(q)
    const filtered =
      !qn
        ? catalog
        : catalog.filter(
            (c) => norm(c.label).includes(qn) || norm(c.id).includes(qn) || norm(c.group).includes(qn)
          )
    const groups = Array.from(new Set(filtered.map((c) => c.group)))
    return { permGroups: groups, filteredCatalog: filtered }
  }, [catalog, q])

  const idsInGroup = (g: string) => filteredCatalog.filter((c) => c.group === g).map((c) => c.id)

  const toggle = (id: string) => {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    onChange(Array.from(s))
  }

  const addGroup = (g: string) => {
    const s = new Set([...selected, ...idsInGroup(g)])
    onChange(Array.from(s))
  }

  const removeGroup = (g: string) => {
    const drop = new Set(idsInGroup(g))
    onChange(selected.filter((x) => !drop.has(x)))
  }

  if (catalog.length === 0) {
    return <p className="text-xs text-amber-700">Loading access list…</p>
  }

  return (
    <div className={className}>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search modules…"
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            aria-label="Filter modules"
          />
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onChange(catalog.map((c) => c.id))}
            className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
          >
            Allow all
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
          >
            Deny all
          </button>
        </div>
      </div>
      <p className="mb-2 text-[11px] text-gray-500">
        {selected.length} of {catalog.length} areas allowed
        {q ? ` (filtered: ${filteredCatalog.length} items)` : ''}
      </p>
      <div className={`space-y-3 overflow-y-auto pr-1 ${listClassName}`}>
        {permGroups.map((g) => {
          const items = filteredCatalog.filter((c) => c.group === g)
          if (items.length === 0) return null
          return (
            <div key={g}>
              <div className="flex flex-wrap items-center justify-between gap-1">
                <p className="text-[11px] font-semibold uppercase text-gray-500">{g}</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => addGroup(g)}
                    className="text-[11px] text-indigo-600 hover:underline"
                  >
                    All in group
                  </button>
                  <span className="text-gray-300" aria-hidden>
                    |
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGroup(g)}
                    className="text-[11px] text-gray-500 hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>
              <ul className="mt-1 space-y-1">
                {items.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      id={`${idPrefix}-${c.id}`}
                      checked={selected.includes(c.id)}
                      onChange={() => toggle(c.id)}
                      className="mt-1 h-3.5 w-3.5 rounded border-gray-300"
                    />
                    <label
                      htmlFor={`${idPrefix}-${c.id}`}
                      className="cursor-pointer text-sm"
                      title={showTechnicalIds ? undefined : c.id}
                    >
                      {c.label}
                      {showTechnicalIds ? (
                        <span className="ml-1 font-mono text-[10px] text-gray-400">({c.id})</span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
