'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Package, Receipt } from 'lucide-react'
import { formatCoaOptionLabel, type CoaLike } from '@/utils/coaOptionLabel'
import { formatNumber } from '@/utils/currency'
import { safeSelectInput } from '@/utils/safeSelectInput'

export type BillLineKind = 'item' | 'expense'

export type BillLineSelectItem = {
  id: number
  item_number: string
  name: string
  pos_category?: string
  pieces_per_kg?: number | string | null
}

export type BillLineSelectAccount = CoaLike & {
  id: number
}

type PickerOption =
  | { kind: 'item'; id: number; label: string; searchText: string }
  | { kind: 'account'; id: number; label: string; searchText: string }

const MAX_PER_GROUP = 60

function normalizeSearch(s: string): string {
  return s.trim().toLowerCase()
}

function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeSearch(query)
  if (!q) return true
  const h = haystack.toLowerCase()
  return q.split(/\s+/).every((token) => token.length > 0 && h.includes(token))
}

function itemPiecesPerKg(item: BillLineSelectItem): number | null {
  const raw = item.pieces_per_kg
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function isFishTypeItem(item: BillLineSelectItem): boolean {
  return (item.pos_category || '').toLowerCase() === 'fish'
}

function fishItemOptionLabel(item: BillLineSelectItem): string {
  const base = `${item.name} (${item.item_number})`
  if (!isFishTypeItem(item)) return base
  const pcs = itemPiecesPerKg(item)
  return pcs != null ? `${base} · Line ${formatNumber(pcs)} pcs/kg` : base
}

function buildItemSearchText(item: BillLineSelectItem): string {
  return `${item.name} ${item.item_number} ${item.pos_category || ''}`
}

function buildAccountSearchText(account: BillLineSelectAccount): string {
  return `${account.account_code || ''} ${account.account_name || ''} ${account.account_type || ''} ${
    account.account_sub_type || ''
  }`
}

type Props = {
  items: BillLineSelectItem[]
  expenseAccounts: BillLineSelectAccount[]
  itemId?: number
  expenseAccountId?: number
  onSelectItem: (itemId: number) => void
  onSelectAccount: (accountId: number) => void
  className?: string
  placeholder?: string
  /**
   * Restrict the dropdown to one source so Item lines and Expense lines stay clearly separate
   * (QuickBooks-style). 'item' shows only catalog products/services, 'expense' only chart
   * accounts, 'both' (default) merges them for backward compatibility.
   */
  mode?: 'item' | 'expense' | 'both'
}

export function BillLineItemSelect({
  items,
  expenseAccounts,
  itemId,
  expenseAccountId,
  onSelectItem,
  onSelectAccount,
  className = '',
  placeholder = 'Select or type to search…',
  mode = 'both',
}: Props) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  const selectedLabel = useMemo(() => {
    if (itemId) {
      const item = items.find((i) => i.id === itemId)
      if (item) return fishItemOptionLabel(item)
    }
    if (expenseAccountId) {
      const account = expenseAccounts.find((a) => a.id === expenseAccountId)
      if (account) return formatCoaOptionLabel(account)
    }
    return ''
  }, [itemId, expenseAccountId, items, expenseAccounts])

  const { itemOptions, accountOptions, flatOptions } = useMemo(() => {
    const itemOpts: PickerOption[] = []
    if (mode !== 'expense') {
      for (const item of items) {
        const searchText = buildItemSearchText(item)
        if (!matchesQuery(searchText, query)) continue
        itemOpts.push({
          kind: 'item',
          id: item.id,
          label: fishItemOptionLabel(item),
          searchText,
        })
        if (itemOpts.length >= MAX_PER_GROUP) break
      }
    }

    const accountOpts: PickerOption[] = []
    if (mode !== 'item') {
      for (const account of expenseAccounts) {
        const searchText = buildAccountSearchText(account)
        if (!matchesQuery(searchText, query)) continue
        accountOpts.push({
          kind: 'account',
          id: account.id,
          label: formatCoaOptionLabel(account),
          searchText,
        })
        if (accountOpts.length >= MAX_PER_GROUP) break
      }
    }

    return {
      itemOptions: itemOpts,
      accountOptions: accountOpts,
      flatOptions: [...itemOpts, ...accountOpts],
    }
  }, [items, expenseAccounts, query, mode])

  const trimmedQuery = normalizeSearch(query)
  const itemsTruncated = trimmedQuery === '' && items.length > MAX_PER_GROUP && itemOptions.length >= MAX_PER_GROUP
  const accountsTruncated =
    trimmedQuery === '' &&
    expenseAccounts.length > MAX_PER_GROUP &&
    accountOptions.length >= MAX_PER_GROUP

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
  }, [])

  const pick = useCallback(
    (opt: PickerOption) => {
      if (opt.kind === 'item') onSelectItem(opt.id)
      else onSelectAccount(opt.id)
      close()
      inputRef.current?.blur()
    },
    [close, onSelectAccount, onSelectItem]
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
          aria-label="Show options"
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
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
          className="absolute z-50 mt-1 max-h-56 w-full min-w-[16rem] overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {flatOptions.length === 0 ? (
            <li className="px-3 py-2 text-gray-500">No matches. Try another word from the name or number.</li>
          ) : (
            <>
              {itemOptions.length > 0 && (
                <li className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  Items
                  {itemsTruncated ? ` (first ${MAX_PER_GROUP} — type to narrow)` : ''}
                </li>
              )}
              {itemOptions.map((opt, idx) => {
                const flatIdx = idx
                const active = flatIdx === activeIndex
                return (
                  <li
                    key={`item-${opt.id}`}
                    role="option"
                    aria-selected={active}
                    className={`cursor-pointer px-3 py-1.5 truncate ${
                      active ? 'bg-blue-50 text-blue-900' : 'text-gray-900 hover:bg-gray-50'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(flatIdx)}
                    onClick={() => pick(opt)}
                  >
                    {opt.label}
                  </li>
                )
              })}
              {accountOptions.length > 0 && (
                <li className="mt-1 border-t border-gray-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  Expense accounts
                  {accountsTruncated ? ` (first ${MAX_PER_GROUP} — type to narrow)` : ''}
                </li>
              )}
              {accountOptions.map((opt, idx) => {
                const flatIdx = itemOptions.length + idx
                const active = flatIdx === activeIndex
                return (
                  <li
                    key={`account-${opt.id}`}
                    role="option"
                    aria-selected={active}
                    className={`cursor-pointer px-3 py-1.5 truncate ${
                      active ? 'bg-blue-50 text-blue-900' : 'text-gray-900 hover:bg-gray-50'
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

type TypePickerProps = {
  kind: BillLineKind
  items: BillLineSelectItem[]
  expenseAccounts: BillLineSelectAccount[]
  itemId?: number
  expenseAccountId?: number
  onChangeKind: (kind: BillLineKind) => void
  onSelectItem: (itemId: number) => void
  onSelectAccount: (accountId: number) => void
  className?: string
  /** Optional helper text / hints rendered under the selector. */
  children?: ReactNode
}

/**
 * QuickBooks-style line entry: a segmented "Item vs Expense" toggle on top of a scoped picker.
 * Item lines pick a catalog product/service; Expense lines pick a chart-of-accounts expense
 * account (auto-suggested elsewhere, always editable here). One bill can mix both kinds.
 */
export function BillLineTypePicker({
  kind,
  items,
  expenseAccounts,
  itemId,
  expenseAccountId,
  onChangeKind,
  onSelectItem,
  onSelectAccount,
  className = '',
  children,
}: TypePickerProps) {
  const isItem = kind === 'item'
  const baseBtn =
    'relative z-10 flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium transition-colors'
  return (
    <div className="min-w-0">
      <div
        role="tablist"
        aria-label="Line type"
        className="relative mb-1 flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
      >
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded bg-blue-600 shadow-sm transition-transform duration-200 ease-out ${
            isItem ? 'translate-x-0' : 'translate-x-full'
          }`}
        />
        <button
          type="button"
          role="tab"
          aria-selected={isItem}
          onClick={() => !isItem && onChangeKind('item')}
          className={`${baseBtn} rounded ${
            isItem ? 'text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          Item
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isItem}
          onClick={() => isItem && onChangeKind('expense')}
          className={`${baseBtn} rounded ${
            !isItem ? 'text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Receipt className="h-3.5 w-3.5" />
          Expense
        </button>
      </div>
      <BillLineItemSelect
        items={items}
        expenseAccounts={expenseAccounts}
        itemId={isItem ? itemId : undefined}
        expenseAccountId={isItem ? undefined : expenseAccountId}
        mode={isItem ? 'item' : 'expense'}
        className={className}
        placeholder={isItem ? 'Search products / services…' : 'Search expense accounts…'}
        onSelectItem={onSelectItem}
        onSelectAccount={onSelectAccount}
      />
      {children}
    </div>
  )
}
