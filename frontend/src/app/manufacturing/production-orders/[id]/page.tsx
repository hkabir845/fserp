'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { api } from '@/lib/api'
import { formatQuantity } from '@/utils/quantity'

interface ProductionOrder {
  id: number
  order_number: string
  bom_id: number
  batch_size_ton: number
  status: string
  planned_output_kg: number
  actual_output_kg?: number
  yield_pct?: number
  material_cost?: number
  total_cost?: number
  cost_per_kg?: number
  warehouse_id?: number
}

interface ProductionOrderLine {
  id: number
  ingredient_id: number
  ingredient_item_id?: number | null
  ingredient_name?: string | null
  required_qty_kg: number
  required_qty_with_loss_kg: number
  consumed_qty_kg?: number
  unit_cost?: number
  total_cost?: number
  lot_id?: number | null
  silo_id?: number | null
  silo_name?: string | null
  silo_consumed_kg?: number | null
}

interface SiloOption {
  id: number
  name: string
  item_id: number
  warehouse_id: number
}

export default function ProductionOrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orderId = parseInt(params.id as string)
  const queryClient = useQueryClient()

  const [showPostForm, setShowPostForm] = useState(false)
  const [postData, setPostData] = useState({
    actual_output_kg: 0,
    yield_pct: undefined as number | undefined
  })

  // Fetch order
  const { data: order, isLoading } = useQuery<ProductionOrder>({
    queryKey: ['production-order', orderId],
    queryFn: async () => {
      const response = await api.get(`/feed/production-orders/${orderId}`)
      return response.data
    },
    enabled: !!orderId,
  })

  const { data: meta } = useQuery<any>({
    queryKey: ['production-order-meta', orderId],
    queryFn: async () => {
      const response = await api.get(`/feed/production-orders/${orderId}/meta`)
      return response.data
    },
    enabled: !!orderId,
    retry: false,
    refetchOnWindowFocus: false,
  })

  // Fetch order lines (requirements)
  const { data: orderLines } = useQuery<ProductionOrderLine[]>({
    queryKey: ['production-order-lines', orderId],
    queryFn: async () => {
      const response = await api.get(`/feed/production-orders/${orderId}/lines`)
      return response.data || []
    },
    enabled: !!orderId,
  })

  // ===== Factory-grade operations (Issue -> Complete -> Pack) =====
  const [issueDraft, setIssueDraft] = useState<Record<number, string>>({})
  useEffect(() => {
    if (!orderLines || orderLines.length === 0) return
    setIssueDraft((prev) => {
      // initialize only once / for missing keys
      const next = { ...prev }
      for (const l of orderLines) {
        if (next[l.id] == null) {
          next[l.id] = String(l.required_qty_with_loss_kg ?? 0)
        }
      }
      return next
    })
  }, [orderLines])

  const { data: siloOptions = [] } = useQuery<SiloOption[]>({
    queryKey: ['silos-for-po', meta?.warehouse_id],
    queryFn: async () => {
      const r = await api.get('/feed/silos', { params: { warehouse_id: meta?.warehouse_id } })
      return r.data
    },
    enabled: !!meta?.warehouse_id,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const assignSiloMutation = useMutation({
    mutationFn: async ({ lineId, siloId }: { lineId: number; siloId: number | null }) => {
      return api.put(`/feed/production-orders/${orderId}/lines/${lineId}/silo`, { silo_id: siloId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-order-lines', orderId] })
    },
  })

  const issueMaterialsMutation = useMutation({
    mutationFn: async () => {
      const material_issues = (orderLines || []).map((l) => ({
        order_line_id: l.id,
        consumed_qty_kg: Number(issueDraft[l.id] ?? l.required_qty_with_loss_kg ?? 0),
        silo_id: l.silo_id ?? undefined,
      }))
      return api.post(`/feed/production-orders/${orderId}/issue-materials`, { material_issues })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['production-order-lines', orderId] })
      queryClient.invalidateQueries({ queryKey: ['production-orders'] })
      queryClient.invalidateQueries({ queryKey: ['silos'] })
      queryClient.invalidateQueries({ queryKey: ['silos-for-po', meta?.warehouse_id] })
    },
  })

  const [completeData, setCompleteData] = useState({ actual_output_kg: '' })
  useEffect(() => {
    if (!order) return
    if (completeData.actual_output_kg !== '') return
    setCompleteData({ actual_output_kg: String(order.planned_output_kg ?? 0) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order])

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!meta?.finished_item_id) throw new Error('Missing finished item metadata')
      return api.post(`/feed/production-orders/${orderId}/complete`, {
        actual_output_kg: Number(completeData.actual_output_kg),
        finished_item_id: meta.finished_item_id,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['production-orders'] })
    },
  })

  const unpostMutation = useMutation({
    mutationFn: async () => api.post(`/feed/production-orders/${orderId}/unpost`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['production-order-lines', orderId] })
      queryClient.invalidateQueries({ queryKey: ['production-orders'] })
      queryClient.invalidateQueries({ queryKey: ['silos'] })
    },
    onError: (err: unknown) => {
      const ax = err as { response?: { data?: { detail?: string } } }
      alert(ax.response?.data?.detail || 'Could not roll back this production order.')
    },
  })

  const handleUnpost = () => {
    const msg =
      order?.status === 'completed'
        ? 'Roll back this completed batch? Finished goods will leave inventory and raw materials will be restored. The order returns to draft.'
        : 'Roll back material issue? Consumed ingredients return to warehouse stock and the order returns to draft.'
    if (confirm(msg)) {
      unpostMutation.mutate()
    }
  }

  const { data: items = [] } = useQuery<any[]>({
    queryKey: ['items-for-packing'],
    queryFn: async () => {
      const res = await api.get('/items?limit=1000&include_inactive=false')
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const bagOptions = useMemo(() => {
    return (items || []).filter((it) => {
      const sku = String(it.sku || '').toUpperCase()
      const name = String(it.name || '').toLowerCase()
      return sku.startsWith('PKG') || name.includes('bag')
    })
  }, [items])

  const [packData, setPackData] = useState({ bag_item_id: 0, pack_size_kg: 25, bags_count: 0 })
  const packMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/feed/production-orders/${orderId}/pack`, packData)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['production-orders'] })
    },
  })

  // Fetch QC results (optional)
  const { data: qc } = useQuery<any>({
    queryKey: ['production-order-qc', orderId],
    queryFn: async () => {
      const response = await api.get(`/feed/production-orders/${orderId}/qc`)
      return response.data
    },
    enabled: !!orderId,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const [showQcForm, setShowQcForm] = useState(false)
  const [qcForm, setQcForm] = useState({
    actual_protein_pct: '',
    actual_fat_pct: '',
    actual_fiber_pct: '',
    actual_moisture_pct: '',
    actual_ash_pct: '',
    actual_energy_kcal: '',
    notes: '',
  })

  const saveQcMutation = useMutation({
    mutationFn: async (payload: any) => {
      return api.post(`/feed/production-orders/${orderId}/qc`, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-order-qc', orderId] })
      setShowQcForm(false)
    },
  })

  const handleSaveQc = () => {
    const toNum = (v: string) => (v.trim() === '' ? undefined : Number(v))
    saveQcMutation.mutate({
      actual_protein_pct: toNum(qcForm.actual_protein_pct),
      actual_fat_pct: toNum(qcForm.actual_fat_pct),
      actual_fiber_pct: toNum(qcForm.actual_fiber_pct),
      actual_moisture_pct: toNum(qcForm.actual_moisture_pct),
      actual_ash_pct: toNum(qcForm.actual_ash_pct),
      actual_energy_kcal: toNum(qcForm.actual_energy_kcal),
      notes: qcForm.notes || undefined,
    })
  }

  // Post production mutation
  const postMutation = useMutation({
    mutationFn: async (data: any) => {
      return api.post(`/feed/production-orders/${orderId}/post`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['production-orders'] })
      setShowPostForm(false)
    },
  })

  const handlePost = () => {
    if (postData.actual_output_kg <= 0) {
      alert('Please enter actual output quantity')
      return
    }
    if (confirm('Post this production order? This will consume materials and produce finished goods.')) {
      postMutation.mutate(postData)
    }
  }

  if (isLoading) {
    return (
              <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading order...</p>
          </div>
        </div>
    )
  }

  if (!order) {
    return (
              <div className="bg-white rounded-lg shadow p-6">
          <p className="text-destructive">Order not found</p>
        </div>
    )
  }

  return (
          <div className="space-y-6">
        {/* Order Header */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-2xl font-bold">{order.order_number}</h2>
              <p className="text-muted-foreground mt-1">Batch Size: {order.batch_size_ton} ton</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span
                className={`px-3 py-1 text-sm font-semibold rounded-full ${
                  order.status === 'completed'
                    ? 'bg-success/15 text-success'
                    : order.status === 'in_progress'
                    ? 'bg-blue-100 text-primary'
                    : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {order.status}
              </span>
              {(order.status === 'in_progress' || order.status === 'completed') && (
                <button
                  type="button"
                  onClick={handleUnpost}
                  disabled={unpostMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-warning/10 px-3 py-1.5 text-sm font-medium text-warning-foreground hover:bg-amber-100 disabled:opacity-50"
                  title="Reverse stock movements and return order to draft"
                >
                  <Undo2 className="h-4 w-4" aria-hidden />
                  {unpostMutation.isPending ? 'Rolling back…' : 'Rollback to draft'}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Planned Output</label>
              <p className="font-medium">{order.planned_output_kg.toFixed(2)} kg</p>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Actual Output</label>
              <p className="font-medium">
                {order.actual_output_kg ? order.actual_output_kg.toFixed(2) + ' kg' : '-'}
              </p>
            </div>
            {order.yield_pct && (
              <div>
                <label className="text-sm text-muted-foreground">Yield</label>
                <p className="font-medium">{order.yield_pct.toFixed(2)}%</p>
              </div>
            )}
            {order.cost_per_kg && (
              <div>
                <label className="text-sm text-muted-foreground">Cost/kg</label>
                <p className="font-medium">₹{order.cost_per_kg.toFixed(4)}</p>
              </div>
            )}
          </div>

          {order.status === 'draft' && (
            <div className="mt-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => issueMaterialsMutation.mutate()}
                  disabled={issueMaterialsMutation.isPending || !orderLines || orderLines.length === 0}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {issueMaterialsMutation.isPending ? 'Issuing…' : 'Issue Materials'}
                </button>
                <button
                  onClick={() => setShowPostForm(!showPostForm)}
                  className="bg-muted text-foreground px-4 py-2 rounded-md hover:bg-muted"
                >
                  {showPostForm ? 'Hide legacy Post' : 'Legacy: Post in one step'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Post Production Form */}
        {showPostForm && order.status === 'draft' && (
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
            <h3 className="font-semibold mb-4">Post Production</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">
                  Actual Output (kg) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={postData.actual_output_kg}
                  onChange={(e) => {
                    const actual = parseFloat(e.target.value) || 0
                    const yield_pct = order.planned_output_kg > 0
                      ? (actual / order.planned_output_kg) * 100
                      : undefined
                    setPostData({ actual_output_kg: actual, yield_pct })
                  }}
                  className="w-full rounded-md border-border shadow-sm focus:border-ring focus:ring-ring sm:text-sm px-3 py-2 border"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">
                  Yield %
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={postData.yield_pct || ''}
                  readOnly
                  className="w-full rounded-md border-border shadow-sm bg-muted/40 sm:text-sm px-3 py-2 border"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Auto-calculated from actual output
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handlePost}
                disabled={postMutation.isPending}
                className="bg-success text-white px-4 py-2 rounded-md hover:bg-success/90 disabled:opacity-50"
              >
                {postMutation.isPending ? 'Posting...' : 'Confirm Post'}
              </button>
              <button
                onClick={() => setShowPostForm(false)}
                className="bg-muted text-foreground/85 px-4 py-2 rounded-md hover:bg-muted-foreground/50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Requirements */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Ingredient Requirements</h3>
          {orderLines && orderLines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Ingredient</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Silo</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Required (kg)</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">With loss (kg)</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Consumed (kg)</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Unit cost</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border/70">
                  {orderLines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2 text-sm text-foreground">
                        <div className="font-medium">{l.ingredient_name || `Ingredient #${l.ingredient_id}`}</div>
                        {l.ingredient_item_id != null && (
                          <div className="text-xs text-muted-foreground">Item #{l.ingredient_item_id}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-foreground">
                        {(order.status === 'draft' || order.status === 'planned') && meta?.warehouse_id ? (
                          <select
                            value={l.silo_id ?? ''}
                            disabled={assignSiloMutation.isPending}
                            onChange={(e) => {
                              const raw = e.target.value
                              assignSiloMutation.mutate({
                                lineId: l.id,
                                siloId: raw === '' ? null : Number(raw),
                              })
                            }}
                            className="max-w-[200px] rounded-md border border-border px-2 py-1 text-xs"
                          >
                            <option value="">— None —</option>
                            {siloOptions
                              .filter((s) => s.item_id === l.ingredient_item_id)
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <span>{l.silo_name || '—'}</span>
                        )}
                        {l.silo_consumed_kg != null && l.silo_consumed_kg !== undefined ? (
                          <div className="text-xs text-muted-foreground mt-0.5">From silo: {formatQuantity(l.silo_consumed_kg)} kg</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-sm text-foreground text-right">{formatQuantity(l.required_qty_kg)}</td>
                      <td className="px-4 py-2 text-sm text-foreground text-right">{formatQuantity(l.required_qty_with_loss_kg)}</td>
                      <td className="px-4 py-2 text-sm text-foreground text-right">
                        {l.consumed_qty_kg != null ? formatQuantity(l.consumed_qty_kg) : '-'}
                      </td>
                      <td className="px-4 py-2 text-sm text-foreground text-right">
                        {l.unit_cost != null ? `₹${Number(l.unit_cost).toFixed(4)}` : '-'}
                      </td>
                      <td className="px-4 py-2 text-sm text-foreground text-right">
                        {l.total_cost != null ? `₹${Number(l.total_cost).toFixed(2)}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground">
              Requirements are calculated from the BOM. (Next: we’ll expose lines via API so they render here.)
            </p>
          )}

          {/* Issue editor (draft) */}
          {order.status === 'draft' && orderLines && orderLines.length > 0 && (
            <div className="mt-6 rounded-lg border border-primary/25 bg-accent p-4">
              <div className="text-sm font-semibold text-foreground/85">Issue materials (edit quantities)</div>
              <p className="text-xs text-primary mt-1">
                Default is “With loss”. Adjust if actual issued differs. If a silo is selected above, issue will draw that
                amount from the silo level as well as warehouse stock.
              </p>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {orderLines.map((l) => (
                  <div key={l.id} className="rounded-md bg-white border border-primary/15 p-3">
                    <div className="text-sm font-semibold text-foreground">{l.ingredient_name || `Ingredient #${l.ingredient_id}`}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Required with loss: {formatQuantity(l.required_qty_with_loss_kg)} kg
                    </div>
                    <div className="mt-2">
                      <label className="block text-xs font-medium text-foreground/85 mb-1">Issue qty (kg)</label>
                      <input
                        value={issueDraft[l.id] ?? ''}
                        onChange={(e) => setIssueDraft({ ...issueDraft, [l.id]: e.target.value })}
                        className="w-full rounded-md border border-border px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => issueMaterialsMutation.mutate()}
                  disabled={issueMaterialsMutation.isPending}
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {issueMaterialsMutation.isPending ? 'Issuing…' : 'Confirm Issue'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Complete (in progress) */}
        {order.status === 'in_progress' && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">Complete production</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Posts finished goods into inventory and finalizes costing.
                </p>
                <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                  Use <span className="font-semibold">Rollback to draft</span> above to reverse material issue and
                  restore ingredient stock without completing the batch.
                </p>
                {meta?.finished_item_name && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Finished item: <span className="font-semibold">{meta.finished_item_name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Actual output (kg)</label>
                <input
                  value={completeData.actual_output_kg}
                  onChange={(e) => setCompleteData({ actual_output_kg: e.target.value })}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
                className="inline-flex items-center rounded-md bg-success px-4 py-2 text-sm font-semibold text-white hover:bg-success/90 disabled:opacity-50"
              >
                {completeMutation.isPending ? 'Completing…' : 'Complete Production'}
              </button>
            </div>
          </div>
        )}

        {/* Pack (completed) */}
        {order.status === 'completed' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold">Packing</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Records a packing operation and consumes packaging stock (0.05 kg per bag).
            </p>
            <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
              After packing is recorded, rollback is blocked. Use <span className="font-semibold">Rollback to draft</span>{' '}
              in the header first if you need to undo the batch before packing.
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Bag item</label>
                <select
                  value={packData.bag_item_id}
                  onChange={(e) => setPackData({ ...packData, bag_item_id: Number(e.target.value) })}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  <option value={0}>Select packaging item…</option>
                  {bagOptions.map((it: any) => (
                    <option key={it.id} value={it.id}>
                      {it.sku} — {it.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Pack size (kg)</label>
                <input
                  type="number"
                  value={packData.pack_size_kg}
                  onChange={(e) => setPackData({ ...packData, pack_size_kg: Number(e.target.value) })}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Bags count</label>
                <input
                  type="number"
                  value={packData.bags_count}
                  onChange={(e) => setPackData({ ...packData, bags_count: Number(e.target.value) })}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => packMutation.mutate()}
                disabled={packMutation.isPending || packData.bag_item_id === 0 || packData.bags_count <= 0}
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {packMutation.isPending ? 'Packing…' : 'Record Packing'}
              </button>
            </div>
          </div>
        )}

        {/* QC */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Quality Control</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Record lab results and track pass/fail vs BOM targets.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowQcForm((v) => !v)}
              className="inline-flex items-center justify-center rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
            >
              {showQcForm ? 'Close' : 'Add / Edit QC'}
            </button>
          </div>

          {qc && !qc.message && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase">Overall</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {qc.overall_pass == null ? '—' : qc.overall_pass ? 'PASS' : 'FAIL'}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase">Protein</div>
                <div className="mt-1 text-sm text-foreground">{qc.actual_protein_pct ?? '—'}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase">Fat</div>
                <div className="mt-1 text-sm text-foreground">{qc.actual_fat_pct ?? '—'}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase">Moisture</div>
                <div className="mt-1 text-sm text-foreground">{qc.actual_moisture_pct ?? '—'}</div>
              </div>
            </div>
          )}

          {showQcForm && (
            <div className="mt-6 rounded-lg border border-border p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Protein %</label>
                  <input
                    value={qcForm.actual_protein_pct}
                    onChange={(e) => setQcForm({ ...qcForm, actual_protein_pct: e.target.value })}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    placeholder="e.g. 28.5"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Fat %</label>
                  <input
                    value={qcForm.actual_fat_pct}
                    onChange={(e) => setQcForm({ ...qcForm, actual_fat_pct: e.target.value })}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    placeholder="e.g. 6.2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Fiber %</label>
                  <input
                    value={qcForm.actual_fiber_pct}
                    onChange={(e) => setQcForm({ ...qcForm, actual_fiber_pct: e.target.value })}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    placeholder="e.g. 3.1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Moisture %</label>
                  <input
                    value={qcForm.actual_moisture_pct}
                    onChange={(e) => setQcForm({ ...qcForm, actual_moisture_pct: e.target.value })}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    placeholder="e.g. 10.0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Ash %</label>
                  <input
                    value={qcForm.actual_ash_pct}
                    onChange={(e) => setQcForm({ ...qcForm, actual_ash_pct: e.target.value })}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    placeholder="e.g. 7.5"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Energy (kcal)</label>
                  <input
                    value={qcForm.actual_energy_kcal}
                    onChange={(e) => setQcForm({ ...qcForm, actual_energy_kcal: e.target.value })}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    placeholder="e.g. 3200"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-foreground/85 mb-1">Notes</label>
                <textarea
                  value={qcForm.notes}
                  onChange={(e) => setQcForm({ ...qcForm, notes: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveQc}
                  disabled={saveQcMutation.isPending}
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {saveQcMutation.isPending ? 'Saving…' : 'Save QC'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowQcForm(false)}
                  className="inline-flex items-center rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
  )
}

