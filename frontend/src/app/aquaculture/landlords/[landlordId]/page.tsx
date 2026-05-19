'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Landmark, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { formatBankRegisterLabel, normalizeBankAccountsFromApi } from '@/lib/bankAccountDisplay'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'

interface PondOpt {
  id: number
  name: string
  lease_price_per_decimal_per_year?: string | null
}

interface ShareRow {
  id?: number
  pond_id: number
  pond_name: string
  land_area_decimal: string
  notes: string
  lease_price_per_decimal_per_year?: string | null
  implied_annual_lease?: string | null
}

interface LedgerRow {
  id: number
  entry_date: string
  kind: string
  amount_signed: string
  running_balance: string
  memo: string
  reference: string
  pond_id: number | null
  pond_name: string
  applies_to_lease_paid: boolean
  lease_paid_delta?: string | null
  charge_display?: string | null
  payment_display?: string | null
  bank_account_id?: number | null
  station_id?: number | null
  payment_method?: string
  journal_entry_id?: number | null
  journal_entry_number?: string
}

type BankOpt = {
  id: number
  account_name?: string
  bank_name?: string
  chart_account_code?: string | null
}

interface StationOpt {
  id: number
  station_name: string
}

interface LandlordDetail {
  id: number
  name: string
  code: string
  phone: string
  email: string
  notes: string
  is_active: boolean
  balance_signed: string
  balance_status: string
  pond_shares: ShareRow[]
  ledger: LedgerRow[]
}

function statusLabel(s: string): string {
  if (s === 'payable') return 'We owe'
  if (s === 'credit') return 'Credit / prepaid'
  return 'Clear'
}

function kindLabel(k: string): string {
  if (k === 'rent_charge') return 'Rent charge'
  if (k === 'payment') return 'Payment'
  if (k === 'adjustment') return 'Adjustment'
  return k
}

function impliedAnnualFromPondRow(landDec: string, pond: PondOpt | undefined): string | null {
  const a = Number(String(landDec).replace(/,/g, ''))
  const raw = pond?.lease_price_per_decimal_per_year
  const p = raw != null && raw !== '' ? Number(String(raw).replace(/,/g, '')) : NaN
  if (!Number.isFinite(a) || !Number.isFinite(p) || a <= 0 || p < 0) return null
  return (a * p).toFixed(2)
}

