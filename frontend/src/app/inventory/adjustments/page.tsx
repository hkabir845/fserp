'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import PageLayout from '@/components/PageLayout'
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'

const inputClassName =
  'w-full min-h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const selectClassName = inputClassName
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow hover:opacity-90 disabled:opacity-50'
const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted/60 disabled:opacity-50'
const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/20 disabled:opacity-50'

const REASONS: { value: string; label: string }[] = [
  { value: 'count', label: 'Stock count / cycle count' },
  { value: 'damage', label: 'Damage / breakage' },
  { value: 'theft', label: 'Theft / loss' },
  { value: 'expiry', label: 'Expiry / spoilage' },
  { value: 'other', label: 'Other' },
]

type Station = { id: number; station_name: string; is_active?: boolean }
type PosItem = { id: number; name: string; item_number?: string }

type AdjustmentLine = {
  id: number
  item_id: number
  item_name: string
  unit: string
  counted_quantity: string
  book_quantity: string | null
  unit_cost: string | null
}

type AdjustmentRecord = {
  id: number
  adjustment_number: string
  adjustment_date: string
  status: string
  reason: string
  memo?: string
  station_id: number
  station_name: string
  posted_at?: string | null
  auto_journal_entry_number?: string | null
  lines: AdjustmentLine[]
}

type FormLine = { itemId: string; counted: string; book: string | null }

function reasonLabel(value: string): string {
  return REASONS.find((r) => r.value === value)?.label || value
}

