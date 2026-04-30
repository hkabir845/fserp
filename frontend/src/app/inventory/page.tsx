'use client'

import type { ReactNode } from 'react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import {
  ArrowRight,
  ArrowRightLeft,
  Info,
  Loader2,
  MapPin,
  Plus,
  Search,
  Send,
  Trash2,
  Package,
  AlertCircle,
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
  'inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/20'

type Station = { id: number; station_name: string; station_number?: string }

type PosItem = { id: number; name: string; item_number?: string; pos_category?: string }

type TransferLineRow = { item_id: number; quantity: string }

type AvailabilityResponse =
  | {
      item_id: number
      name: string
      tracks_per_station: true
      unit: string
      total_on_hand: string
      stations: { station_id: number; station_name: string; station_number: string; quantity: string }[]
    }
  | {
      item_id: number
      name: string
      tracks_per_station: false
      message?: string
      stations: unknown[]
    }

type ItemAvailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: AvailabilityResponse }
  | { status: 'error'; message: string }

type TransferRecord = {
  id: number
  transfer_number: string
  transfer_date: string
  status: string
  memo?: string
  from_station_id: number
  to_station_id: number
  from_station_name: string
  to_station_name: string
  posted_at?: string | null
  lines: { id: number; item_id: number; item_name: string; quantity: string }[]
}

