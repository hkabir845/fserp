'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import {
  type PondListItem,
  type PosTransferItem,
  type TransferLineRow,
  comparePondsForTransfer,
  parseQtyInput,
  pondWarehouseShelfLabel,
} from '@/lib/pondWarehouseTransferUtils'

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20'
const labelCls = 'block text-xs font-medium text-slate-700'

type PondRow = PondListItem & {
  warehouse_group_id?: number | null
  warehouse_group_name?: string
}

export function PondWarehouseInterPondModal(props: {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  initialFromPondId?: number | null
  initialToPondId?: number | null
}) {
  const { open, onClose, onSuccess, initialFromPondId, initialToPondId } = props
  const toast = useToast()

  const [loadingMeta, setLoadingMeta] = useState(false)
  const [ponds, setPonds] = useState<PondRow[]>([])
  const [items, setItems] = useState<PosTransferItem[]>([])
  const [fromPondId, setFromPondId] = useState('')
  const [toPondId, setToPondId] = useState('')
  const [memo, setMemo] = useState('')
  const [lineRows, setLineRows] = useState<TransferLineRow[]>([{ item_id: 0, quantity: '1' }])
  const [fromStock, setFromStock] = useState<{ item_id: number; quantity: string; item_name: string; unit: string }[]>(
    [],
  )
  const [loadingStock, setLoadingStock] = useState(false)
  const [saving, setSaving] = useState(false)

  const activePonds = useMemo(
    () => [...ponds.filter((p) => p.is_active !== false)].sort(comparePondsForTransfer),
    [ponds],
  )

  const fromPond = useMemo(
    () => activePonds.find((p) => String(p.id) === fromPondId),
    [activePonds, fromPondId],
  )
  const toPond = useMemo(() => activePonds.find((p) => String(p.id) === toPondId), [activePonds, toPondId])

  const groupHint = useMemo(() => {
    if (!fromPond || !toPond) return ''
    const fg = fromPond.warehouse_group_id
    const tg = toPond.warehouse_group_id
    if (fg && tg && fg === tg) {
      return `Shared warehouse: ${fromPond.warehouse_group_name || 'group'} — reallocate between ponds (no GL).`
    }
    if (!fg && !tg) return 'Private pond warehouses — move stock between ponds (no GL).'
    return 'Source and destination must both be in the same shared warehouse group, or both have no group.'
  }, [fromPond, toPond])

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true)
    try {
      const [pondRes, itRes] = await Promise.all([
        api.get('/aquaculture/ponds/'),
        api.get('/items/', { params: { pos_only: 'true' } }),
      ])
      const rawPonds = Array.isArray(pondRes.data) ? pondRes.data : []
      setPonds(
        rawPonds.map((p: Record<string, unknown>) => ({
          id: Number(p.id),
          name: String(p.name || ''),
          sort_order: Number(p.sort_order ?? 0),
          is_active: p.is_active !== false,
          warehouse_group_id: p.warehouse_group_id != null ? Number(p.warehouse_group_id) : null,
          warehouse_group_name: String(p.warehouse_group_name || ''),
        })),
      )
      const rawItems = Array.isArray(itRes.data) ? itRes.data : []
      setItems(
        rawItems
          .map((it: Record<string, unknown>) => ({
            id: Number(it.id),
            name: String(it.name || ''),
            item_number: String(it.item_number || ''),
            pos_category: String(it.pos_category || 'general'),
          }))
          .filter((it) => ['feed', 'medicine', 'general'].includes((it.pos_category || 'general').toLowerCase())),
      )
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds and items'))
    } finally {
      setLoadingMeta(false)
    }
  }, [toast])

  const loadFromStock = useCallback(async () => {
    const pid = parseInt(fromPondId, 10)
    if (!Number.isFinite(pid)) {
      setFromStock([])
      return
    }
    setLoadingStock(true)
    try {
      const { data } = await api.get<{ items?: { item_id: number; item_name: string; quantity: string; unit: string }[] }>(
        `/aquaculture/ponds/${pid}/warehouse-stock/`,
      )
      setFromStock(
        (data.items || []).map((r) => ({
          item_id: r.item_id,
          item_name: r.item_name,
          quantity: r.quantity,
          unit: r.unit,
        })),
      )
    } catch (e) {
      setFromStock([])
      toast.error(extractErrorMessage(e, 'Could not load source pond stock'))
    } finally {
      setLoadingStock(false)
    }
  }, [fromPondId, toast])

  useEffect(() => {
    if (!open) return
    void loadMeta()
    setFromPondId(initialFromPondId != null ? String(initialFromPondId) : '')
    setToPondId(initialToPondId != null ? String(initialToPondId) : '')
    setMemo('')
    setLineRows([{ item_id: 0, quantity: '1' }])
  }, [open, loadMeta, initialFromPondId, initialToPondId])

  useEffect(() => {
    if (!open) return
    void loadFromStock()
  }, [open, loadFromStock])

  const submit = async () => {
    const fp = parseInt(fromPondId, 10)
    const tp = parseInt(toPondId, 10)
    if (!Number.isFinite(fp) || !Number.isFinite(tp)) {
      toast.error('Select source and destination ponds')
      return
    }
    const lines = lineRows
      .map((r) => ({ item_id: r.item_id, quantity: parseQtyInput(r.quantity) }))
      .filter((r) => r.item_id > 0 && r.quantity > 0)
    if (!lines.length) {
      toast.error('Add at least one product line with quantity')
      return
    }
    for (const l of lines) {
      const have = fromStock.find((s) => s.item_id === l.item_id)
      const qoh = have ? parseFloat(have.quantity) : 0
      if (l.quantity > qoh) {
        toast.error(`Not enough at source pond for ${have?.item_name || 'item'}`)
        return
      }
    }
    setSaving(true)
    try {
      await api.post('/aquaculture/pond-warehouse-inter-pond-transfers/', {
        from_pond_id: fp,
        to_pond_id: tp,
        items: lines.map((l) => ({ item_id: l.item_id, quantity: String(l.quantity) })),
        memo: memo.trim(),
      })
      toast.success('Stock moved between pond warehouses')
      onSuccess?.()
      onClose()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Transfer failed'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">Move between pond warehouses</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-4 py-4">
          {loadingMeta ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelCls}>
                  From pond
                  <select className={inputCls} value={fromPondId} onChange={(e) => setFromPondId(e.target.value)}>
                    <option value="">Select…</option>
                    {activePonds.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                        {p.warehouse_group_name ? ` · ${p.warehouse_group_name}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  To pond
                  <select className={inputCls} value={toPondId} onChange={(e) => setToPondId(e.target.value)}>
                    <option value="">Select…</option>
                    {activePonds.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                        {p.warehouse_group_name ? ` · ${p.warehouse_group_name}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {groupHint ? <p className="text-xs leading-relaxed text-slate-600">{groupHint}</p> : null}
              {fromPondId ? (
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {loadingStock ? (
                    'Loading source on hand…'
                  ) : fromStock.length === 0 ? (
                    'No stock at source pond.'
                  ) : (
                    <ul className="space-y-0.5">
                      {fromStock.map((s) => (
                        <li key={s.item_id}>
                          <span className="font-medium text-slate-800">{s.item_name}</span>: {s.quantity} {s.unit}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
              <label className={labelCls}>
                Memo (optional)
                <input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
              </label>
              <div>
                <p className={labelCls}>Lines</p>
                {lineRows.map((row, idx) => (
                  <div key={idx} className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="min-w-[10rem] flex-1 text-xs text-slate-600">
                      Product
                      <select
                        className={inputCls}
                        value={row.item_id || ''}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10)
                          setLineRows((rows) =>
                            rows.map((r, j) => (j === idx ? { ...r, item_id: Number.isFinite(v) ? v : 0 } : r)),
                          )
                        }}
                      >
                        <option value="">Select…</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name} ({pondWarehouseShelfLabel(it.pos_category)})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="w-24 text-xs text-slate-600">
                      Qty
                      <input
                        className={inputCls}
                        value={row.quantity}
                        onChange={(e) =>
                          setLineRows((rows) =>
                            rows.map((r, j) => (j === idx ? { ...r, quantity: e.target.value } : r)),
                          )
                        }
                      />
                    </label>
                    {lineRows.length > 1 ? (
                      <button
                        type="button"
                        className="mb-1 rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => setLineRows((rows) => rows.filter((_, j) => j !== idx))}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:text-teal-950"
                  onClick={() => setLineRows((rows) => [...rows, { item_id: 0, quantity: '1' }])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
                </button>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || loadingMeta}
            onClick={() => void submit()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            Transfer
          </button>
        </div>
      </div>
    </div>
  )
}
