'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import {
  ArrowRightLeft,
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

  const submitTransferDraft = async () => {
    if (!fromStationId || !toStationId) {
      toast.error('Select both source and destination stations')
      return
    }
    if (fromStationId === toStationId) {
      toast.error('Source and destination must differ')
      return
    }
    const lines = lineRows
      .map(r => ({
        item_id: r.item_id,
        q: parseFloat(String(r.quantity).replace(/,/g, '')),
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
      void loadCore()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not create transfer'))
    } finally {
      setSaving(false)
    }
  }

  const postTransfer = async (id: number) => {
    if (!confirm('Post this transfer? Stock will move between stations and a journal entry will be created.')) return
    try {
      await api.post(`/inventory/transfers/${id}/`)
      toast.success('Transfer posted')
      void loadCore()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not post transfer'))
    }
  }

  const deleteDraft = async (id: number) => {
    if (!confirm('Delete this draft transfer?')) return
    try {
      await api.delete(`/inventory/transfers/${id}/delete/`)
      toast.success('Draft deleted')
      void loadCore()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not delete'))
    }
  }

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
        <div className="mx-auto w-full max-w-6xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Inter-station inventory
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
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

          <div className="flex flex-wrap gap-2 border-b border-border pb-2">
            <button
              type="button"
              onClick={() => setTabAndUrl('transfers')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'transfers'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <ArrowRightLeft className="h-4 w-4" />
              Transfers
            </button>
            <button
              type="button"
              onClick={() => setTabAndUrl('lookup')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'lookup'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Search className="h-4 w-4" />
              Stock by station
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : tab === 'lookup' ? (
            <div className="space-y-6 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
              <h2 className="text-lg font-semibold">Availability by location</h2>
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
            <div className="grid gap-6 lg:grid-cols-2">
              {userHomeStation ? (
                <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-4 shadow-sm sm:p-6">
                  <h2 className="text-lg font-semibold text-muted-foreground">New transfer (not available)</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Inter-station transfers are created with a user that is not limited to a single home
                    station. Ask a company <strong>admin</strong> or <strong>accountant</strong> to move
                    stock between sites, or use a login without a home station.
                  </p>
                </div>
              ) : !canTransferBetweenSites ? (
                <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-4 shadow-sm sm:p-6">
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
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
                  <h2 className="text-lg font-semibold">New transfer (draft)</h2>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Save a draft, then post it to move stock and post matching GL to inventory.
                  </p>
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium">From station</label>
                        <select
                          className={selectClassName + ' mt-1'}
                          value={fromStationId === '' ? '' : String(fromStationId)}
                          onChange={e => setFromStationId(e.target.value ? parseInt(e.target.value, 10) : '')}
                        >
                          <option value="">— Select —</option>
                          {stations.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.station_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium">To station</label>
                        <select
                          className={selectClassName + ' mt-1'}
                          value={toStationId === '' ? '' : String(toStationId)}
                          onChange={e => setToStationId(e.target.value ? parseInt(e.target.value, 10) : '')}
                        >
                          <option value="">— Select —</option>
                          {stations.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.station_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Transfer date</label>
                      <input
                        type="date"
                        className={inputClassName + ' mt-1'}
                        value={transferDate}
                        onChange={e => setTransferDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Memo (optional)</label>
                      <input
                        className={inputClassName + ' mt-1'}
                        value={transferMemo}
                        onChange={e => setTransferMemo(e.target.value)}
                        placeholder="e.g. Replenish express lane"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Lines</span>
                        <button type="button" className={btnSecondary + ' !py-1.5 !text-xs'} onClick={addLineRow}>
                          <Plus className="h-3.5 w-3.5" />
                          Add line
                        </button>
                      </div>
                      {lineRows.map((row, i) => (
                        <div key={i} className="flex flex-wrap items-end gap-2">
                          <div className="min-w-0 flex-1">
                            {i === 0 && (
                              <label className="text-xs text-muted-foreground" htmlFor={`tli-${i}`}>
                                Item
                              </label>
                            )}
                            <select
                              id={`tli-${i}`}
                              className={selectClassName + (i > 0 ? ' mt-1' : ' mt-1')}
                              value={row.item_id || ''}
                              onChange={e =>
                                updateLine(i, 'item_id', e.target.value ? parseInt(e.target.value, 10) : 0)
                              }
                            >
                              <option value={0}>— Product —</option>
                              {posItems.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="w-28">
                            {i === 0 && (
                              <label className="text-xs text-muted-foreground" htmlFor={`tlq-${i}`}>
                                Qty
                              </label>
                            )}
                            <input
                              id={`tlq-${i}`}
                              className={inputClassName + (i > 0 ? ' mt-1' : ' mt-1')}
                              inputMode="decimal"
                              value={row.quantity}
                              onChange={e => updateLine(i, 'quantity', e.target.value)}
                            />
                          </div>
                          {lineRows.length > 1 && (
                            <button
                              type="button"
                              aria-label="Remove line"
                              className={btnDanger + ' self-end'}
                              onClick={() => removeLine(i)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className={btnPrimary + ' w-full sm:w-auto'}
                      disabled={saving}
                      onClick={() => void submitTransferDraft()}
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                      Save draft
                    </button>
                  </div>
                </div>
              )}

              <div className="lg:col-span-2">
                <h2 className="mb-3 text-lg font-semibold">Transfers</h2>
                <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">From → To</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Lines</th>
                        <th className="px-3 py-2 text-right">Actions</th>
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
                          <tr key={t.id} className="border-t">
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
                              {t.status === 'draft' && (
                                <>
                                  <button
                                    type="button"
                                    className={btnPrimary + ' !py-1.5 !text-xs'}
                                    onClick={() => void postTransfer(t.id)}
                                  >
                                    <Send className="h-3.5 w-3.5" />
                                    Post
                                  </button>
                                  <button
                                    type="button"
                                    className={btnDanger + ' ml-2'}
                                    onClick={() => void deleteDraft(t.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
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