function parseQtyInput(raw: string): number {
  const n = parseFloat(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : NaN
}

function qtyAtSourceStation(
  data: AvailabilityResponse,
  fromStationId: number
): { qtyNum: number; unit: string } {
  if (!data.tracks_per_station) return { qtyNum: 0, unit: '' }
  const row = data.stations.find(s => s.station_id === fromStationId)
  const q = parseFloat(String(row?.quantity ?? '0').replace(/,/g, ''))
  return {
    qtyNum: Number.isFinite(q) ? q : 0,
    unit: (data.unit || 'units').trim() || 'units',
  }
}

function sumQtySameItemOtherLines(rows: TransferLineRow[], itemId: number, exceptIndex: number): number {
  let sum = 0
  rows.forEach((r, j) => {
    if (j === exceptIndex || r.item_id !== itemId) return
    const q = parseQtyInput(r.quantity)
    if (q > 0) sum += q
  })
  return sum
}

function InventoryContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()

  const tabParam = (searchParams.get('tab') || 'transfers').toLowerCase()
  const [tab, setTab] = useState<'transfers' | 'lookup'>(tabParam === 'lookup' ? 'lookup' : 'transfers')

  const [loading, setLoading] = useState(true)
  const [stations, setStations] = useState<Station[]>([])
  const [posItems, setPosItems] = useState<PosItem[]>([])
  const [transfers, setTransfers] = useState<TransferRecord[]>([])
  /** When set, API lists only transfers involving this site; creating cross-site moves is not allowed. */
  const [userHomeStation, setUserHomeStation] = useState<{
    id: number
    name: string
  } | null>(null)
  const [stationMode, setStationMode] = useState<'single' | 'multi'>('single')

  // Create transfer form
  const [fromStationId, setFromStationId] = useState<number | ''>('')
  const [toStationId, setToStationId] = useState<number | ''>('')
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().split('T')[0])
  const [transferMemo, setTransferMemo] = useState('')
  const [lineRows, setLineRows] = useState<TransferLineRow[]>([{ item_id: 0, quantity: '1' }])
  const [saving, setSaving] = useState(false)
  const [transferPostingId, setTransferPostingId] = useState<number | null>(null)
  const [transferDeletingId, setTransferDeletingId] = useState<number | null>(null)
  const [itemAvail, setItemAvail] = useState<Record<number, ItemAvailState>>({})
  const [availFetchSeq, setAvailFetchSeq] = useState(0)

  // Stock lookup
  const [lookupItemId, setLookupItemId] = useState<number | ''>('')
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  const loadCore = useCallback(async () => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    setLoading(true)
    try {
      const [stRes, itRes, trRes, coRes] = await Promise.allSettled([
        api.get('/stations/'),
        api.get('/items/', { params: { pos_only: 'true' } }),
        api.get('/inventory/transfers/'),
        api.get('/companies/current/').catch(() => ({ data: {} })),
      ])
      if (stRes.status === 'fulfilled') {
        const raw = Array.isArray(stRes.value.data) ? stRes.value.data : []
        setStations(
          raw
            .map((s: { id?: unknown; station_name?: string; station_number?: string }) => ({
              id: typeof s.id === 'number' ? s.id : Number(s.id),
              station_name: String(s.station_name || '').trim() || 'Station',
              station_number: s.station_number != null ? String(s.station_number) : undefined,
            }))
            .filter(s => Number.isFinite(s.id))
        )
      }
      if (itRes.status === 'fulfilled') {
        const d = itRes.value.data
        const list = Array.isArray(d) ? d : (d as { items?: PosItem[] })?.items
        if (Array.isArray(list)) {
          setPosItems(
            list
              .filter(
                (p: PosItem & { pos_category?: string }) =>
                  (p.pos_category || '').toLowerCase() !== 'fuel'
              )
              .map((p: { id: unknown; name: string; item_number?: string; pos_category?: string }) => ({
                id: typeof p.id === 'number' ? p.id : Number(p.id),
                name: p.name,
                item_number: p.item_number,
                pos_category: p.pos_category,
              }))
          )
        }
      }
      if (trRes.status === 'fulfilled' && Array.isArray(trRes.value.data)) {
        setTransfers(trRes.value.data as TransferRecord[])
      }
      if (coRes.status === 'fulfilled' && coRes.value && 'data' in coRes.value) {
        const sm = String(
          (coRes.value.data as { station_mode?: string })?.station_mode ?? 'single',
        )
          .toLowerCase()
          .trim()
        setStationMode(sm === 'single' ? 'single' : 'multi')
      }
    } catch (e) {
      console.error(e)
      toast.error('Failed to load inventory data')
    } finally {
      setLoading(false)
    }
  }, [router, toast])

  useEffect(() => {
    void loadCore()
  }, [loadCore])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = localStorage.getItem('user')
    if (!raw || raw === 'null' || raw === 'undefined') {
      setUserHomeStation(null)
      return
    }
    try {
      const u = JSON.parse(raw) as {
        home_station_id?: number | null
        home_station_name?: string | null
      }
      if (u?.home_station_id != null && String(u.home_station_id).trim() !== '') {
        const id = Number(u.home_station_id)
        if (Number.isFinite(id) && id > 0) {
          setUserHomeStation({
            id,
            name: (typeof u.home_station_name === 'string' && u.home_station_name.trim()
              ? u.home_station_name.trim()
              : `Station #${id}`),
          })
          return
        }
      }
      setUserHomeStation(null)
    } catch {
      setUserHomeStation(null)
    }
  }, [])

  useEffect(() => {
    const t = (searchParams.get('tab') || 'transfers').toLowerCase()
    setTab(t === 'lookup' ? 'lookup' : 'transfers')
    const it = searchParams.get('item_id') || searchParams.get('item')
    if (it) {
      const n = parseInt(String(it), 10)
      if (Number.isFinite(n) && n > 0) {
        setLookupItemId(n)
        setTab('lookup')
      }
    }
  }, [searchParams])

  const runLookup = useCallback(
    async (itemId: number) => {
      setLookupLoading(true)
      setAvailability(null)
      try {
        const r = await api.get('/inventory/availability/', { params: { item_id: itemId } })
        setAvailability(r.data as AvailabilityResponse)
      } catch (e) {
        toast.error(extractErrorMessage(e, 'Could not load availability'))
      } finally {
        setLookupLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    if (tab !== 'lookup') return
    const n = typeof lookupItemId === 'number' ? lookupItemId : parseInt(String(lookupItemId), 10)
    if (Number.isFinite(n) && n > 0) {
      void runLookup(n)
    } else {
      setAvailability(null)
    }
  }, [tab, lookupItemId, runLookup])

  const addLineRow = () => setLineRows(prev => [...prev, { item_id: 0, quantity: '1' }])
  const updateLine = (i: number, field: keyof TransferLineRow, value: string | number) => {
    setLineRows(prev => {
      const next = [...prev]
      if (field === 'item_id') {
        next[i] = { ...next[i], item_id: typeof value === 'number' ? value : parseInt(String(value), 10) || 0 }
      } else {
        next[i] = { ...next[i], quantity: String(value) }
      }
      return next
    })
  }
  const removeLine = (i: number) => {
    setLineRows(prev => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))
  }

  const lineItemIdsKey = useMemo(
    () =>
      [...new Set(lineRows.map(r => r.item_id).filter(id => id > 0))]
        .sort((a, b) => a - b)
        .join(','),
    [lineRows],
  )

  useEffect(() => {
    const ids = lineItemIdsKey
      ? lineItemIdsKey.split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0)
      : []
    if (!ids.length) return undefined
    const ac = new AbortController()
    for (const id of ids) {
      setItemAvail(prev => ({ ...prev, [id]: { status: 'loading' } }))
    }
    void Promise.all(
      ids.map(async id => {
        try {
          const r = await api.get('/inventory/availability/', {
            params: { item_id: id },
            signal: ac.signal,
          })
          if (ac.signal.aborted) return
          setItemAvail(prev => ({ ...prev, [id]: { status: 'ok', data: r.data as AvailabilityResponse } }))
        } catch (e: unknown) {
          if (ac.signal.aborted) return
          const err = e as { code?: string; name?: string }
          if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return
          setItemAvail(prev => ({
            ...prev,
            [id]: { status: 'error', message: extractErrorMessage(e, 'Could not load stock') },
          }))
        }
      }),
    )
    return () => ac.abort()
  }, [lineItemIdsKey, availFetchSeq])

  const transferDraftIssues = useMemo(() => {
    const issues: string[] = []
    if (!fromStationId || !toStationId) {
      issues.push('Select both source and destination sites.')
      return issues
    }
    if (fromStationId === toStationId) {
      issues.push('Source and destination must be different sites.')
      return issues
    }
    const fs = fromStationId
    const validLines = lineRows
      .map((r, i) => ({ ...r, i, q: parseQtyInput(r.quantity) }))
      .filter(x => x.item_id > 0)
    if (!validLines.length) {
      issues.push('Add at least one product with a quantity greater than zero (zero is not allowed).')
    }
    for (const row of validLines) {
      if (!Number.isFinite(row.q) || row.q <= 0) {
        issues.push(`Line ${row.i + 1}: enter a quantity greater than zero.`)
        continue
      }
      const st = itemAvail[row.item_id]
      if (!st || st.status === 'loading') {
        issues.push(`Line ${row.i + 1}: loading stock for this product…`)
        continue
      }
      if (st.status === 'error') {
        issues.push(`Line ${row.i + 1}: ${st.message}`)
        continue
      }
      const data = st.data
      if (!data.tracks_per_station) {
        issues.push(
          `Line ${row.i + 1}: "${data.name}" cannot be moved here (fuel / not tracked in shop bins).`,
        )
        continue
      }
      const { qtyNum, unit } = qtyAtSourceStation(data, fs)
      const others = sumQtySameItemOtherLines(lineRows, row.item_id, row.i)
      const maxForLine = qtyNum - others
      if (qtyNum <= 0 && row.q > 0) {
        issues.push(
          `Line ${row.i + 1}: no stock at source for this product — receive or adjust stock before transferring.`,
        )
      } else if (row.q > maxForLine + 1e-9) {
        issues.push(
          `Line ${row.i + 1}: quantity exceeds what you can send (${qtyNum.toLocaleString()} ${unit} at source` +
            (others > 0
              ? `; ${others.toLocaleString()} ${unit} already on other lines for this SKU`
              : '') +
            `; max for this line ${Math.max(0, maxForLine).toLocaleString()} ${unit}).`,
        )
      }
    }
    return issues
  }, [fromStationId, toStationId, lineRows, itemAvail])

  const applyMaxQty = useCallback(
    (lineIndex: number) => {
      setLineRows(prev => {
        const row = prev[lineIndex]
        if (!row || typeof fromStationId !== 'number' || row.item_id <= 0) return prev
        const st = itemAvail[row.item_id]
        if (!st || st.status !== 'ok' || !st.data.tracks_per_station) return prev
        const { qtyNum } = qtyAtSourceStation(st.data, fromStationId)
        const others = sumQtySameItemOtherLines(prev, row.item_id, lineIndex)
        const max = Math.max(0, qtyNum - others)
        const qtyStr = Number.isInteger(max) ? String(max) : String(Math.round(max * 1e6) / 1e6)
        const next = [...prev]
        next[lineIndex] = { ...next[lineIndex], quantity: qtyStr }
        return next
      })
    },
    [fromStationId, itemAvail],
  )

  const refreshLineAvailability = useCallback(() => {
    setAvailFetchSeq(s => s + 1)
  }, [])

  const submitTransferDraft = async () => {
    if (transferDraftIssues.length > 0) {
      toast.error(transferDraftIssues[0] || 'Fix the form before saving.')
      return
    }
    const lines = lineRows
      .map(r => ({
        item_id: r.item_id,
        q: parseQtyInput(r.quantity),
      }))
      .filter(r => r.item_id > 0 && Number.isFinite(r.q) && r.q > 0)
    if (!lines.length) {
      toast.error('Add at least one line with an item and positive quantity')
      return
    }
    setSaving(true)
    try {
      await api.post('/inventory/transfers/', {
        from_station_id: fromStationId,
        to_station_id: toStationId,
        transfer_date: transferDate,
        memo: transferMemo || '',
        lines: lines.map(x => ({ item_id: x.item_id, quantity: String(x.q) })),
      })
      toast.success('Transfer draft created. Post it to move stock.')
      setLineRows([{ item_id: 0, quantity: '1' }])
      setTransferMemo('')
      setItemAvail({})
      void loadCore()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not create transfer'))
    } finally {
      setSaving(false)
    }
  }

  const postTransfer = async (id: number) => {
    if (!confirm('Post this transfer? Stock will move between stations and a journal entry will be created.')) return
    setTransferPostingId(id)
    try {
      await api.post(`/inventory/transfers/${id}/`)
      toast.success('Transfer posted')
      void loadCore()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not post transfer'))
    } finally {
      setTransferPostingId(null)
    }
  }

  const deleteDraft = async (id: number) => {
    if (!confirm('Delete this draft transfer? This cannot be undone.')) return
    setTransferDeletingId(id)
    try {
      await api.delete(`/inventory/transfers/${id}/delete/`)
      toast.success('Draft deleted')
      void loadCore()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not delete'))
    } finally {
      setTransferDeletingId(null)
    }
  }

  const transferListBusy = transferPostingId !== null || transferDeletingId !== null

  const activeStationCount = stations.length
  const canTransferBetweenSites = activeStationCount >= 2

  const setTabAndUrl = (next: 'transfers' | 'lookup') => {
    setTab(next)
    const q = new URLSearchParams(searchParams.toString())
    q.set('tab', next)
    if (next === 'transfers') {
      q.delete('item_id')
    }
    router.replace(`/inventory?${q.toString()}`, { scroll: false })
  }

  return (
    <div className="page-with-sidebar flex h-screen min-h-0 w-full min-w-0 max-w-full bg-gray-100">
      <Sidebar />
      <div className="flex-1 min-h-0 min-w-0 overflow-auto app-scroll-pad p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-7xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Inter-station inventory
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Shop (general) products</span> use per-station bins
              when you have multiple active sites; with one site, stock stays at that location.{' '}
              <span className="font-medium text-foreground">Fuel</span> is tracked in tanks.{' '}
              <Link href="/items" className="text-primary underline underline-offset-2">
                Products
              </Link>
              {' · '}
              <Link href="/cashier" className="text-primary underline underline-offset-2">
                Cashier
              </Link>
            </p>
          </div>

          {userHomeStation && (
            <div className="flex items-start gap-2 rounded-lg border border-sky-200/90 bg-sky-50/95 px-4 py-3 text-sm text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/30 dark:text-sky-100">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
              <div>
                <p className="font-medium">Your site: {userHomeStation.name}</p>
                <p className="mt-1 text-sky-900/90 dark:text-sky-200/90">
                  The transfer list shows only movement involving this station. Creating transfers between
                  different sites needs a company-wide (admin or accountant) login—your account is tied to
                  this location only.
                </p>
              </div>
            </div>
          )}

          <div
            className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1 shadow-sm"
            role="tablist"
            aria-label="Inventory views"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'transfers'}
              onClick={() => setTabAndUrl('transfers')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                tab === 'transfers'
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border/80'
                  : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
              }`}
            >
              <ArrowRightLeft className="h-4 w-4 shrink-0" />
              Transfers
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'lookup'}
              onClick={() => setTabAndUrl('lookup')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                tab === 'lookup'
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border/80'
                  : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
              }`}
            >
              <Search className="h-4 w-4 shrink-0" />
              Stock by station
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : tab === 'lookup' ? (
            <div className="space-y-6 rounded-2xl border border-border bg-card p-5 shadow-md ring-1 ring-black/5 dark:ring-white/10 sm:p-7">
              <h2 className="text-lg font-semibold tracking-tight">Availability by location</h2>
              {userHomeStation && (
                <p className="text-sm text-muted-foreground">
                  Rows for <span className="font-medium text-foreground">{userHomeStation.name}</span> match
                  your assigned site; other stations are shown for context when you have access to the full
                  list.
                </p>
              )}
              <div className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label className="text-sm font-medium" htmlFor="inv-lookup-item">
                    Product
                  </label>
                  <select
                    id="inv-lookup-item"
                    className={selectClassName + ' mt-1'}
                    value={lookupItemId === '' ? '' : String(lookupItemId)}
                    onChange={e => {
                      const v = e.target.value
                      setLookupItemId(v ? parseInt(v, 10) : '')
                      const q = new URLSearchParams(searchParams.toString())
                      q.set('tab', 'lookup')
                      if (v) q.set('item_id', v)
                      else q.delete('item_id')
                      router.replace(`/inventory?${q.toString()}`, { scroll: false })
                    }}
                  >
                    <option value="">— Select a product —</option>
                    {posItems.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.item_number ? ` (${p.item_number})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => {
                    const n = typeof lookupItemId === 'number' ? lookupItemId : parseInt(String(lookupItemId), 10)
                    if (Number.isFinite(n) && n > 0) void runLookup(n)
                  }}
                  disabled={lookupLoading}
                >
                  {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Refresh
                </button>
              </div>

              {lookupLoading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}

              {!lookupLoading && availability && (
                <div className="space-y-3">
                  {!availability.tracks_per_station ? (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <strong>{availability.name}</strong> — {availability.message || 'Not tracked per station.'}
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        <strong>Total on hand (company):</strong>{' '}
                        {availability.total_on_hand} {availability.unit || 'units'}
                      </p>
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full min-w-[400px] text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">Station</th>
                              <th className="px-3 py-2 text-right font-medium">Quantity</th>
                            </tr>
                          </thead>
                          <tbody>
                            {availability.stations.length === 0 ? (
                              <tr>
                                <td colSpan={2} className="px-3 py-4 text-center text-muted-foreground">
                                  No per-station rows yet
                                </td>
                              </tr>
                            ) : (
                              availability.stations.map(s => {
                                const isMySite = userHomeStation && s.station_id === userHomeStation.id
                                return (
                                <tr
                                  key={s.station_id}
                                  className={`border-t ${isMySite ? 'bg-primary/5' : ''}`}
                                >
                                  <td className="px-3 py-2">
                                    <span className="inline-flex items-center gap-1.5">
                                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                                      {s.station_name}
                                      {s.station_number ? (
                                        <span className="text-xs text-muted-foreground">
                                          ({s.station_number})
                                        </span>
                                      ) : null}
                                    </span>
                                    {isMySite && (
                                      <span className="ml-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
                                        Your site
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">{s.quantity}</td>
                                </tr>
                                )
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex w-full min-w-0 flex-col gap-5">
              {userHomeStation ? (
                <div className="rounded-xl border border-dashed border-muted-foreground/35 bg-muted/25 p-4 shadow-sm sm:p-5">
                  <h2 className="text-lg font-semibold text-muted-foreground">New transfer (not available)</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Inter-station transfers are created with a user that is not limited to a single home
                    station. Ask a company <strong>admin</strong> or <strong>accountant</strong> to move
                    stock between sites, or use a login without a home station.
                  </p>
                </div>
              ) : !canTransferBetweenSites ? (
                <div className="rounded-xl border border-dashed border-muted-foreground/35 bg-muted/25 p-4 shadow-sm sm:p-5">
                  <h2 className="text-lg font-semibold text-muted-foreground">New transfer (not available)</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {stationMode === 'single' ? (
                      <>
                        This company is set to <strong>single site</strong>. Shop stock stays at that site; there
                        is no second location to move to. To run multiple depots, switch to{' '}
                        <strong>multiple stations</strong> in Company and add a second site under Sites.
                      </>
                    ) : (
                      <>
                        You need <strong>at least two active sites</strong> to create an inter-station
                        transfer. Add another station under Sites, then return here. With one site, all shop
                        stock is at that site (fuel remains in tanks).
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                  <div className="border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
                    <h2 className="text-lg font-semibold tracking-tight">New stock transfer</h2>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                      Save a <span className="font-medium text-foreground">draft</span> first; posting moves bins and
                      records the GL.
                    </p>
                    <div
                      className="mt-3 max-w-2xl rounded-md border border-border/70 bg-background/60 px-3 py-2 text-[11px] leading-snug text-muted-foreground"
                      role="note"
                    >
                      <span className="font-medium text-foreground">Posting affects stock and books:</span> bin
                      quantities shift between sites. The ledger gets an auto journal on each line&apos;s{' '}
                      <span className="font-medium text-foreground">inventory</span> account (debit at receiver,
                      credit at sender, same value at item cost) so company-wide inventory value is unchanged but
                      station-tagged GL lines move. GL and inventory-by-site reports reflect this; sales, COGS, and
                      bank accounts are not touched by a normal inter-site move.
                    </div>
                  </div>

                  <div className="space-y-5 p-4 sm:p-5">
                    <section
                      className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-3 sm:p-4"
                      aria-labelledby="inv-route-heading"
                    >
                      <h3
                        id="inv-route-heading"
                        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
                        Route &amp; document
                      </h3>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1 space-y-1">
                          <label className="text-sm font-medium text-foreground" htmlFor="inv-from-st">
                            Sending site
                          </label>
                          <select
                            id="inv-from-st"
                            className={selectClassName}
                            value={fromStationId === '' ? '' : String(fromStationId)}
                            onChange={e => setFromStationId(e.target.value ? parseInt(e.target.value, 10) : '')}
                          >
                            <option value="">From…</option>
                            {stations.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.station_name}
                                {s.station_number ? ` (${s.station_number})` : ''}
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] leading-snug text-muted-foreground">
                            Quantities below use this site&apos;s bin.
                          </p>
                        </div>
                        <div
                          className="hidden shrink-0 justify-center pb-2 text-muted-foreground sm:flex sm:w-8"
                          aria-hidden
                        >
                          <ArrowRight className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <label className="text-sm font-medium text-foreground" htmlFor="inv-to-st">
                            Receiving site
                          </label>
                          <select
                            id="inv-to-st"
                            className={selectClassName}
                            value={toStationId === '' ? '' : String(toStationId)}
                            onChange={e => setToStationId(e.target.value ? parseInt(e.target.value, 10) : '')}
                          >
                            <option value="">To…</option>
                            {stations.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.station_name}
                                {s.station_number ? ` (${s.station_number})` : ''}
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] leading-snug text-muted-foreground">Stock increases here on post.</p>
                        </div>
                      </div>
                      <div className="border-t border-border/50 pt-3">
                        <h3 id="inv-doc-heading" className="sr-only">
                          Document details
                        </h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label className="text-sm font-medium" htmlFor="inv-transfer-date">
                              Date
                            </label>
                            <input
                              id="inv-transfer-date"
                              type="date"
                              className={inputClassName}
                              value={transferDate}
                              onChange={e => setTransferDate(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <label className="text-sm font-medium" htmlFor="inv-transfer-memo">
                              Memo <span className="font-normal text-muted-foreground">(optional)</span>
                            </label>
                            <textarea
                              id="inv-transfer-memo"
                              rows={2}
                              className={inputClassName + ' min-h-[60px] resize-y py-2'}
                              value={transferMemo}
                              onChange={e => setTransferMemo(e.target.value)}
                              placeholder="e.g. Weekly replenishment"
                            />
                          </div>
                        </div>
                      </div>
                    </section>

                    <section aria-labelledby="inv-lines-heading">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3
                          id="inv-lines-heading"
                          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          <Package className="h-3.5 w-3.5" aria-hidden />
                          Line items
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={btnSecondary + ' !py-1.5 !text-xs'}
                            onClick={() => refreshLineAvailability()}
                            disabled={!lineItemIdsKey}
                          >
                            Refresh quantities
                          </button>
                          <button type="button" className={btnSecondary + ' !py-1.5 !text-xs'} onClick={addLineRow}>
                            <Plus className="h-3.5 w-3.5" />
                            Add line
                          </button>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[600px] text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              <th className="w-10 px-3 py-2.5">#</th>
                              <th className="min-w-[200px] px-3 py-2.5">Product</th>
                              <th className="min-w-[100px] px-3 py-2.5">SKU</th>
                              <th className="min-w-[140px] px-3 py-2.5 text-right">Available at source</th>
                              <th className="min-w-[120px] px-3 py-2.5 text-right">Transfer qty</th>
                              <th className="w-[120px] px-3 py-2.5 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lineRows.map((row, i) => {
                              const product = posItems.find(p => p.id === row.item_id)
                              const st = row.item_id > 0 ? itemAvail[row.item_id] : undefined
                              const qVal = parseQtyInput(row.quantity)
                              let availMain: ReactNode = (
                                <span className="text-muted-foreground">—</span>
                              )
                              let availSub: ReactNode = null
                              let rowWarn = false

                              if (row.item_id <= 0) {
                                availMain = <span className="text-muted-foreground">Choose a product</span>
                              } else if (!fromStationId) {
                                availMain = (
                                  <span className="text-xs text-muted-foreground">Select sending site first</span>
                                )
                              } else if (!st || st.status === 'loading') {
                                availMain = (
                                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Loading…
                                  </span>
                                )
                              } else if (st.status === 'error') {
                                availMain = <span className="text-xs text-destructive">{st.message}</span>
                                rowWarn = true
                              } else if (!st.data.tracks_per_station) {
                                availMain = (
                                  <span className="text-xs text-amber-800 dark:text-amber-200">
                                    Not movable here (fuel / not in shop bins)
                                  </span>
                                )
                                rowWarn = true
                              } else {
                                const fs = fromStationId as number
                                const { qtyNum, unit } = qtyAtSourceStation(st.data, fs)
                                const others = sumQtySameItemOtherLines(lineRows, row.item_id, i)
                                const maxLine = Math.max(0, qtyNum - others)
                                availMain = (
                                  <span className="tabular-nums">
                                    <span className="font-semibold text-foreground">
                                      {qtyNum.toLocaleString(undefined, {
                                        maximumFractionDigits: 6,
                                      })}
                                    </span>{' '}
                                    <span className="text-muted-foreground">{unit}</span>
                                  </span>
                                )
                                if (qtyNum <= 0) {
                                  availSub = (
                                    <span className="mt-0.5 block text-xs text-amber-800 dark:text-amber-200">
                                      No stock at this site — cannot transfer until receipt or adjustment.
                                    </span>
                                  )
                                  rowWarn = true
                                } else if (others > 0) {
                                  availSub = (
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                      Max on this line after other lines:{' '}
                                      <span className="font-medium text-foreground">
                                        {maxLine.toLocaleString(undefined, { maximumFractionDigits: 6 })} {unit}
                                      </span>
                                    </span>
                                  )
                                }
                                if (Number.isFinite(qVal) && qVal > maxLine + 1e-9) rowWarn = true
                                if (Number.isFinite(qVal) && qVal <= 0 && row.item_id > 0) rowWarn = true
                              }

                              return (
                                <tr
                                  key={`inv-line-${i}`}
                                  className={`border-t border-border ${rowWarn ? 'bg-amber-500/5 dark:bg-amber-500/10' : ''}`}
                                >
                                  <td className="px-3 py-2.5 align-top text-muted-foreground tabular-nums">{i + 1}</td>
                                  <td className="px-3 py-2.5 align-top">
                                    <label className="sr-only" htmlFor={`tli-${i}`}>
                                      Product line {i + 1}
                                    </label>
                                    <select
                                      id={`tli-${i}`}
                                      className={selectClassName}
                                      value={row.item_id || ''}
                                      onChange={e =>
                                        updateLine(
                                          i,
                                          'item_id',
                                          e.target.value ? parseInt(e.target.value, 10) : 0,
                                        )
                                      }
                                    >
                                      <option value="">Select product…</option>
                                      {posItems.map(p => (
                                        <option key={p.id} value={p.id}>
                                          {p.name}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-muted-foreground tabular-nums">
                                    {product?.item_number || '—'}
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-right">
                                    <div>{availMain}</div>
                                    {availSub}
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-right">
                                    <label className="sr-only" htmlFor={`tlq-${i}`}>
                                      Quantity line {i + 1}
                                    </label>
                                    <input
                                      id={`tlq-${i}`}
                                      className={inputClassName + ' text-right tabular-nums'}
                                      inputMode="decimal"
                                      autoComplete="off"
                                      value={row.quantity}
                                      onChange={e => updateLine(i, 'quantity', e.target.value)}
                                      aria-invalid={rowWarn}
                                    />
                                    {typeof fromStationId === 'number' &&
                                      row.item_id > 0 &&
                                      st?.status === 'ok' &&
                                      st.data.tracks_per_station && (
                                        <button
                                          type="button"
                                          className="mt-1 text-xs font-medium text-primary hover:underline"
                                          onClick={() => applyMaxQty(i)}
                                        >
                                          Use max for this line
                                        </button>
                                      )}
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-right">
                                    {lineRows.length > 1 ? (
                                      <button
                                        type="button"
                                        aria-label={`Remove line ${i + 1}`}
                                        title="Remove this line from the draft"
                                        className={btnDanger + ' !p-2'}
                                        onClick={() => removeLine(i)}
                                      >
                                        <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                                      </button>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {transferDraftIssues.length > 0 && (
                        <div
                          className="mt-4 rounded-lg border border-amber-200/90 bg-amber-50/90 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/25"
                          role="status"
                        >
                          <div className="flex gap-2">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                            <ul className="list-inside list-disc space-y-1 text-sm text-amber-950 dark:text-amber-100">
                              {transferDraftIssues.map((msg, idx) => (
                                <li key={idx}>{msg}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground sm:min-w-0 sm:max-w-[min(28rem,100%)] sm:flex-1">
                          <span className="inline-flex items-start gap-1.5">
                            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span>
                              Quantities must be <strong className="font-medium text-foreground">greater than zero</strong>.
                              You cannot transfer more than is available at the sending site; if the same product
                              appears on multiple lines, limits apply to the combined total.
                            </span>
                          </span>
                        </p>
                        <button
                          type="button"
                          className={btnPrimary + ' w-full shrink-0 sm:w-auto'}
                          disabled={saving || transferDraftIssues.length > 0}
                          onClick={() => void submitTransferDraft()}
                        >
                          {saving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Package className="h-4 w-4" />
                          )}
                          Save draft
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              )}

              <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/5">
                <div className="border-b border-border bg-muted/30 px-4 py-2.5 sm:px-5">
                  <h2 className="text-base font-semibold tracking-tight">Transfers</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[580px] text-sm">
                    <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">From → To</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Lines</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                            No transfers yet
                          </td>
                        </tr>
                      ) : (
                        transfers.map(t => (
                          <tr key={t.id} className="border-t border-border/80 transition-colors hover:bg-muted/30">
                            <td className="px-3 py-2 font-mono text-xs">
                              {t.transfer_number || `TR-${t.id}`}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {formatDateOnly(t.transfer_date)}
                            </td>
                            <td className="px-3 py-2">
                              {t.from_station_name || t.from_station_id} → {t.to_station_name || t.to_station_id}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  t.status === 'posted'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
                                    : 'bg-amber-100 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200'
                                }`}
                              >
                                {t.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {t.lines?.map(l => `${l.item_name} (${l.quantity})`).join(' · ') || '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {t.status === 'draft' ? (
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    className={btnPrimary + ' !gap-1.5 !py-1.5 !text-xs'}
                                    disabled={transferListBusy}
                                    title="Post draft: move stock and create GL entry"
                                    onClick={() => void postTransfer(t.id)}
                                  >
                                    {transferPostingId === t.id ? (
                                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                                    ) : (
                                      <Send className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                    )}
                                    {transferPostingId === t.id ? 'Posting…' : 'Post'}
                                  </button>
                                  <button
                                    type="button"
                                    className={btnDanger + ' !gap-1.5 !py-1.5 !text-xs'}
                                    disabled={transferListBusy}
                                    title="Remove this draft"
                                    onClick={() => void deleteDraft(t.id)}
                                  >
                                    {transferDeletingId === t.id ? (
                                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                    )}
                                    {transferDeletingId === t.id ? 'Deleting…' : 'Delete'}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground" title="Posted transfers cannot be changed here">
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function InventoryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-muted/20 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <InventoryContent />
    </Suspense>
  )
}
