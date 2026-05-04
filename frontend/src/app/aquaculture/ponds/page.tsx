'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Edit2, Trash2, RefreshCw, LayoutGrid, List, Store, BookOpen } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { formatNumber } from '@/utils/currency'

interface CustomerOpt {
  id: number
  display_name?: string | null
  company_name?: string | null
  customer_number?: string | null
  is_active?: boolean
}

function customerPickLabel(c: CustomerOpt): string {
  const co = (c.company_name || '').trim()
  if (co) return co
  const d = (c.display_name || '').trim()
  if (d) return d
  const n = (c.customer_number || '').trim()
  return n ? `Customer ${n}` : `Customer #${c.id}`
}

interface Pond {
  id: number
  name: string
  code: string
  sort_order: number
  is_active: boolean
  notes: string
  pond_role?: string
  pond_role_label?: string
  pos_customer_id?: number | null
  pos_customer_display?: string | null
  pos_customer_auto_managed?: boolean
  pond_size_decimal: string | null
  lease_contract_start: string | null
  lease_contract_end: string | null
  lease_price_per_decimal_per_year: string | null
  lease_paid_to_landlord: string
  lease_annual_amount: string | null
  lease_contract_years: string | null
  lease_contract_total: string | null
  lease_remaining_years: number | null
  lease_remaining_months: number | null
  lease_balance_due: string | null
  created_at?: string
}