export default function LandlordDetailPage() {
  const params = useParams()
  const landlordId = String(params.landlordId || '')
  const toast = useToast()
  const [currency, setCurrency] = useState('BDT')
  const [detail, setDetail] = useState<LandlordDetail | null>(null)
  const [ponds, setPonds] = useState<PondOpt[]>([])
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [shareDrafts, setShareDrafts] = useState<{ pond_id: string; land_area_decimal: string; notes: string }[]>([])

  const [legKind, setLegKind] = useState<'rent_charge' | 'payment' | 'adjustment'>('payment')
  const [legAmount, setLegAmount] = useState('')
  const [legDate, setLegDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [legPond, setLegPond] = useState('')
  const [legApplyPaid, setLegApplyPaid] = useState(true)
  const [legMemo, setLegMemo] = useState('')
  const [legRef, setLegRef] = useState('')
  const [splitPayment, setSplitPayment] = useState(false)
  const [allocRows, setAllocRows] = useState<
    { pond_id: string; amount: string; applies_to_lease_paid: boolean }[]
  >([{ pond_id: '', amount: '', applies_to_lease_paid: true }])
  const [banks, setBanks] = useState<BankOpt[]>([])
  const [stations, setStations] = useState<StationOpt[]>([])
  const [legBankId, setLegBankId] = useState('')
  const [legStationId, setLegStationId] = useState('')

  const [ledgerEdit, setLedgerEdit] = useState<LedgerRow | null>(null)
  const [editKind, setEditKind] = useState<'rent_charge' | 'payment' | 'adjustment'>('payment')
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editPond, setEditPond] = useState('')
  const [editApplyPaid, setEditApplyPaid] = useState(true)
  const [editMemo, setEditMemo] = useState('')
  const [editRef, setEditRef] = useState('')
  const [editBankId, setEditBankId] = useState('')
  const [editStationId, setEditStationId] = useState('')

  const sym = useMemo(() => getCurrencySymbol(currency), [currency])

  const glBodyForPayment = (): Record<string, unknown> => {
    if (!legBankId) return {}
    const o: Record<string, unknown> = { bank_account_id: parseInt(legBankId, 10) }
    if (legStationId) o.station_id = parseInt(legStationId, 10)
    return o
  }

  const loadPonds = useCallback(async () => {
    try {
      const { data } = await api.get<PondOpt[]>('/aquaculture/ponds/')
      setPonds(Array.isArray(data) ? data : [])
    } catch {
      setPonds([])
    }
  }, [])

  const load = useCallback(async () => {
    if (!landlordId || landlordId === 'undefined') return
    setLoading(true)
    try {
      const [co, d] = await Promise.all([
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<LandlordDetail>(`/aquaculture/landlords/${landlordId}/`),
      ])
      setCurrency(String(co.data?.currency || 'BDT').slice(0, 3))
      const L = d.data
      setDetail(L)
      setName(L.name || '')
      setCode(L.code || '')
      setPhone(L.phone || '')
      setEmail(L.email || '')
      setNotes(L.notes || '')
      setIsActive(L.is_active !== false)
      setShareDrafts(
        (L.pond_shares || []).map((s) => ({
          pond_id: String(s.pond_id),
          land_area_decimal: String(s.land_area_decimal || ''),
          notes: s.notes || '',
        })),
      )
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load landlord'))
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [landlordId, toast])

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    ;(async () => {
      try {
        const [b, s] = await Promise.all([api.get<unknown>('/bank-accounts/'), api.get<unknown>('/stations/')])
        const br = b.data
        const sr = s.data
        setBanks(normalizeBankAccountsFromApi(br))
        setStations(Array.isArray(sr) ? (sr as StationOpt[]) : [])
      } catch {
        setBanks([])
        setStations([])
      }
    })()
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (legKind !== 'payment') setSplitPayment(false)
  }, [legKind])

  const saveProfile = async () => {
    const n = name.trim()
    if (!n) {
      toast.error('Name is required')
      return
    }
    const pond_shares = shareDrafts
      .filter((r) => r.pond_id && r.land_area_decimal.trim())
      .map((r) => ({
        pond_id: parseInt(r.pond_id, 10),
        land_area_decimal: r.land_area_decimal.trim(),
        notes: r.notes.trim(),
      }))
    try {
      await api.patch(`/aquaculture/landlords/${landlordId}/`, {
        name: n,
        code: code.trim(),
        phone: phone.trim(),
        email: email.trim(),
        notes: notes.trim(),
        is_active: isActive,
        pond_shares,
      })
      toast.success('Saved')
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not save'))
    }
  }

  const addLedger = async () => {
    const memo = legMemo.trim()
    const reference = legRef.trim()

    if (legKind === 'payment' && splitPayment) {
      const lines = allocRows
        .filter((r) => r.amount.trim())
        .map((r) => ({
          pond_id: r.pond_id ? parseInt(r.pond_id, 10) : null,
          amount: r.amount.trim().replace(/,/g, ''),
          applies_to_lease_paid: r.applies_to_lease_paid,
        }))
      if (lines.length === 0) {
        toast.error('Add at least one line with an amount')
        return
      }
      for (const ln of lines) {
        const n = Number(ln.amount)
        if (!Number.isFinite(n) || n <= 0) {
          toast.error('Each split line needs a positive amount')
          return
        }
        if (ln.applies_to_lease_paid && ln.pond_id == null) {
          toast.error('Lines that update pond “paid to landlord” must select a pond')
          return
        }
      }
      try {
        await api.post(`/aquaculture/landlords/${landlordId}/ledger/`, {
          kind: 'payment',
          entry_date: legDate,
          memo,
          reference,
          ...glBodyForPayment(),
          allocations: lines.map((ln) => ({
            pond_id: ln.pond_id,
            amount: ln.amount,
            applies_to_lease_paid: ln.applies_to_lease_paid,
          })),
        })
        toast.success(
          lines.length > 1 ? `${lines.length} payment lines posted` : 'Ledger entry added',
        )
        setLegMemo('')
        setLegRef('')
        setLegBankId('')
        setLegStationId('')
        setAllocRows([{ pond_id: '', amount: '', applies_to_lease_paid: true }])
        void load()
      } catch (e) {
        toast.error(extractErrorMessage(e, 'Could not add entry'))
      }
      return
    }

    const raw = legAmount.trim().replace(/,/g, '')
    const amt = Number(raw)
    if (!Number.isFinite(amt) || amt === 0) {
      toast.error('Enter a valid non-zero amount')
      return
    }
    const body: Record<string, unknown> = {
      kind: legKind,
      amount: legKind === 'adjustment' ? raw : String(Math.abs(amt)),
      entry_date: legDate,
      memo,
      reference,
    }
    if (legPond) {
      body.pond_id = parseInt(legPond, 10)
      body.applies_to_lease_paid = legKind === 'payment' ? legApplyPaid : false
    } else if (legKind === 'payment') {
      body.applies_to_lease_paid = false
    }
    try {
      await api.post(`/aquaculture/landlords/${landlordId}/ledger/`, {
        ...body,
        ...(legKind === 'payment' ? glBodyForPayment() : {}),
      })
      toast.success('Ledger entry added')
      setLegAmount('')
      setLegMemo('')
      setLegRef('')
      setLegBankId('')
      setLegStationId('')
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not add entry'))
    }
  }

  const openLedgerEdit = (row: LedgerRow) => {
    setLedgerEdit(row)
    setEditKind(row.kind as typeof editKind)
    setEditDate(row.entry_date.slice(0, 10))
    const n = Number(String(row.amount_signed).replace(/,/g, ''))
    if (row.kind === 'adjustment') {
      setEditAmount(String(n))
    } else {
      setEditAmount(String(Math.abs(n)))
    }
    setEditPond(row.pond_id != null ? String(row.pond_id) : '')
    setEditApplyPaid(row.applies_to_lease_paid)
    setEditMemo(row.memo || '')
    setEditRef(row.reference || '')
    setEditBankId(row.bank_account_id != null ? String(row.bank_account_id) : '')
    setEditStationId(row.station_id != null ? String(row.station_id) : '')
  }

  const saveLedgerEdit = async () => {
    if (!ledgerEdit) return
    const raw = editAmount.trim().replace(/,/g, '')
    const amt = Number(raw)
    if (!Number.isFinite(amt)) {
      toast.error('Enter a valid amount')
      return
    }
    if (editKind === 'adjustment') {
      if (amt === 0) {
        toast.error('Adjustment cannot be zero')
        return
      }
    } else if (amt <= 0) {
      toast.error('Amount must be greater than zero')
      return
    }
    const body: Record<string, unknown> = {
      kind: editKind,
      amount: editKind === 'adjustment' ? raw : String(Math.abs(amt)),
      entry_date: editDate,
      memo: editMemo.trim(),
      reference: editRef.trim(),
      pond_id: editPond ? parseInt(editPond, 10) : null,
      applies_to_lease_paid: editKind === 'payment' ? editApplyPaid : false,
    }
    if (editKind === 'payment') {
      body.bank_account_id = editBankId ? parseInt(editBankId, 10) : null
      body.station_id = editStationId ? parseInt(editStationId, 10) : null
    }
    try {
      await api.patch(`/aquaculture/landlords/${landlordId}/ledger/${ledgerEdit.id}/`, body)
      toast.success('Ledger entry updated')
      setLedgerEdit(null)
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not update entry'))
    }
  }

  const removeLedger = async (entryId: number) => {
    if (!globalThis.confirm('Delete this ledger row? Pond paid totals will be reversed if this was a lease payment.')) {
      return
    }
    try {
      await api.delete(`/aquaculture/landlords/${landlordId}/ledger/${entryId}/`)
      toast.success('Removed')
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not delete'))
    }
  }

  const removeLandlord = async () => {
    if (!globalThis.confirm('Delete this landlord and all ledger history?')) return
    try {
      await api.delete(`/aquaculture/landlords/${landlordId}/`)
      toast.success('Deleted')
      globalThis.location.href = '/aquaculture/landlords'
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not delete'))
    }
  }

  if (loading && !detail) {
    return (
      <div className="px-4 py-12 text-center text-slate-600">
        <RefreshCw className="mx-auto h-6 w-6 animate-spin text-teal-700" aria-hidden />
        <p className="mt-2 text-sm">Loading…</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-slate-600">Landlord not found.</p>
        <Link href="/aquaculture/landlords" className="mt-2 inline-block text-teal-800 underline">
          Back to list
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/aquaculture/landlords" className="inline-flex items-center gap-1 text-sm text-teal-800 underline">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            All landlords
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-900">
            <Landmark className="h-7 w-7 text-teal-700" aria-hidden />
            {detail.name}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Balance {sym}
            {formatNumber(Number(String(detail.balance_signed).replace(/,/g, '')), 2)} — {statusLabel(detail.balance_status)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void removeLandlord()}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100"
          >
            Delete landlord
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Profile & pond land</h2>
          <div className="mt-3 space-y-3 text-sm">
            <label className="block font-medium text-slate-700">
              Name
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block font-medium text-slate-700">
              Code
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. LL-0001"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Generated automatically when the landlord is created. You can override it here if your business uses
                another reference.
              </span>
            </label>
            <label className="block font-medium text-slate-700">
              Phone
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="block font-medium text-slate-700">
              Email
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 font-medium text-slate-700">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
            </label>
            <label className="block font-medium text-slate-700">
              Notes
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>

          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Land by pond (decimals)</h3>
          <p className="mt-1 text-xs text-slate-600">
            When the pond has a lease price per decimal per year, an estimated annual lease for this landlord&apos;s
            share is shown (land decimals × rate). Set the rate on each pond&apos;s profile if it is missing.
          </p>
          <div className="mt-2 space-y-2">
            {shareDrafts.map((row, idx) => {
              const pondSel = ponds.find((p) => String(p.id) === row.pond_id)
              const implied = impliedAnnualFromPondRow(row.land_area_decimal, pondSel)
              return (
              <div key={idx} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-2">
                <label className="min-w-[160px] flex-1 text-xs font-medium text-slate-700">
                  Pond
                  <select
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    value={row.pond_id}
                    onChange={(e) => {
                      const v = e.target.value
                      setShareDrafts((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, pond_id: v } : r)),
                      )
                    }}
                  >
                    <option value="">—</option>
                    {ponds.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-28 text-xs font-medium text-slate-700">
                  Land (dec)
                  <input
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
                    value={row.land_area_decimal}
                    onChange={(e) => {
                      const v = e.target.value
                      setShareDrafts((prev) => prev.map((r, i) => (i === idx ? { ...r, land_area_decimal: v } : r)))
                    }}
                  />
                </label>
                <div className="w-36 text-xs font-medium text-slate-700">
                  <span className="block">Est. annual lease</span>
                  <div className="mt-1 rounded border border-dashed border-slate-200 bg-white px-2 py-1.5 text-sm tabular-nums text-slate-800">
                    {implied != null ? (
                      <>
                        {sym}
                        {formatNumber(Number(implied), 2)}
                      </>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <label className="min-w-[120px] flex-1 text-xs font-medium text-slate-700">
                  Notes
                  <input
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    value={row.notes}
                    onChange={(e) => {
                      const v = e.target.value
                      setShareDrafts((prev) => prev.map((r, i) => (i === idx ? { ...r, notes: v } : r)))
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                  onClick={() => setShareDrafts((prev) => prev.filter((_, i) => i !== idx))}
                >
                  Remove
                </button>
              </div>
              )
            })}
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 underline"
              onClick={() => setShareDrafts((prev) => [...prev, { pond_id: '', land_area_decimal: '', notes: '' }])}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add pond share
            </button>
          </div>

          <button
            type="button"
            onClick={() => void saveProfile()}
            className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Save profile & pond shares
          </button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Add ledger entry</h2>
          <p className="mt-1 text-xs text-slate-600">
            Rent charges increase what you owe; payments reduce the balance. Optional: tie a payment to one or more
            ponds so each pond&apos;s &quot;paid to landlord&quot; total stays in sync (requires a land share on that
            pond first). To post the general ledger, choose a bank/cash register and optional site (e.g. Premium Agro):
            Dr 6711 lease expense for that pond, Cr the register.
          </p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <label className="font-medium text-slate-700">
              Kind
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                value={legKind}
                onChange={(e) => setLegKind(e.target.value as typeof legKind)}
              >
                <option value="rent_charge">Rent charge</option>
                <option value="payment">Payment</option>
                <option value="adjustment">Adjustment (signed amount)</option>
              </select>
            </label>
            <label className="font-medium text-slate-700">
              Date
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                value={legDate}
                onChange={(e) => setLegDate(e.target.value)}
              />
            </label>
            {legKind === 'payment' ? (
              <label className="flex items-center gap-2 text-slate-700 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={splitPayment}
                  onChange={(e) => {
                    const on = e.target.checked
                    setSplitPayment(on)
                    if (on && legPond && allocRows.length === 1 && !allocRows[0].pond_id) {
                      setAllocRows([{ pond_id: legPond, amount: legAmount, applies_to_lease_paid: legApplyPaid }])
                    }
                  }}
                />
                Split across multiple ponds (one ledger line per amount; same date, memo, and reference)
              </label>
            ) : null}
            {legKind === 'payment' && splitPayment ? (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3 sm:col-span-2">
                <p className="text-xs font-medium text-slate-700">Amount per pond</p>
                {allocRows.map((ar, aidx) => (
                  <div key={aidx} className="flex flex-wrap items-end gap-2">
                    <label className="min-w-[140px] flex-1 text-xs font-medium text-slate-700">
                      Pond
                      <select
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        value={ar.pond_id}
                        onChange={(e) => {
                          const v = e.target.value
                          setAllocRows((prev) => prev.map((r, i) => (i === aidx ? { ...r, pond_id: v } : r)))
                        }}
                      >
                        <option value="">—</option>
                        {ponds.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="w-32 text-xs font-medium text-slate-700">
                      Amount
                      <input
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
                        value={ar.amount}
                        onChange={(e) => {
                          const v = e.target.value
                          setAllocRows((prev) => prev.map((r, i) => (i === aidx ? { ...r, amount: v } : r)))
                        }}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={ar.applies_to_lease_paid}
                        onChange={(e) => {
                          const v = e.target.checked
                          setAllocRows((prev) => prev.map((r, i) => (i === aidx ? { ...r, applies_to_lease_paid: v } : r)))
                        }}
                      />
                      Update pond paid
                    </label>
                    <button
                      type="button"
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                      onClick={() => setAllocRows((prev) => prev.filter((_, i) => i !== aidx))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-xs font-medium text-teal-800 underline"
                  onClick={() =>
                    setAllocRows((prev) => [...prev, { pond_id: '', amount: '', applies_to_lease_paid: true }])
                  }
                >
                  Add pond line
                </button>
              </div>
            ) : (
              <>
                <label className="font-medium text-slate-700 sm:col-span-2">
                  {legKind === 'adjustment' ? 'Signed amount (+ owe more, − credit)' : 'Amount (positive)'}
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 tabular-nums"
                    value={legAmount}
                    onChange={(e) => setLegAmount(e.target.value)}
                    placeholder={legKind === 'adjustment' ? 'e.g. -500 or 200' : 'e.g. 5000'}
                  />
                </label>
                <label className="font-medium text-slate-700 sm:col-span-2">
                  Pond (optional)
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                    value={legPond}
                    onChange={(e) => setLegPond(e.target.value)}
                  >
                    <option value="">— none —</option>
                    {ponds.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {legKind === 'payment' && legPond ? (
                  <label className="flex items-center gap-2 text-slate-700 sm:col-span-2">
                    <input type="checkbox" checked={legApplyPaid} onChange={(e) => setLegApplyPaid(e.target.checked)} />
                    Increase this pond&apos;s &quot;paid to landlord&quot; by this amount
                  </label>
                ) : null}
              </>
            )}
            <label className="font-medium text-slate-700 sm:col-span-2">
              Memo
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                value={legMemo}
                onChange={(e) => setLegMemo(e.target.value)}
              />
            </label>
            <label className="font-medium text-slate-700 sm:col-span-2">
              Reference
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                value={legRef}
                onChange={(e) => setLegRef(e.target.value)}
              />
            </label>
            {legKind === 'payment' ? (
              <>
                <label className="font-medium text-slate-700 sm:col-span-2">
                  Bank / cash register (for G/L — optional)
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                    value={legBankId}
                    onChange={(e) => setLegBankId(e.target.value)}
                  >
                    <option value="">— subledger only, no journal —</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {formatBankRegisterLabel(b)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="font-medium text-slate-700 sm:col-span-2">
                  Site (optional, for journal)
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                    value={legStationId}
                    onChange={(e) => setLegStationId(e.target.value)}
                  >
                    <option value="">— company-wide —</option>
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.station_name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void addLedger()}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Post entry
          </button>
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-teal-100 bg-teal-50/40 p-4 text-sm text-slate-700">
        <h3 className="font-semibold text-slate-900">How the balance and payments work</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Running balance</strong> is obligation to this landlord after each row: positive means you still owe
            them; negative means overpaid or prepaid (credit).
          </li>
          <li>
            Recording a <strong>payment</strong> in this ledger is the accounting record. When you also check{' '}
            <em>Update pond paid</em>, the system increases that pond&apos;s cumulative &quot;paid to landlord&quot;
            field by the same amount so pond-level lease tracking matches cash.
          </li>
          <li>
            Use <strong>split across multiple ponds</strong> when one transfer covers several ponds — you get one
            ledger line per pond so each can update its own paid total.
          </li>
          <li>
            With a <strong>bank register</strong> selected, each payment line also creates journal entry{' '}
            <code className="rounded bg-slate-100 px-1">AUTO-LL-PAY-…</code> (Dr 6711 pond lease, Cr register) tagged to
            the pond for reports and cost per kg.
          </li>
        </ul>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">Ledger</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-4 py-2 font-medium">Charge</th>
                <th className="px-4 py-2 font-medium">Payment</th>
                <th className="px-4 py-2 font-medium">Net</th>
                <th className="px-4 py-2 font-medium">Balance</th>
                <th className="px-4 py-2 font-medium">Pond</th>
                <th className="px-4 py-2 font-medium">Pond paid +</th>
                <th className="px-4 py-2 font-medium">G/L</th>
                <th className="px-4 py-2 font-medium">Memo / ref.</th>
                <th className="px-4 py-2 w-20 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {(detail.ledger || []).length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-center text-slate-500">
                    No entries yet.
                  </td>
                </tr>
              ) : (
                detail.ledger.map((e) => {
                  const ch =
                    e.charge_display != null && e.charge_display !== ''
                      ? Number(String(e.charge_display).replace(/,/g, ''))
                      : null
                  const pay =
                    e.payment_display != null && e.payment_display !== ''
                      ? Number(String(e.payment_display).replace(/,/g, ''))
                      : null
                  const leaseD =
                    e.lease_paid_delta != null && e.lease_paid_delta !== ''
                      ? Number(String(e.lease_paid_delta).replace(/,/g, ''))
                      : null
                  return (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 whitespace-nowrap">{formatDateOnly(e.entry_date)}</td>
                      <td className="px-4 py-2">{kindLabel(e.kind)}</td>
                      <td className="px-4 py-2 tabular-nums text-slate-800">
                        {ch != null && Number.isFinite(ch) ? (
                          <>
                            {sym}
                            {formatNumber(ch, 2)}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-slate-800">
                        {pay != null && Number.isFinite(pay) ? (
                          <>
                            {sym}
                            {formatNumber(pay, 2)}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-slate-600">
                        {sym}
                        {formatNumber(Number(String(e.amount_signed).replace(/,/g, '')), 2)}
                      </td>
                      <td className="px-4 py-2 tabular-nums font-medium text-slate-900">
                        {sym}
                        {formatNumber(Number(String(e.running_balance).replace(/,/g, '')), 2)}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{e.pond_name || '—'}</td>
                      <td className="px-4 py-2 tabular-nums text-slate-700">
                        {leaseD != null && Number.isFinite(leaseD) ? (
                          <>
                            {sym}
                            {formatNumber(leaseD, 2)}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-2 font-mono text-xs text-slate-700">
                        {e.journal_entry_number?.trim() ? e.journal_entry_number : '—'}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-2 text-slate-600">{e.memo || e.reference || '—'}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openLedgerEdit(e)}
                            className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeLedger(e.id)}
                            className="rounded p-1 text-red-700 hover:bg-red-50 hover:text-red-900"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {ledgerEdit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Edit ledger entry</h3>
            <p className="mt-1 text-xs text-slate-600">
              Changing amounts or pond allocation will reverse and re-apply any &quot;pond paid&quot; effect for this
              line.
            </p>
            <div className="mt-4 grid gap-3 text-sm">
              <label className="font-medium text-slate-700">
                Kind
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                  value={editKind}
                  onChange={(e) => setEditKind(e.target.value as typeof editKind)}
                >
                  <option value="rent_charge">Rent charge</option>
                  <option value="payment">Payment</option>
                  <option value="adjustment">Adjustment</option>
                </select>
              </label>
              <label className="font-medium text-slate-700">
                Date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                />
              </label>
              <label className="font-medium text-slate-700">
                {editKind === 'adjustment' ? 'Signed amount' : 'Amount (positive)'}
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 tabular-nums"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                />
              </label>
              <label className="font-medium text-slate-700">
                Pond
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                  value={editPond}
                  onChange={(e) => setEditPond(e.target.value)}
                >
                  <option value="">— none —</option>
                  {ponds.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {editKind === 'payment' && editPond ? (
                <label className="flex items-center gap-2 text-slate-700">
                  <input
                    type="checkbox"
                    checked={editApplyPaid}
                    onChange={(e) => setEditApplyPaid(e.target.checked)}
                  />
                  Increase pond &quot;paid to landlord&quot;
                </label>
              ) : editKind === 'payment' ? (
                <p className="text-xs text-slate-500">Select a pond above to optionally update its paid total.</p>
              ) : null}
              <label className="font-medium text-slate-700">
                Memo
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                  value={editMemo}
                  onChange={(e) => setEditMemo(e.target.value)}
                />
              </label>
              <label className="font-medium text-slate-700">
                Reference
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                  value={editRef}
                  onChange={(e) => setEditRef(e.target.value)}
                />
              </label>
              {editKind === 'payment' ? (
                <>
                  <label className="font-medium text-slate-700">
                    Bank / cash register (G/L)
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                      value={editBankId}
                      onChange={(e) => setEditBankId(e.target.value)}
                    >
                      <option value="">— none —</option>
                      {banks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {formatBankRegisterLabel(b)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="font-medium text-slate-700">
                    Site (optional)
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                      value={editStationId}
                      onChange={(e) => setEditStationId(e.target.value)}
                    >
                      <option value="">—</option>
                      {stations.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.station_name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLedgerEdit(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveLedgerEdit()}
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
