'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { vehicleTypeLabel } from '@/lib/vehicle-types'
import { formatQuantity } from '@/utils/quantity'

type Tank = {
  id: number
  name: string
  fuel_grade: string
  fuel_item_id: number
  fuel_item_name: string | null
  capacity_liters: number
  current_stock_liters: number
  /** Liters-weighted average unit cost; drives default cost on internal vehicle issues */
  moving_avg_unit_cost?: number | null
}

type ItemRow = { id: number; sku: string; name: string; type: string }

type VehicleRow = { id: number; reg_no: string; type?: string }

type CostCenterRow = { id: number; code: string; name: string; is_active: boolean }

type FuelPoLine = {
  po_line_id: number
  po_id: number
  po_number: string
  supplier_id: number
  item_id: number
  outstanding_liters: number
  unit_price: number
}

export default function FuelStationPage() {
  const qc = useQueryClient()
  const [gradeFilter, setGradeFilter] = useState<string>('')

  const { data: tanks = [], isLoading, error } = useQuery({
    queryKey: ['fuel-tanks', gradeFilter],
    queryFn: async () => {
      const params = gradeFilter ? { fuel_grade: gradeFilter } : {}
      const res = await api.get<Tank[]>('/fuel/tanks', { params })
      return res.data
    },
    retry: false,
  })

  const { data: items = [] } = useQuery({
    queryKey: ['items-fuel'],
    queryFn: async () => {
      const res = await api.get<ItemRow[]>('/items')
      return res.data.filter((i) => i.type === 'fuel')
    },
    retry: false,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: ['transport-vehicles'],
    queryFn: async () => {
      const res = await api.get<VehicleRow[]>('/transport/vehicles')
      return res.data
    },
    retry: false,
  })

  const { data: costCenters = [] } = useQuery({
    queryKey: ['cost-centers'],
    queryFn: async () => {
      const res = await api.get<CostCenterRow[]>('/cost-centers')
      return res.data
    },
    retry: false,
  })

  const [tankName, setTankName] = useState('')
  const [itemId, setItemId] = useState<number | ''>('')
  const [capacity, setCapacity] = useState('50000')
  const [grade, setGrade] = useState<'diesel' | 'octane' | 'other'>('diesel')

  const createTank = useMutation({
    mutationFn: async () => {
      if (!tankName.trim() || itemId === '') throw new Error('Name and fuel item required')
      const res = await api.post('/fuel/tanks', {
        name: tankName.trim(),
        fuel_item_id: itemId,
        capacity_liters: Number(capacity),
        fuel_grade: grade,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel-tanks'] })
      setTankName('')
    },
  })

  const [recvTank, setRecvTank] = useState<number | ''>('')
  const [recvQty, setRecvQty] = useState('10000')
  const [recvCost, setRecvCost] = useState('95')
  const [recvPostGl, setRecvPostGl] = useState(true)

  const purchase = useMutation({
    mutationFn: async () => {
      if (recvTank === '') throw new Error('Tank')
      const res = await api.post('/fuel/purchases', {
        tank_id: recvTank,
        qty_liters: Number(recvQty),
        unit_cost: Number(recvCost),
        post_to_gl: recvPostGl,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel-tanks'] })
      qc.invalidateQueries({ queryKey: ['fuel-txns'] })
    },
  })

  const [issTank, setIssTank] = useState<number | ''>('')
  const [issVeh, setIssVeh] = useState<number | ''>('')
  const [issQty, setIssQty] = useState('200')
  const [issOdo, setIssOdo] = useState('')
  const [issCostCenter, setIssCostCenter] = useState<number | ''>('')
  const [issPostGl, setIssPostGl] = useState(true)

  const [poTank, setPoTank] = useState<number | ''>('')
  const [poLineId, setPoLineId] = useState<number | ''>('')
  const [poQty, setPoQty] = useState('5000')
  const [poPostGl, setPoPostGl] = useState(true)

  const poItemId = useMemo(() => {
    if (poTank === '') return null
    const t = tanks.find((x) => x.id === poTank)
    return t ? t.fuel_item_id : null
  }, [poTank, tanks])

  const { data: openPoLines = [] } = useQuery({
    queryKey: ['fuel-open-po-lines', poItemId],
    queryFn: async () => {
      if (!poItemId) return []
      const res = await api.get<FuelPoLine[]>('/fuel/open-po-lines', { params: { item_id: poItemId } })
      return res.data
    },
    enabled: poItemId != null,
    retry: false,
  })

  const createCostCenter = useMutation({
    mutationFn: async ({ code, name }: { code: string; name: string }) => {
      const res = await api.post('/cost-centers', { code, name })
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cost-centers'] }),
  })
  const [ccCode, setCcCode] = useState('')
  const [ccName, setCcName] = useState('')

  const receiveFromPo = useMutation({
    mutationFn: async () => {
      if (poTank === '' || poLineId === '') throw new Error('Tank and PO line required')
      const res = await api.post('/fuel/receive-from-po', {
        tank_id: poTank,
        po_line_id: poLineId,
        qty_liters: Number(poQty),
        post_to_gl: poPostGl,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel-tanks'] })
      qc.invalidateQueries({ queryKey: ['fuel-txns'] })
      qc.invalidateQueries({ queryKey: ['fuel-open-po-lines'] })
    },
  })

  const issue = useMutation({
    mutationFn: async () => {
      if (issTank === '' || issVeh === '') throw new Error('Tank and vehicle')
      const res = await api.post('/fuel/vehicle-issues', {
        tank_id: issTank,
        vehicle_id: issVeh,
        qty_liters: Number(issQty),
        odometer: issOdo ? Number(issOdo) : undefined,
        cost_center_id: issCostCenter === '' ? undefined : issCostCenter,
        post_to_gl: issPostGl,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel-tanks'] })
      qc.invalidateQueries({ queryKey: ['fuel-txns'] })
    },
  })

  const { data: txns = [] } = useQuery({
    queryKey: ['fuel-txns'],
    queryFn: async () => {
      const res = await api.get('/fuel/transactions')
      return res.data as { id: number; txn_type: string; qty_liters: number; date: string }[]
    },
    retry: false,
  })

  const gradeHint = useMemo(
    () => ({ diesel: 'Diesel road fuel (typically HSD)', octane: 'Gasoline / petrol (octane)', other: 'Other grades' }),
    [],
  )

  return (
          <div className="max-w-6xl space-y-8">
        <ReportingHubBreadcrumb current="Fuel station" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fuel station & refueling</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <strong>Internal fleet only</strong> — issue fuel from station tanks to company vehicles. Quantities and
            weighted-average cost per tank tie tank stock to the same rates used for GL (receipts: Dr Inventory / Cr
            GRNI; issues: Dr fleet expense / Cr Inventory). Catalog fuel items label diesel vs octane; do not double-book
            warehouse GRNs and PO-to-tank for the same liters.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-muted-foreground">Filter:</span>
          <button
            type="button"
            className={`rounded px-2 py-1 text-sm ${gradeFilter === '' ? 'bg-primary text-primary-foreground' : 'border border-border'}`}
            onClick={() => setGradeFilter('')}
          >
            All
          </button>
          {['diesel', 'octane', 'other'].map((g) => (
            <button
              key={g}
              type="button"
              className={`rounded px-2 py-1 text-sm capitalize ${gradeFilter === g ? 'bg-primary text-primary-foreground' : 'border border-border'}`}
              onClick={() => setGradeFilter(g)}
            >
              {g}
            </button>
          ))}
        </div>

        {error ? (
          <div className="erp-alert-warning">
            Could not load fuel data. Ensure a tenant is selected and the backend is running.
          </div>
        ) : null}

        <section className="rounded-xl border border-primary/15 bg-accent/60 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Cost centers (department / P&amp;L)</h2>
          <p className="mt-1 text-xs text-muted-foreground">Tag vehicle refueling for management reporting. Journal lines store this dimension when GL posting is on.</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input
              className="rounded-md border px-3 py-2 text-sm"
              placeholder="Code (e.g. TRANSP)"
              value={ccCode}
              onChange={(e) => setCcCode(e.target.value)}
            />
            <input
              className="min-w-[200px] flex-1 rounded-md border px-3 py-2 text-sm"
              placeholder="Name"
              value={ccName}
              onChange={(e) => setCcName(e.target.value)}
            />
            <button
              type="button"
              disabled={createCostCenter.isPending || !ccCode.trim() || !ccName.trim()}
              onClick={() => {
                createCostCenter.mutate({ code: ccCode.trim().toUpperCase(), name: ccName.trim() })
                setCcCode('')
                setCcName('')
              }}
              className="erp-btn-primary rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Add center
            </button>
          </div>
          {costCenters.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2 text-xs text-foreground/85">
              {costCenters.map((c) => (
                <li key={c.id} className="rounded border border-primary/25 bg-white px-2 py-1">
                  <strong>{c.code}</strong> — {c.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No cost centers yet — add at least one to allocate fleet fuel.</p>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="erp-panel">
            <h2 className="text-sm font-semibold text-foreground">New storage tank</h2>
            <p className="mt-1 text-xs text-muted-foreground">{gradeHint[grade]}</p>
            <div className="mt-3 grid gap-2">
              <input
                className="rounded-md border px-3 py-2 text-sm"
                placeholder="Tank name (e.g. Diesel T1)"
                value={tankName}
                onChange={(e) => setTankName(e.target.value)}
              />
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={itemId}
                onChange={(e) => setItemId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Select fuel item (catalog)</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.sku} — {i.name}
                  </option>
                ))}
              </select>
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={grade}
                onChange={(e) => setGrade(e.target.value as typeof grade)}
              >
                <option value="diesel">Diesel</option>
                <option value="octane">Octane (petrol)</option>
                <option value="other">Other</option>
              </select>
              <input
                className="rounded-md border px-3 py-2 text-sm"
                placeholder="Capacity (L)"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
              <button
                type="button"
                disabled={createTank.isPending || !tankName.trim() || itemId === ''}
                onClick={() => createTank.mutate()}
                className="erp-btn-primary rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Create tank
              </button>
            </div>
          </section>

          <section className="erp-panel">
            <h2 className="text-sm font-semibold text-foreground">Bulk receipt (purchase into tank)</h2>
            <div className="mt-3 grid gap-2">
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={recvTank}
                onChange={(e) => setRecvTank(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Tank</option>
                {tanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.fuel_grade}) — {formatQuantity(t.current_stock_liters)} L
                  </option>
                ))}
              </select>
              <input
                className="rounded-md border px-3 py-2 text-sm"
                placeholder="Qty (liters)"
                value={recvQty}
                onChange={(e) => setRecvQty(e.target.value)}
              />
              <input
                className="rounded-md border px-3 py-2 text-sm"
                placeholder="Unit cost"
                value={recvCost}
                onChange={(e) => setRecvCost(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-foreground/85">
                <input type="checkbox" checked={recvPostGl} onChange={(e) => setRecvPostGl(e.target.checked)} />
                Post GL accrual (Inventory / GRNI)
              </label>
              <button
                type="button"
                disabled={purchase.isPending || recvTank === ''}
                onClick={() => purchase.mutate()}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Post receipt
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-emerald-100 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">Receive from purchase order (into tank)</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Uses the PO line price, updates qty received on the PO, and links the fuel transaction. For fuel SKUs only.
            </p>
            <div className="mt-3 grid gap-2">
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={poTank}
                onChange={(e) => {
                  setPoTank(e.target.value ? Number(e.target.value) : '')
                  setPoLineId('')
                }}
              >
                <option value="">Tank (pick item’s outstanding PO lines)</option>
                {tanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.fuel_item_name ?? `item #${t.fuel_item_id}`}
                  </option>
                ))}
              </select>
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={poLineId}
                onChange={(e) => setPoLineId(e.target.value ? Number(e.target.value) : '')}
                disabled={!poItemId || openPoLines.length === 0}
              >
                <option value="">{openPoLines.length ? 'PO line' : poItemId ? 'No open PO lines for this item' : 'Select tank first'}</option>
                {openPoLines.map((l) => (
                  <option key={l.po_line_id} value={l.po_line_id}>
                    {l.po_number} — out {formatQuantity(l.outstanding_liters)} L @ {l.unit_price}
                  </option>
                ))}
              </select>
              <input
                className="rounded-md border px-3 py-2 text-sm"
                placeholder="Qty to receive (L)"
                value={poQty}
                onChange={(e) => setPoQty(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-foreground/85">
                <input type="checkbox" checked={poPostGl} onChange={(e) => setPoPostGl(e.target.checked)} />
                Post GL accrual (Inventory / GRNI)
              </label>
              <button
                type="button"
                disabled={receiveFromPo.isPending || poTank === '' || poLineId === ''}
                onClick={() => receiveFromPo.mutate()}
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                Receive PO to tank
              </button>
            </div>
          </section>

          <section className="erp-panel lg:col-span-2">
            <h2 className="text-sm font-semibold text-foreground">Fleet refueling (internal issue)</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={issTank}
                onChange={(e) => setIssTank(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">From tank</option>
                {tanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.fuel_grade})
                  </option>
                ))}
              </select>
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={issVeh}
                onChange={(e) => setIssVeh(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Vehicle</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.reg_no}
                    {v.type ? ` (${vehicleTypeLabel(v.type)})` : ''}
                  </option>
                ))}
              </select>
              <input
                className="rounded-md border px-3 py-2 text-sm"
                placeholder="Liters"
                value={issQty}
                onChange={(e) => setIssQty(e.target.value)}
              />
              <input
                className="rounded-md border px-3 py-2 text-sm"
                placeholder="Odometer (optional)"
                value={issOdo}
                onChange={(e) => setIssOdo(e.target.value)}
              />
              <select
                className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
                value={issCostCenter}
                onChange={(e) => setIssCostCenter(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Cost center (optional)</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-foreground/85">
              <input type="checkbox" checked={issPostGl} onChange={(e) => setIssPostGl(e.target.checked)} />
              Post GL (Dr fleet fuel / Cr Inventory; cost center on expense line)
            </label>
            <button
              type="button"
              disabled={issue.isPending || issTank === '' || issVeh === ''}
              onClick={() => issue.mutate()}
              className="erp-btn-primary mt-3 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Record refueling
            </button>
          </section>
        </div>

        <section className="erp-panel">
          <h2 className="text-sm font-semibold text-foreground">Tanks</h2>
          {isLoading ? (
            <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="p-2">Name</th>
                    <th className="p-2">Grade</th>
                    <th className="p-2">Item</th>
                    <th className="p-2">Stock (L)</th>
                    <th className="p-2">WAC / L</th>
                    <th className="p-2">Capacity (L)</th>
                  </tr>
                </thead>
                <tbody>
                  {tanks.map((t) => (
                    <tr key={t.id} className="border-b border-border/70">
                      <td className="p-2 font-medium">{t.name}</td>
                      <td className="p-2 capitalize">{t.fuel_grade}</td>
                      <td className="p-2">{t.fuel_item_name ?? t.fuel_item_id}</td>
                      <td className="p-2">{formatQuantity(t.current_stock_liters)}</td>
                      <td className="p-2 text-foreground/85">
                        {t.moving_avg_unit_cost != null ? t.moving_avg_unit_cost.toFixed(2) : '—'}
                      </td>
                      <td className="p-2">{formatQuantity(t.capacity_liters)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="erp-panel">
          <h2 className="text-sm font-semibold text-foreground">Recent fuel transactions</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="p-2">Type</th>
                  <th className="p-2">Qty (L)</th>
                  <th className="p-2">When</th>
                </tr>
              </thead>
              <tbody>
                {txns.slice(0, 25).map((x) => (
                  <tr key={x.id} className="border-b border-border/70">
                    <td className="p-2">{x.txn_type}</td>
                    <td className="p-2">{formatQuantity(x.qty_liters)}</td>
                    <td className="p-2 text-muted-foreground">{String(x.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
  )
}