function parseDecimalInput(s: string): number | null {
  const t = s.trim().replace(/,/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parseMoneyInput(s: string): number {
  const t = s.trim().replace(/,/g, '')
  if (!t) return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}

/** Parses P01 / p02 style pond codes for gap-fill ordering (only P + digits count). */
function pondCodeSerial(code: string): number | null {
  const m = /^[pP](\d+)$/.exec((code || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

/** Next code matching backend: smallest missing serial, padding aligned with existing P-codes. */
function suggestNextPondCode(existingCodes: string[]): string {
  const nums = new Set<number>()
  for (const c of existingCodes) {
    const n = pondCodeSerial(c)
    if (n !== null) nums.add(n)
  }
  let m = 1
  while (nums.has(m)) m += 1
  let width = Math.max(2, String(m).length)
  if (nums.size > 0) {
    width = Math.max(width, ...[...nums].map((x) => String(x).length))
  }
  return `P${String(m).padStart(width, '0')}`
}

function parseLocalDate(iso: string | null): Date | null {
  if (!iso) return null
  const d = iso.split('T')[0]
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return null
  return new Date(y, m - 1, day)
}

function contractYearFraction(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime()
  const days = ms / 86400000
  if (days <= 0) return 0
  return days / 365.25
}

function remainingYearsMonths(periodStart: Date, periodEnd: Date): { years: number; months: number } {
  if (periodStart > periodEnd) return { years: 0, months: 0 }
  let y = periodEnd.getFullYear() - periodStart.getFullYear()
  let m = periodEnd.getMonth() - periodStart.getMonth()
  const dEnd = periodEnd.getDate()
  const dStart = periodStart.getDate()
  if (dEnd < dStart) m -= 1
  if (m < 0) {
    y -= 1
    m += 12
  }
  return { years: Math.max(0, y), months: Math.max(0, m) }
}

function fmtMoney(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return formatNumber(n, digits)
}

function computeLeasePreview(form: {
  pond_size_decimal: string
  lease_price_per_decimal_per_year: string
  lease_contract_start: string
  lease_contract_end: string
  lease_paid_to_landlord: string
}) {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const size = parseDecimalInput(form.pond_size_decimal)
  const price = parseDecimalInput(form.lease_price_per_decimal_per_year)
  const paid = parseMoneyInput(form.lease_paid_to_landlord)
  const start = parseLocalDate(form.lease_contract_start || null)
  const end = parseLocalDate(form.lease_contract_end || null)

  const annual = size !== null && price !== null ? size * price : null
  let contractYearsRounded: number | null = null
  let total: number | null = null
  if (start && end && end >= start) {
    contractYearsRounded = Math.round(contractYearFraction(start, end))
    if (annual !== null) total = annual * contractYearsRounded
  }
  let remY: number | null = null
  let remM: number | null = null
  if (end) {
    const ref = start && today < start ? start : today
    const r = remainingYearsMonths(ref, end)
    remY = r.years
    remM = r.months
  }
  const balance = total !== null ? total - paid : null
  return { annual, contractYearsRounded, total, remY, remM, balance }
}

const POND_ROLE_OPTIONS: { id: string; label: string }[] = [
  { id: 'grow_out', label: 'Grow-out' },
  { id: 'nursing', label: 'Nursing / nursery' },
  { id: 'broodstock', label: 'Broodstock' },
  { id: 'other', label: 'Other' },
]

const emptyForm = () => ({
  name: '',
  code: '',
  sort_order: '0',
  is_active: true,
  notes: '',
  pond_role: 'grow_out',
  pos_customer_id: '',
  pond_size_decimal: '',
  lease_contract_start: '',
  lease_contract_end: '',
  lease_price_per_decimal_per_year: '',
  lease_paid_to_landlord: '0',
})

type ViewMode = 'list' | 'cards'

export default function AquaculturePondsPage() {
  const toast = useToast()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Pond | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [customers, setCustomers] = useState<CustomerOpt[]>([])
  const [customersLoading, setCustomersLoading] = useState(false)
  const [skipAutoPosCustomer, setSkipAutoPosCustomer] = useState(false)

  const preview = useMemo(() => computeLeasePreview(form), [form])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<Pond[]>('/aquaculture/ponds/')
      setPonds(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!modal || customers.length > 0 || customersLoading) return
    void (async () => {
      setCustomersLoading(true)
      try {
        const { data } = await api.get<CustomerOpt[]>('/customers/', { params: { limit: 500 } })
        setCustomers(Array.isArray(data) ? data : [])
      } catch {
        setCustomers([])
      } finally {
        setCustomersLoading(false)
      }
    })()
  }, [modal, customers.length, customersLoading])

  const openNew = () => {
    setEditing(null)
    setSkipAutoPosCustomer(false)
    const nextCode = suggestNextPondCode(ponds.map((x) => x.code || ''))
    setForm({ ...emptyForm(), code: nextCode })
    setModal(true)
  }

  const openEdit = (p: Pond) => {
    setEditing(p)
    setForm({
      name: p.name,
      code: p.code || '',
      sort_order: String(p.sort_order ?? 0),
      is_active: p.is_active,
      notes: p.notes || '',
      pond_role: p.pond_role || 'grow_out',
      pos_customer_id: p.pos_customer_id != null ? String(p.pos_customer_id) : '',
      pond_size_decimal: p.pond_size_decimal ?? '',
      lease_contract_start: p.lease_contract_start ? p.lease_contract_start.split('T')[0] : '',
      lease_contract_end: p.lease_contract_end ? p.lease_contract_end.split('T')[0] : '',
      lease_price_per_decimal_per_year: p.lease_price_per_decimal_per_year ?? '',
      lease_paid_to_landlord: p.lease_paid_to_landlord ?? '0',
    })
    setModal(true)
  }

  const save = async () => {
    const name = form.name.trim()
    if (!name) {
      toast.error('Name is required')
      return
    }
    try {
      const payload: Record<string, unknown> = {
        name,
        sort_order: parseInt(form.sort_order, 10) || 0,
        is_active: form.is_active,
        notes: form.notes.trim(),
        pond_role: form.pond_role,
        pond_size_decimal: form.pond_size_decimal.trim() || null,
        lease_contract_start: form.lease_contract_start.trim() || null,
        lease_contract_end: form.lease_contract_end.trim() || null,
        lease_price_per_decimal_per_year: form.lease_price_per_decimal_per_year.trim() || null,
        lease_paid_to_landlord: parseMoneyInput(form.lease_paid_to_landlord),
      }
      if (form.pos_customer_id.trim()) {
        const cid = parseInt(form.pos_customer_id, 10)
        if (!Number.isFinite(cid)) {
          toast.error('Invalid POS customer')
          return
        }
        payload.pos_customer_id = cid
      } else {
        payload.pos_customer_id = null
      }
      if (!editing && skipAutoPosCustomer) {
        payload.skip_auto_pos_customer = true
      }
      if (editing) {
        payload.code = form.code.trim()
        await api.put(`/aquaculture/ponds/${editing.id}/`, payload)
        toast.success('Pond updated')
      } else {
        const { data } = await api.post<Pond>('/aquaculture/ponds/', payload)
        const c = data?.code?.trim()
        toast.success(c ? `Pond created (${c})` : 'Pond created')
      }
      setModal(false)
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    }
  }

  const remove = async (p: Pond) => {
    if (!window.confirm(`Delete pond “${p.name}”? This cannot be undone if no dependencies block it.`)) return
    try {
      await api.delete(`/aquaculture/ponds/${p.id}/`)
      toast.success('Deleted')
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  const leaseSummaryLine = (p: Pond) => {
    const parts: string[] = []
    if (p.pond_size_decimal) parts.push(`${p.pond_size_decimal} dec`)
    if (p.lease_contract_total) parts.push(`contract ${fmtMoney(Number(p.lease_contract_total))}`)
    if (p.lease_balance_due !== null && p.lease_balance_due !== undefined) {
      const bal = Number(p.lease_balance_due)
      parts.push(bal >= 0 ? `balance ${fmtMoney(bal)} due` : `balance ${fmtMoney(bal)} (advance)`)
    }
    if (p.lease_remaining_years !== null && p.lease_remaining_months !== null) {
      parts.push(`left ${p.lease_remaining_years}y ${p.lease_remaining_months}m`)
    }
    return parts.length ? parts.join(' · ') : null
  }

  const balanceTone = (balanceStr: string | null | undefined) => {
    if (balanceStr === null || balanceStr === undefined) return 'text-slate-600'
    const bal = Number(balanceStr)
    if (Number.isNaN(bal)) return 'text-slate-600'
    if (bal > 0) return 'text-amber-800'
    if (bal < 0) return 'text-emerald-800'
    return 'text-slate-700'
  }

  const PondActions = ({ p }: { p: Pond }) => (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        onClick={() => openEdit(p)}
        className="rounded p-2 text-slate-600 hover:bg-slate-100"
        aria-label={`Edit ${p.name}`}
      >
        <Edit2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => void remove(p)}
        className="rounded p-2 text-red-600 hover:bg-red-50"
        aria-label={`Delete ${p.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="aq-ponds-title" className="text-xl font-bold tracking-tight text-slate-900">
            Ponds
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            Master profit centers for expenses, sales, sampling, P&amp;L, and payroll allocation.{' '}
            <span className="font-medium text-slate-800">Recommended:</span> new ponds get a General POS customer
            automatically (Cashier list) with a clear &quot;Aquaculture — …&quot; name; sell inventoried feed, medicine,
            and supplies on account from Cashier so quantities and chart-of-accounts follow your retail rules. Record
            cash costs, leases, power, labour, and other non-POS spend under Aquaculture operating expenses. Lease terms
            below track rent owed or prepaid. An optional internal stock issue on the expenses page is only for
            deliberate at-cost moves without POS.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
            role="group"
            aria-label="Display layout"
          >
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-2 text-sm ${
                viewMode === 'list' ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="h-4 w-4" aria-hidden />
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              aria-pressed={viewMode === 'cards'}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-2 text-sm ${
                viewMode === 'cards'
                  ? 'bg-white font-medium text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden />
              Cards
            </button>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" />
            Add pond
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : ponds.length === 0 ? (
        <div
          className="mt-6 rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm"
          aria-labelledby="aq-ponds-title"
        >
          No ponds defined. Create your first production unit to unlock transactions and reporting.
        </div>
      ) : viewMode === 'list' ? (
        <div
          className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"
          aria-labelledby="aq-ponds-title"
        >
          <table className="min-w-[720px] w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Pond</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">POS customer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Lease period</th>
                <th className="px-4 py-3 text-right">Annual</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Remaining</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ponds.map((p) => {
                const leaseLine = leaseSummaryLine(p)
                const bal = p.lease_balance_due !== null && p.lease_balance_due !== undefined ? Number(p.lease_balance_due) : null
                return (
                  <tr key={p.id} className="align-top text-slate-800">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{p.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {p.code ? `Code ${p.code} · ` : ''}Order {p.sort_order}
                      </p>
                      {p.notes?.trim() ? (
                        <p className="mt-1 line-clamp-2 max-w-xs text-xs text-slate-500">{p.notes.trim()}</p>
                      ) : null}
                      {leaseLine ? (
                        <p className="mt-1 text-xs text-slate-600 md:hidden">{leaseLine}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-800">
                        {p.pond_role_label || (p.pond_role === 'nursing' ? 'Nursing' : 'Grow-out')}
                      </span>
                    </td>
                    <td className="max-w-[12rem] px-4 py-3 text-xs text-slate-600">
                      {p.pos_customer_id ? (
                        <div className="space-y-1.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="line-clamp-2 font-medium text-teal-900"
                              title={p.pos_customer_display?.trim() || `Customer #${p.pos_customer_id}`}
                            >
                              {p.pos_customer_display?.trim() || `Customer #${p.pos_customer_id}`}
                            </span>
                            {p.pos_customer_auto_managed ? (
                              <span className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-900">
                                Auto
                              </span>
                            ) : null}
                          </span>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <Link
                              href={`/cashier?customer=${p.pos_customer_id}`}
                              className="inline-flex items-center gap-0.5 font-medium text-teal-800 underline decoration-teal-800/40 underline-offset-2 hover:decoration-teal-800"
                              title="Cashier (POS) with this customer pre-selected for on-account sales"
                            >
                              <Store className="h-3 w-3 shrink-0" aria-hidden />
                              POS
                            </Link>
                            <span className="text-slate-300" aria-hidden>
                              ·
                            </span>
                            <Link
                              href={`/customers/${p.pos_customer_id}/ledger`}
                              className="inline-flex items-center gap-0.5 font-medium text-slate-700 underline decoration-slate-400 underline-offset-2 hover:text-slate-900"
                              title="Accounts receivable activity for this customer"
                            >
                              <BookOpen className="h-3 w-3 shrink-0" aria-hidden />
                              Ledger
                            </Link>
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{p.pond_size_decimal ? `${p.pond_size_decimal} dec` : '—'}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {p.lease_contract_start || p.lease_contract_end ? (
                        <span className="whitespace-nowrap">
                          {formatDateOnly(p.lease_contract_start)} → {formatDateOnly(p.lease_contract_end)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {fmtMoney(p.lease_annual_amount ? Number(p.lease_annual_amount) : null)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {fmtMoney(Number(p.lease_paid_to_landlord))}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums font-medium ${balanceTone(p.lease_balance_due)}`}>
                      {bal === null || Number.isNaN(bal)
                        ? '—'
                        : bal > 0
                          ? `${fmtMoney(bal)} due`
                          : bal < 0
                            ? `${fmtMoney(bal)} adv.`
                            : fmtMoney(0)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {p.lease_remaining_years !== null && p.lease_remaining_months !== null
                        ? `${p.lease_remaining_years}y ${p.lease_remaining_months}m`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <PondActions p={p} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul
          className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-labelledby="aq-ponds-title"
        >
          {ponds.map((p) => {
            const bal =
              p.lease_balance_due !== null && p.lease_balance_due !== undefined ? Number(p.lease_balance_due) : null
            return (
              <li
                key={p.id}
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{p.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {p.code ? `Code ${p.code} · ` : ''}Sort {p.sort_order}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-slate-600">
                      {(p.pond_role_label || '').trim() ||
                        (p.pond_role === 'nursing' ? 'Nursing / nursery' : p.pond_role === 'broodstock' ? 'Broodstock' : 'Grow-out')}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {p.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div className="col-span-2 sm:col-span-1">
                    <dt className="text-slate-500">Pond size</dt>
                    <dd className="font-medium text-slate-800">{p.pond_size_decimal ? `${p.pond_size_decimal} dec` : '—'}</dd>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <dt className="text-slate-500">Price / dec / yr</dt>
                    <dd className="font-medium tabular-nums text-slate-800">
                      {p.lease_price_per_decimal_per_year
                        ? fmtMoney(Number(p.lease_price_per_decimal_per_year))
                        : '—'}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">General POS customer</dt>
                    <dd className="font-medium text-slate-800">
                      {p.pos_customer_id ? (
                        <span className="block space-y-1">
                          <span className="flex flex-wrap items-center gap-2 text-teal-900">
                            <span>{p.pos_customer_display?.trim() || `Customer #${p.pos_customer_id}`}</span>
                            {p.pos_customer_auto_managed ? (
                              <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-teal-900">
                                Auto
                              </span>
                            ) : null}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-2 text-xs font-normal text-slate-600">
                            <Link
                              href={`/cashier?customer=${p.pos_customer_id}`}
                              className="inline-flex items-center gap-0.5 text-teal-800 underline"
                            >
                              <Store className="h-3 w-3" aria-hidden />
                              Open POS
                            </Link>
                            <span className="text-slate-300">·</span>
                            <Link
                              href={`/customers/${p.pos_customer_id}/ledger`}
                              className="inline-flex items-center gap-0.5 underline"
                            >
                              <BookOpen className="h-3 w-3" aria-hidden />
                              A/R ledger
                            </Link>
                          </span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Lease period</dt>
                    <dd className="font-medium text-slate-800">
                      {p.lease_contract_start || p.lease_contract_end
                        ? `${formatDateOnly(p.lease_contract_start)} → ${formatDateOnly(p.lease_contract_end)}`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Annual lease</dt>
                    <dd className="font-medium tabular-nums text-slate-800">
                      {fmtMoney(p.lease_annual_amount ? Number(p.lease_annual_amount) : null)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Contract total</dt>
                    <dd className="font-medium tabular-nums text-slate-800">
                      {fmtMoney(p.lease_contract_total ? Number(p.lease_contract_total) : null)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Paid to landlord</dt>
                    <dd className="font-medium tabular-nums text-slate-800">{fmtMoney(Number(p.lease_paid_to_landlord))}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Remaining</dt>
                    <dd className="font-medium text-slate-800">
                      {p.lease_remaining_years !== null && p.lease_remaining_months !== null
                        ? `${p.lease_remaining_years}y ${p.lease_remaining_months}m`
                        : '—'}
                    </dd>
                  </div>
                  <div className="col-span-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                    <dt className="text-slate-500">Balance</dt>
                    <dd className={`text-sm font-semibold tabular-nums ${balanceTone(p.lease_balance_due)}`}>
                      {bal === null || Number.isNaN(bal)
                        ? '—'
                        : bal > 0
                          ? `${fmtMoney(bal)} due`
                          : bal < 0
                            ? `${fmtMoney(bal)} prepaid`
                            : 'Settled'}
                    </dd>
                  </div>
                </dl>

                {p.notes?.trim() ? (
                  <p className="mt-2 line-clamp-2 border-t border-slate-100 pt-2 text-xs text-slate-600">{p.notes.trim()}</p>
                ) : null}

                <div className="mt-auto flex justify-end border-t border-slate-100 pt-3">
                  <PondActions p={p} />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{editing ? 'Edit pond' : 'New pond'}</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                Name
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                General POS customer (on-account sales)
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={form.pos_customer_id}
                  onChange={(e) => setForm((f) => ({ ...f, pos_customer_id: e.target.value }))}
                  disabled={customersLoading && customers.length === 0}
                >
                  <option value="">— None (internal shop issue only) —</option>
                  {customers.map((c) => {
                    const inactive = c.is_active === false
                    const locked = editing && String(c.id) === form.pos_customer_id.trim()
                    return (
                      <option key={c.id} value={c.id} disabled={inactive && !locked}>
                        {customerPickLabel(c)}
                        {inactive ? ' (inactive)' : ''}
                      </option>
                    )
                  })}
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  New ponds: a POS customer is created automatically (name &quot;Aquaculture — [pond name]&quot;) so
                  they appear in Cashier. You can pick a different customer instead; that turns off automatic sync.
                  Renaming the pond or toggling inactive updates an auto-managed customer. Leave the list on
                  &quot;None&quot; only if you pass{' '}
                  <code className="rounded bg-slate-100 px-1 text-[11px]">skip_auto_pos_customer</code> on create via
                  API, or to clear an existing link.
                </span>
                {editing?.pos_customer_auto_managed ? (
                  <p className="mt-2 text-xs text-teal-900">
                    This customer is auto-managed: display name and active flag follow this pond until you choose
                    another customer.
                  </p>
                ) : null}
                {!editing ? (
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-slate-300"
                      checked={skipAutoPosCustomer}
                      onChange={(e) => {
                        const v = e.target.checked
                        setSkipAutoPosCustomer(v)
                        if (v) setForm((f) => ({ ...f, pos_customer_id: '' }))
                      }}
                    />
                    <span>
                      Do not create a POS customer for this pond (advanced; pond will not appear in Cashier until you
                      link one manually).
                    </span>
                  </label>
                ) : null}
                {form.pos_customer_id.trim() ? (
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                    <Link
                      href={`/cashier?customer=${encodeURIComponent(form.pos_customer_id.trim())}`}
                      className="inline-flex items-center gap-1 font-medium text-teal-800 underline"
                    >
                      <Store className="h-3.5 w-3.5" aria-hidden />
                      Open cashier for this customer
                    </Link>
                    <span className="text-slate-300">·</span>
                    <Link
                      href={`/customers/${encodeURIComponent(form.pos_customer_id.trim())}/ledger`}
                      className="inline-flex items-center gap-1 font-medium text-slate-700 underline"
                    >
                      <BookOpen className="h-3.5 w-3.5" aria-hidden />
                      A/R ledger
                    </Link>
                  </p>
                ) : null}
              </label>
              {editing ? (
                <label className="block text-sm font-medium text-slate-700">
                  Code
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    placeholder="e.g. P01"
                  />
                </label>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-sm font-medium text-slate-700">Pond code (assigned automatically)</p>
                  <p className="mt-1 font-mono text-base font-semibold text-slate-900">{form.code}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Uses the lowest free P-number (P01, P02, …). If a pond is deleted, its code is freed; the next
                    new pond reuses the smallest gap (e.g. only P02 on file → new pond gets P01).
                  </p>
                </div>
              )}
              <label className="block text-sm font-medium text-slate-700">
                Sort order
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                />
                Active
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Pond role
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={form.pond_role}
                  onChange={(e) => setForm((f) => ({ ...f, pond_role: e.target.value }))}
                >
                  {POND_ROLE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Used for filters and nursing → grow-out transfers (management only; does not post GL by itself).
                </span>
              </label>

              <div className="border-t border-slate-200 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lease / pond area</p>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Pond size (decimal)
                <input
                  inputMode="decimal"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="e.g. 2.5"
                  value={form.pond_size_decimal}
                  onChange={(e) => setForm((f) => ({ ...f, pond_size_decimal: e.target.value }))}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Contract start
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={form.lease_contract_start}
                    onChange={(e) => setForm((f) => ({ ...f, lease_contract_start: e.target.value }))}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Contract end
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={form.lease_contract_end}
                    onChange={(e) => setForm((f) => ({ ...f, lease_contract_end: e.target.value }))}
                  />
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Lease price per decimal per year
                <input
                  inputMode="decimal"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="Currency amount"
                  value={form.lease_price_per_decimal_per_year}
                  onChange={(e) => setForm((f) => ({ ...f, lease_price_per_decimal_per_year: e.target.value }))}
                />
              </label>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                <p className="font-medium text-slate-700">Calculated (from entries above)</p>
                <ul className="mt-2 space-y-1 text-slate-600">
                  <li>
                    Annual lease (size × price):{' '}
                    <span className="font-medium text-slate-900">{fmtMoney(preview.annual)}</span>
                  </li>
                  <li>
                    Contract length (years, rounded):{' '}
                    <span className="font-medium text-slate-900">
                      {preview.contractYearsRounded !== null ? `${preview.contractYearsRounded} yr` : '—'}
                    </span>
                  </li>
                  <li>
                    Total for contract term:{' '}
                    <span className="font-medium text-slate-900">{fmtMoney(preview.total)}</span>
                  </li>
                  <li>
                    Remaining on lease:{' '}
                    <span className="font-medium text-slate-900">
                      {preview.remY !== null && preview.remM !== null
                        ? `${preview.remY} yr, ${preview.remM} mo (from today or contract start)`
                        : '—'}
                    </span>
                  </li>
                </ul>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Paid to landlord (cumulative)
                <input
                  inputMode="decimal"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="0"
                  value={form.lease_paid_to_landlord}
                  onChange={(e) => setForm((f) => ({ ...f, lease_paid_to_landlord: e.target.value }))}
                />
              </label>
              <div
                className={`rounded-lg border p-3 text-sm ${
                  preview.balance === null
                    ? 'border-slate-200 bg-slate-50 text-slate-600'
                    : preview.balance > 0
                      ? 'border-amber-200 bg-amber-50 text-amber-950'
                      : preview.balance < 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                        : 'border-slate-200 bg-slate-50 text-slate-800'
                }`}
              >
                <p className="font-medium">Balance after landlord payments</p>
                <p className="mt-1 text-base font-semibold">
                  {preview.balance === null
                    ? 'Enter contract dates, size, and price to compute.'
                    : preview.balance > 0
                      ? `${fmtMoney(preview.balance)} still to pay`
                      : preview.balance < 0
                        ? `${fmtMoney(preview.balance)} (prepaid / advance to landlord)`
                        : 'Settled for computed contract total'}
                </p>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Notes
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(false)}
                className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
