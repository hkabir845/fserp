'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Package, Plus, Trash2, X } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import {
  type AvailabilityResponse,
  type ItemAvailState,
  type PondListItem,
  type PosTransferItem,
  type TransferLineRow,
  type TransferStation,
  comparePondsForTransfer,
  defaultStationForPond,
  formatStationTransferLabel,
  parseQtyInput,
  pondWarehouseShelfLabel,
  qtyAtSourceStation,
  readUserHomeStationId,
  sumQtySameItemOtherLines,
  validatePondWarehouseLines,
} from '@/lib/pondWarehouseTransferUtils'

const inputCls =
  'mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20'
const labelCls = 'block text-xs font-medium text-foreground/85'

type CategoryFilter = '' | 'feed' | 'medicine' | 'general' | 'fish'

export function PondWarehouseAddStockModal(props: {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  /** Pre-select pond when opened from a pond page or filtered stock view. */
  initialPondId?: number | null
  /** Lock pond field (pond detail page). */
  lockPond?: boolean
  /** When set, PUT amends an existing shop → pond receipt instead of creating a new move. */
  editingReceipt?: {
    id: number
    from_station_id: number
    pond_id: number
    lines: { item_id: number; quantity: string }[]
  } | null
}) {
  const { open, onClose, onSuccess, initialPondId, lockPond, editingReceipt } = props
  const toast = useToast()

  const [loadingMeta, setLoadingMeta] = useState(false)
  const [stations, setStations] = useState<TransferStation[]>([])
  const [ponds, setPonds] = useState<PondListItem[]>([])
  const [items, setItems] = useState<PosTransferItem[]>([])
  const [homeStationId, setHomeStationId] = useState<number | null>(null)

  const [pondId, setPondId] = useState('')
  const [stationId, setStationId] = useState<number | ''>('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('')
  const [onlyInStock, setOnlyInStock] = useState(true)
  const [lineRows, setLineRows] = useState<TransferLineRow[]>([{ item_id: 0, quantity: '1' }])
  const [itemAvail, setItemAvail] = useState<Record<number, ItemAvailState>>({})
  const [availFetchSeq, setAvailFetchSeq] = useState(0)
  const [saving, setSaving] = useState(false)

  const activePonds = useMemo(
    () => [...ponds.filter((p) => p.is_active !== false)].sort(comparePondsForTransfer),
    [ponds],
  )

  const activeStations = useMemo(
    () => stations.filter((s) => s.is_active !== false),
    [stations],
  )

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true)
    try {
      const [stRes, pondRes, itRes] = await Promise.all([
        api.get('/stations/'),
        api.get('/aquaculture/ponds/'),
        api.get('/items/', { params: { pos_only: 'true' } }),
      ])
      const rawSt = Array.isArray(stRes.data) ? stRes.data : []
      setStations(
        rawSt
          .map((s: Record<string, unknown>) => {
            const pidRaw = s.default_aquaculture_pond_id
            const pid =
              pidRaw == null || pidRaw === ''
                ? null
                : typeof pidRaw === 'number'
                  ? pidRaw
                  : Number(pidRaw)
            return {
              id: typeof s.id === 'number' ? s.id : Number(s.id),
              station_name: String(s.station_name || '').trim() || 'Station',
              station_number: s.station_number != null ? String(s.station_number) : undefined,
              is_active: s.is_active !== false,
              default_aquaculture_pond_id:
                pid != null && Number.isFinite(pid) && pid > 0 ? pid : null,
              default_aquaculture_pond_name: String(s.default_aquaculture_pond_name || '').trim(),
            }
          })
          .filter((s: TransferStation) => Number.isFinite(s.id)),
      )
      const rawP = Array.isArray(pondRes.data) ? pondRes.data : []
      setPonds(
        rawP
          .map((p: Record<string, unknown>) => ({
            id: typeof p.id === 'number' ? p.id : Number(p.id),
            name: String(p.name || '').trim() || 'Pond',
            sort_order: typeof p.sort_order === 'number' ? p.sort_order : Number(p.sort_order) || 0,
            is_active: p.is_active !== false,
          }))
          .filter((p: PondListItem) => Number.isFinite(p.id) && p.id > 0),
      )
      const d = itRes.data
      const list = Array.isArray(d) ? d : (d as { items?: PosTransferItem[] })?.items
      if (Array.isArray(list)) {
        setItems(
          list
            .filter((p: PosTransferItem & { pos_category?: string }) => {
              const pc = (p.pos_category || '').toLowerCase()
              return pc !== 'fuel' && pc !== 'non_pos'
            })
            .map((p: Record<string, unknown>) => ({
              id: typeof p.id === 'number' ? p.id : Number(p.id),
              name: String(p.name || ''),
              item_number: p.item_number != null ? String(p.item_number) : undefined,
              pos_category: p.pos_category != null ? String(p.pos_category) : undefined,
            }))
            .filter((p: PosTransferItem) => Number.isFinite(p.id) && p.id > 0),
        )
      }
      setHomeStationId(readUserHomeStationId())
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load shops and products'))
    } finally {
      setLoadingMeta(false)
    }
  }, [toast])

  useEffect(() => {
    if (!open) return
    void loadMeta()
    if (editingReceipt) {
      setPondId(String(editingReceipt.pond_id))
      setStationId(editingReceipt.from_station_id)
      setLineRows(
        editingReceipt.lines.length
          ? editingReceipt.lines.map((l) => ({ item_id: l.item_id, quantity: String(l.quantity) }))
          : [{ item_id: 0, quantity: '1' }],
      )
    } else {
      const pid =
        initialPondId != null && Number.isFinite(initialPondId) && initialPondId > 0
          ? String(initialPondId)
          : ''
      setPondId(pid)
      setLineRows([{ item_id: 0, quantity: '1' }])
    }
    setCategoryFilter('')
    setOnlyInStock(!editingReceipt)
    setItemAvail({})
    setAvailFetchSeq((s) => s + 1)
  }, [open, initialPondId, editingReceipt, loadMeta])

  const sourceCreditByItemId = useMemo(() => {
    if (!editingReceipt || stationId !== editingReceipt.from_station_id) return undefined
    const m: Record<number, number> = {}
    for (const ln of editingReceipt.lines) {
      const q = parseQtyInput(String(ln.quantity))
      if (q > 0) m[ln.item_id] = (m[ln.item_id] || 0) + q
    }
    return m
  }, [editingReceipt, stationId])

  useEffect(() => {
    if (!open || editingReceipt || loadingMeta) return
    const pid = pondId.trim() !== '' ? parseInt(pondId, 10) : NaN
    if (!Number.isFinite(pid) || pid <= 0) {
      if (activeStations.length === 1) setStationId(activeStations[0].id)
      else if (homeStationId != null) setStationId(homeStationId)
      return
    }
    setStationId(defaultStationForPond(activeStations, pid, homeStationId))
  }, [open, loadingMeta, pondId, activeStations, homeStationId])

  const lineItemIdsKey = useMemo(
    () =>
      [...new Set(lineRows.map((r) => r.item_id).filter((id) => id > 0))]
        .sort((a, b) => a - b)
        .join(','),
    [lineRows],
  )

  useEffect(() => {
    if (!open) return undefined
    const ids = lineItemIdsKey
      ? lineItemIdsKey.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0)
      : []
    if (!ids.length) return undefined
    const ac = new AbortController()
    for (const id of ids) {
      setItemAvail((prev) => ({ ...prev, [id]: { status: 'loading' } }))
    }
    void Promise.all(
      ids.map(async (id) => {
        try {
          const r = await api.get('/inventory/availability/', {
            params: { item_id: id },
            signal: ac.signal,
          })
          if (ac.signal.aborted) return
          setItemAvail((prev) => ({ ...prev, [id]: { status: 'ok', data: r.data as AvailabilityResponse } }))
        } catch (e: unknown) {
          if (ac.signal.aborted) return
          const err = e as { code?: string; name?: string }
          if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return
          setItemAvail((prev) => ({
            ...prev,
            [id]: { status: 'error', message: extractErrorMessage(e, 'Could not load stock') },
          }))
        }
      }),
    )
    return () => ac.abort()
  }, [open, lineItemIdsKey, availFetchSeq])

  const stationNum = typeof stationId === 'number' ? stationId : NaN
  const pondNum = pondId.trim() !== '' ? parseInt(pondId, 10) : NaN

  const itemOptions = useMemo(() => {
    let list = items
    if (categoryFilter) {
      list = list.filter((it) => (it.pos_category || 'general').toLowerCase() === categoryFilter)
    }
    if (onlyInStock && Number.isFinite(stationNum)) {
      list = list.filter((it) => {
        const st = itemAvail[it.id]
        if (!st || st.status !== 'ok' || !st.data.tracks_per_station) return false
        return qtyAtSourceStation(st.data, stationNum).qtyNum > 0
      })
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [items, categoryFilter, onlyInStock, stationNum, itemAvail])

  const issues = useMemo(
    () =>
      validatePondWarehouseLines({
        stationId,
        pondId: Number.isFinite(pondNum) ? pondNum : '',
        lineRows,
        itemAvail,
        sourceCreditByItemId,
      }),
    [stationId, pondNum, lineRows, itemAvail, sourceCreditByItemId],
  )

  const addLine = () => setLineRows((prev) => [...prev, { item_id: 0, quantity: '1' }])
  const updateLine = (i: number, field: keyof TransferLineRow, value: string | number) => {
    setLineRows((prev) => {
      const next = [...prev]
      if (field === 'item_id') {
        next[i] = {
          ...next[i],
          item_id: typeof value === 'number' ? value : parseInt(String(value), 10) || 0,
        }
      } else {
        next[i] = { ...next[i], quantity: String(value) }
      }
      return next
    })
  }
  const removeLine = (i: number) => {
    setLineRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))
  }

  const applyMaxQty = (lineIndex: number) => {
    if (!Number.isFinite(stationNum)) return
    setLineRows((prev) => {
      const row = prev[lineIndex]
      if (!row || row.item_id <= 0) return prev
      const st = itemAvail[row.item_id]
      if (!st || st.status !== 'ok' || !st.data.tracks_per_station) return prev
      const { qtyNum } = qtyAtSourceStation(st.data, stationNum)
      const credit = sourceCreditByItemId?.[row.item_id] ?? 0
      const others = sumQtySameItemOtherLines(prev, row.item_id, lineIndex)
      const max = Math.max(0, qtyNum + credit - others)
      const qtyStr = Number.isInteger(max) ? String(max) : String(Math.round(max * 1e6) / 1e6)
      const next = [...prev]
      next[lineIndex] = { ...next[lineIndex], quantity: qtyStr }
      return next
    })
  }

  const submit = async () => {
    if (issues.length > 0) {
      toast.error(issues[0])
      return
    }
    const lines = lineRows
      .map((r) => ({ item_id: r.item_id, q: parseQtyInput(r.quantity) }))
      .filter((r) => r.item_id > 0 && Number.isFinite(r.q) && r.q > 0)
    setSaving(true)
    try {
      const payload = {
        station_id: stationId,
        pond_id: pondNum,
        items: lines.map((x) => ({ item_id: x.item_id, quantity: String(x.q) })),
      }
      if (editingReceipt) {
        await api.put(`/inventory/pond-warehouse-receipts/${editingReceipt.id}/`, payload)
        toast.success('Pond receipt updated — shop and pond warehouse adjusted.')
      } else {
        await api.post('/aquaculture/pond-warehouse-transfer/', payload)
        const pname = activePonds.find((p) => p.id === pondNum)?.name || `Pond #${pondNum}`
        toast.success(`Stock added to ${pname} warehouse`)
      }
      onSuccess?.()
      onClose()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not add stock to pond'))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, saving, onClose])

  if (!open) return null

  const categoryChips: { id: CategoryFilter; label: string }[] = [
    { id: '', label: 'All products' },
    { id: 'feed', label: 'Feed' },
    { id: 'medicine', label: 'Medicine' },
    { id: 'general', label: 'Supplies' },
    { id: 'fish', label: 'Fish / fry' },
  ]

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-foreground/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pond-wh-add-title"
      onClick={() => {
        if (!saving) onClose()
      }}
    >
      <div
        className="flex max-h-[min(92vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            <h2 id="pond-wh-add-title" className="text-base font-semibold text-foreground">
              Add stock to pond warehouse
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Move feed, medicine, or supplies from your shop into a pond. No COGS until you consume or apply feeding
              advice.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
            disabled={saving}
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {loadingMeta ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
              Loading shops and products…
            </div>
          ) : activePonds.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Add an active pond under <strong>Aquaculture → Ponds</strong> first.
            </p>
          ) : activeStations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Add an active shop site under <strong>Sites</strong> with stock on hand.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelCls}>
                  Destination pond
                  <select
                    className={inputCls}
                    value={pondId}
                    disabled={lockPond || saving}
                    onChange={(e) => setPondId(e.target.value)}
                  >
                    <option value="">Select pond…</option>
                    {activePonds.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  From shop site
                  <select
                    className={inputCls}
                    value={stationId === '' ? '' : String(stationId)}
                    disabled={homeStationId != null || saving}
                    onChange={(e) =>
                      setStationId(e.target.value ? parseInt(e.target.value, 10) : '')
                    }
                  >
                    <option value="">Select site…</option>
                    {activeStations.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {formatStationTransferLabel(s)}
                      </option>
                    ))}
                  </select>
                  {homeStationId != null ? (
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      Locked to your home station.
                    </span>
                  ) : null}
                </label>
              </div>

              <div>
                <p className="text-xs font-medium text-foreground/85">Product type</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {categoryChips.map((c) => (
                    <button
                      key={c.id || 'all'}
                      type="button"
                      disabled={saving}
                      onClick={() => setCategoryFilter(c.id)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        categoryFilter === c.id
                          ? 'bg-primary text-white'
                          : 'bg-muted text-foreground/85 hover:bg-muted'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={onlyInStock}
                    disabled={!Number.isFinite(stationNum) || saving}
                    onChange={(e) => setOnlyInStock(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-teal-500"
                  />
                  Only show products with stock at this shop
                </label>
              </div>

              <div className="rounded-lg border border-border">
                <div className="border-b border-border/70 bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Products to move
                </div>
                <div className="divide-y divide-border/70 p-3 space-y-3">
                  {lineRows.map((row, i) => {
                    const st = row.item_id > 0 ? itemAvail[row.item_id] : null
                    let availHint: string | null = null
                    if (st?.status === 'loading') availHint = 'Loading shop stock…'
                    else if (st?.status === 'error') availHint = st.message
                    else if (st?.status === 'ok' && st.data.tracks_per_station && Number.isFinite(stationNum)) {
                      const { qtyNum, unit } = qtyAtSourceStation(st.data, stationNum)
                      const others = sumQtySameItemOtherLines(lineRows, row.item_id, i)
                      const maxLine = Math.max(0, qtyNum - others)
                      availHint =
                        qtyNum > 0
                          ? `${qtyNum.toLocaleString()} ${unit} at shop · max this line ${maxLine.toLocaleString()}`
                          : 'No stock at this shop'
                    } else if (st?.status === 'ok' && !st.data.tracks_per_station) {
                      availHint = 'Not tracked per shop bin'
                    }
                    const selected = items.find((it) => it.id === row.item_id)
                    return (
                      <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <label className={`min-w-0 flex-1 ${labelCls}`}>
                          Product
                          <select
                            className={inputCls}
                            value={row.item_id > 0 ? String(row.item_id) : ''}
                            disabled={saving}
                            onChange={(e) =>
                              updateLine(i, 'item_id', e.target.value ? parseInt(e.target.value, 10) : 0)
                            }
                          >
                            <option value="">Select product…</option>
                            {itemOptions.length === 0 ? (
                              <option value="" disabled>
                                {onlyInStock ? 'Nothing in stock at this shop' : 'No products match filter'}
                              </option>
                            ) : (
                              Object.entries(
                                itemOptions.reduce<Record<string, PosTransferItem[]>>((acc, it) => {
                                  const g = pondWarehouseShelfLabel(it.pos_category)
                                  if (!acc[g]) acc[g] = []
                                  acc[g].push(it)
                                  return acc
                                }, {}),
                              ).map(([group, groupItems]) => (
                                <optgroup key={group} label={group}>
                                  {groupItems.map((it) => (
                                    <option key={it.id} value={String(it.id)}>
                                      {it.name}
                                      {it.item_number ? ` (${it.item_number})` : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              ))
                            )}
                          </select>
                          {selected ? (
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {pondWarehouseShelfLabel(selected.pos_category)}
                            </span>
                          ) : null}
                        </label>
                        <label className={`w-full sm:w-28 ${labelCls}`}>
                          Quantity
                          <input
                            type="text"
                            inputMode="decimal"
                            className={inputCls}
                            value={row.quantity}
                            disabled={saving}
                            onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                          />
                        </label>
                        <div className="flex shrink-0 gap-1 pb-0.5 sm:pb-2">
                          <button
                            type="button"
                            title="Use maximum available at shop"
                            disabled={saving || row.item_id <= 0}
                            onClick={() => applyMaxQty(i)}
                            className="rounded-lg border border-border px-2 py-2 text-xs font-medium text-foreground/85 hover:bg-muted/40 disabled:opacity-40"
                          >
                            Max
                          </button>
                          <button
                            type="button"
                            aria-label="Remove line"
                            disabled={saving || lineRows.length <= 1}
                            onClick={() => removeLine(i)}
                            className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        {availHint ? (
                          <p className="text-[11px] text-muted-foreground sm:col-span-3 -mt-1">{availHint}</p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                <div className="border-t border-border/70 px-3 py-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={addLine}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-teal-950"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add another product
                  </button>
                </div>
              </div>

              {issues.length > 0 ? (
                <ul className="list-inside list-disc rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                  {issues.map((msg, idx) => (
                    <li key={idx}>{msg}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-muted/50 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              saving ||
              loadingMeta ||
              activePonds.length === 0 ||
              activeStations.length === 0 ||
              issues.length > 0
            }
            onClick={() => void submit()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
            Add to pond warehouse
          </button>
        </div>
      </div>
    </div>
  )
}