function fmtQty(raw: string | null | undefined): string {
  if (raw == null || raw === '') return '—'
  const n = Number(raw)
  if (!Number.isFinite(n)) return String(raw)
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export default function InventoryAdjustmentsPage() {
  const { success, error } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [stations, setStations] = useState<Station[]>([])
  const [items, setItems] = useState<PosItem[]>([])
  const [records, setRecords] = useState<AdjustmentRecord[]>([])

  const [stationId, setStationId] = useState<string>('')
  const [reason, setReason] = useState<string>('count')
  const [memo, setMemo] = useState<string>('')
  const [lines, setLines] = useState<FormLine[]>([{ itemId: '', counted: '', book: null }])

  // Cache of per-station book quantities, keyed by `${itemId}` → { stationId: qty }
  const [bookCache, setBookCache] = useState<Record<string, Record<string, string>>>({})

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [st, it, rec] = await Promise.all([
        api.get('/stations/'),
        api.get('/items/', { params: { pos_only: 'true' } }),
        api.get('/inventory/adjustments/'),
      ])
      const stationsRaw: Station[] = Array.isArray(st.data) ? st.data : st.data?.results || []
      const activeStations = stationsRaw.filter((s) => s.is_active !== false)
      setStations(activeStations)
      setItems(Array.isArray(it.data) ? it.data : it.data?.results || [])
      setRecords(Array.isArray(rec.data) ? rec.data : [])
      if (activeStations.length && !stationId) setStationId(String(activeStations[0].id))
    } catch (e) {
      error(extractErrorMessage(e) || 'Failed to load inventory adjustments')
    } finally {
      setLoading(false)
    }
  }, [error, stationId])

  useEffect(() => {
    loadAll()
  }, [])

  const fetchBook = useCallback(
    async (itemId: string): Promise<Record<string, string>> => {
      if (!itemId) return {}
      if (bookCache[itemId]) return bookCache[itemId]
      try {
        const r = await api.get('/inventory/availability/', { params: { item_id: itemId } })
        const map: Record<string, string> = {}
        if (r.data?.tracks_per_station && Array.isArray(r.data.stations)) {
          for (const s of r.data.stations) map[String(s.station_id)] = String(s.quantity)
        }
        setBookCache((prev) => ({ ...prev, [itemId]: map }))
        return map
      } catch {
        return {}
      }
    },
    [bookCache]
  )

  // Resolve the book quantity for each line at the chosen station.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const next = await Promise.all(
        lines.map(async (ln) => {
          if (!ln.itemId || !stationId) return { ...ln, book: null }
          const map = await fetchBook(ln.itemId)
          return { ...ln, book: map[stationId] ?? '0' }
        })
      )
      if (!cancelled) setLines((cur) => (cur.length === next.length ? next : cur))
    })()
    return () => {
      cancelled = true
    }
  }, [stationId, JSON.stringify(lines.map((l) => l.itemId)), bookCache])

  const updateLine = (idx: number, patch: Partial<FormLine>) =>
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const addLine = () => setLines((cur) => [...cur, { itemId: '', counted: '', book: null }])
  const removeLine = (idx: number) =>
    setLines((cur) => (cur.length <= 1 ? cur : cur.filter((_, i) => i !== idx)))

  const resetForm = () => {
    setReason('count')
    setMemo('')
    setLines([{ itemId: '', counted: '', book: null }])
  }

  const usedItemIds = useMemo(() => new Set(lines.map((l) => l.itemId).filter(Boolean)), [lines])

  const saveAndPost = async () => {
    if (!stationId) {
      error('Select a station to count.')
      return
    }
    const payloadLines = lines
      .filter((l) => l.itemId && l.counted.trim() !== '')
      .map((l) => ({ item_id: Number(l.itemId), counted_quantity: l.counted.trim() }))
    if (!payloadLines.length) {
      error('Add at least one item with a counted quantity.')
      return
    }
    setSaving(true)
    try {
      const created = await api.post('/inventory/adjustments/', {
        station_id: Number(stationId),
        reason,
        memo,
        lines: payloadLines,
      })
      const id = created.data?.id
      await api.post(`/inventory/adjustments/${id}/`)
      success('Stock adjustment posted and variance booked to the ledger.')
      resetForm()
      setBookCache({})
      await loadAll()
    } catch (e) {
      error(extractErrorMessage(e) || 'Could not post the adjustment')
    } finally {
      setSaving(false)
    }
  }

  const unpost = async (id: number) => {
    setBusyId(id)
    try {
      await api.post(`/inventory/adjustments/${id}/unpost/`)
      success('Adjustment rolled back; stock and ledger restored.')
      setBookCache({})
      await loadAll()
    } catch (e) {
      error(extractErrorMessage(e) || 'Could not roll back the adjustment')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: number) => {
    setBusyId(id)
    try {
      await api.delete(`/inventory/adjustments/${id}/delete/`)
      success('Draft adjustment deleted.')
      await loadAll()
    } catch (e) {
      error(extractErrorMessage(e) || 'Could not delete the adjustment')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <PageLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Link href="/inventory" className={btnSecondary}>
            <ArrowLeft className="h-4 w-4" />
            Inventory
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <ClipboardList className="h-5 w-5 text-primary" />
              Stock adjustments
            </h1>
            <p className="text-sm text-muted-foreground">
              Correct shop on-hand to a physical count. The variance posts to Inventory Shrinkage
              (5210): a shortage increases shrinkage, an overage reduces it.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-10 py-16 text-center shadow-sm">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : (
          <>
            <div className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-md sm:p-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Station / location</span>
                  <select
                    className={selectClassName}
                    value={stationId}
                    onChange={(e) => setStationId(e.target.value)}
                  >
                    {stations.length === 0 ? <option value="">No active station</option> : null}
                    {stations.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.station_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Reason</span>
                  <select
                    className={selectClassName}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    {REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Memo (optional)</span>
                  <input
                    className={inputClassName}
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="e.g. Monthly count"
                  />
                </label>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 px-1 text-xs font-medium text-muted-foreground">
                  <span className="col-span-5">Item</span>
                  <span className="col-span-2 text-right">On record</span>
                  <span className="col-span-2 text-right">Counted</span>
                  <span className="col-span-2 text-right">Difference</span>
                  <span className="col-span-1" />
                </div>
                {lines.map((ln, idx) => {
                  const book = ln.book == null ? null : Number(ln.book)
                  const counted = ln.counted.trim() === '' ? null : Number(ln.counted)
                  const diff =
                    book != null && counted != null && Number.isFinite(counted)
                      ? counted - book
                      : null
                  return (
                    <div key={idx} className="grid grid-cols-12 items-center gap-2">
                      <div className="col-span-5">
                        <select
                          className={selectClassName}
                          value={ln.itemId}
                          onChange={(e) => updateLine(idx, { itemId: e.target.value, book: null })}
                        >
                          <option value="">Select item…</option>
                          {items.map((it) => (
                            <option
                              key={it.id}
                              value={String(it.id)}
                              disabled={usedItemIds.has(String(it.id)) && ln.itemId !== String(it.id)}
                            >
                              {it.name}
                              {it.item_number ? ` (${it.item_number})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2 text-right text-sm tabular-nums text-muted-foreground">
                        {ln.itemId ? fmtQty(ln.book) : '—'}
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          className={`${inputClassName} text-right`}
                          value={ln.counted}
                          onChange={(e) => updateLine(idx, { counted: e.target.value })}
                          placeholder="0"
                        />
                      </div>
                      <div
                        className={`col-span-2 text-right text-sm font-medium tabular-nums ${
                          diff == null
                            ? 'text-muted-foreground'
                            : diff < 0
                              ? 'text-destructive'
                              : diff > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-muted-foreground'
                        }`}
                      >
                        {diff == null ? '—' : diff > 0 ? `+${fmtQty(String(diff))}` : fmtQty(String(diff))}
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          disabled={lines.length <= 1}
                          className="inline-flex size-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted/60 disabled:opacity-40"
                          aria-label="Remove line"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
                <button type="button" onClick={addLine} className={`${btnSecondary} mt-1`}>
                  <Plus className="h-4 w-4" />
                  Add item
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button type="button" onClick={resetForm} className={btnSecondary} disabled={saving}>
                  Clear
                </button>
                <button type="button" onClick={saveAndPost} className={btnPrimary} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Post adjustment
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card shadow-md">
              <div className="border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold">Recent adjustments</h2>
              </div>
              {records.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No adjustments yet.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {records.map((r) => {
                    const posted = r.status === 'posted'
                    return (
                      <li key={r.id} className="px-5 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{r.adjustment_number || `ADJ-${r.id}`}</span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                  posted
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100'
                                    : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
                                }`}
                              >
                                {posted ? 'Posted' : 'Draft'}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {formatDateOnly(r.adjustment_date)} · {r.station_name} · {reasonLabel(r.reason)}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1">
                              {r.lines.map((ln) => {
                                const diff =
                                  ln.book_quantity != null
                                    ? Number(ln.counted_quantity) - Number(ln.book_quantity)
                                    : null
                                return (
                                  <div key={ln.id} className="text-sm text-muted-foreground">
                                    <span className="text-foreground">{ln.item_name}</span>: counted{' '}
                                    {fmtQty(ln.counted_quantity)} {ln.unit}
                                    {diff != null ? (
                                      <span
                                        className={
                                          diff < 0
                                            ? 'text-destructive'
                                            : diff > 0
                                              ? 'text-emerald-600 dark:text-emerald-400'
                                              : ''
                                        }
                                      >
                                        {' '}
                                        ({diff > 0 ? '+' : ''}
                                        {fmtQty(String(diff))})
                                      </span>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>
                            {posted && r.auto_journal_entry_number ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Ledger: {r.auto_journal_entry_number}
                              </p>
                            ) : null}
                            {r.memo ? <p className="mt-1 text-xs text-muted-foreground">{r.memo}</p> : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {posted ? (
                              <button
                                type="button"
                                onClick={() => unpost(r.id)}
                                disabled={busyId === r.id}
                                className={btnSecondary}
                              >
                                {busyId === r.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Undo2 className="h-4 w-4" />
                                )}
                                Roll back
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => remove(r.id)}
                                disabled={busyId === r.id}
                                className={btnDanger}
                              >
                                {busyId === r.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </PageLayout>
  )
}
