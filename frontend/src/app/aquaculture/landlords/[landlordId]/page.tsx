'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Landmark,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { formatBankRegisterLabel, normalizeBankAccountsFromApi } from '@/lib/bankAccountDisplay'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'
import { LandlordFormModal } from '../LandlordFormModal'
import { LandlordLedgerEntryModal } from '../LandlordLedgerEntryModal'
import {
  kindLabel,
  statusClass,
  statusLabel,
  type LandlordDetail,
  type PondOpt,
} from '../landlordShared'

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
  journal_entry_number?: string
}

type BankOpt = {
  id: number
  account_name?: string
  bank_name?: string
  chart_account_code?: string | null
}

type StationOpt = { id: number; station_name: string }

type LedgerEntryModalKind = 'payment' | 'rent_charge' | 'adjustment'

export default function LandlordDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const landlordId = String(params.landlordId || '')
  const toast = useToast()

  const [currency, setCurrency] = useState('BDT')
  const [detail, setDetail] = useState<LandlordDetail | null>(null)
  const [ponds, setPonds] = useState<PondOpt[]>([])
  const [loading, setLoading] = useState(true)

  const [editOpen, setEditOpen] = useState(false)
  const [ledgerModal, setLedgerModal] = useState<LedgerEntryModalKind | null>(null)

  const [banks, setBanks] = useState<BankOpt[]>([])
  const [stations, setStations] = useState<StationOpt[]>([])
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
  const landlordNumId = parseInt(landlordId, 10)

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
      setDetail(d.data)
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
    void load()
  }, [load])

  useEffect(() => {
    ;(async () => {
      try {
        const [b, s] = await Promise.all([api.get<unknown>('/bank-accounts/'), api.get<unknown>('/stations/')])
        setBanks(normalizeBankAccountsFromApi(b.data))
        setStations(Array.isArray(s.data) ? (s.data as StationOpt[]) : [])
      } catch {
        setBanks([])
        setStations([])
      }
    })()
  }, [])

  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'pay') setLedgerModal('payment')
    else if (action === 'edit') setEditOpen(true)
    else if (action === 'charge') setLedgerModal('rent_charge')
  }, [searchParams])

  const clearActionQuery = () => {
    router.replace(`/aquaculture/landlords/${landlordId}`, { scroll: false })
  }

  const openLedgerEdit = (row: LedgerRow) => {
    setLedgerEdit(row)
    setEditKind(row.kind as typeof editKind)
    setEditDate(row.entry_date.slice(0, 10))
    const n = Number(String(row.amount_signed).replace(/,/g, ''))
    setEditAmount(row.kind === 'adjustment' ? String(n) : String(Math.abs(n)))
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
    if (editKind === 'adjustment' && amt === 0) {
      toast.error('Adjustment cannot be zero')
      return
    }
    if (editKind !== 'adjustment' && amt <= 0) {
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
    if (!globalThis.confirm('Delete this ledger row? Pond paid totals will be reversed if applicable.')) {
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
    if (!detail || !globalThis.confirm(`Delete “${detail.name}” and all ledger history?`)) return
    try {
      await api.delete(`/aquaculture/landlords/${landlordId}/`)
      toast.success('Deleted')
      router.push('/aquaculture/landlords')
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

  const balanceNum = Number(String(detail.balance_signed).replace(/,/g, ''))

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/aquaculture/landlords"
          className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:text-teal-950"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All landlords
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
              <Landmark className="h-7 w-7 shrink-0 text-teal-700" aria-hidden />
              {detail.name}
            </h1>
            {detail.code ? (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-700">
                {detail.code}
              </span>
            ) : null}
            {!detail.is_active ? (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                Inactive
              </span>
            ) : null}
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(detail.balance_status)}`}
            >
              {statusLabel(detail.balance_status)}
            </span>
          </div>
          <p className="mt-2 text-lg font-semibold tabular-nums text-slate-900">
            Ledger balance: {sym}
            {formatNumber(balanceNum, 2)}
          </p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            {detail.phone ? (
              <div>
                <dt className="inline font-medium text-slate-700">Phone </dt>
                <dd className="inline">{detail.phone}</dd>
              </div>
            ) : null}
            {detail.email ? (
              <div>
                <dt className="inline font-medium text-slate-700">Email </dt>
                <dd className="inline">{detail.email}</dd>
              </div>
            ) : null}
            <div>
              <dt className="inline font-medium text-slate-700">Pond shares </dt>
              <dd className="inline">{detail.pond_shares?.length ?? 0}</dd>
            </div>
          </dl>
          {detail.pond_shares?.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {detail.pond_shares.map((sh) => (
                <li
                  key={sh.id ?? `${sh.pond_id}-${sh.land_area_decimal}`}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                >
                  <span className="font-medium">{sh.pond_name || `Pond #${sh.pond_id}`}</span>
                  <span className="text-slate-500"> · </span>
                  {formatNumber(Number(String(sh.land_area_decimal).replace(/,/g, '')), 4)} dec
                </li>
              ))}
            </ul>
          ) : null}
          {detail.notes?.trim() ? (
            <p className="mt-3 max-w-2xl text-sm text-slate-600">{detail.notes.trim()}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setLedgerModal('payment')}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800"
          >
            <Wallet className="h-4 w-4" aria-hidden />
            Record payment
          </button>
          <button
            type="button"
            onClick={() => setLedgerModal('rent_charge')}
            className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900 hover:bg-teal-100"
          >
            <Receipt className="h-4 w-4" aria-hidden />
            Rent charge
          </button>
          <button
            type="button"
            onClick={() => setLedgerModal('adjustment')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Adjustment
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm hover:bg-slate-50"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void removeLandlord()}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete
          </button>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Ledger</h2>
          <p className="text-xs text-slate-500">
            Positive balance = we owe the landlord. Payments and credits reduce the balance.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Kind</th>
                <th className="px-4 py-2.5 text-right font-medium">Charge</th>
                <th className="px-4 py-2.5 text-right font-medium">Payment</th>
                <th className="px-4 py-2.5 text-right font-medium">Net</th>
                <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                <th className="px-4 py-2.5 font-medium">Pond</th>
                <th className="px-4 py-2.5 font-medium">Memo / ref.</th>
                <th className="px-4 py-2.5 font-medium">G/L</th>
                <th className="w-20 px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {(detail.ledger || []).length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                    No ledger entries yet. Record a payment or post a rent charge to get started.
                  </td>
                </tr>
              ) : (
                (detail.ledger as LedgerRow[]).map((e) => {
                  const ch =
                    e.charge_display != null && e.charge_display !== ''
                      ? Number(String(e.charge_display).replace(/,/g, ''))
                      : null
                  const pay =
                    e.payment_display != null && e.payment_display !== ''
                      ? Number(String(e.payment_display).replace(/,/g, ''))
                      : null
                  return (
                    <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-4 py-2.5">{formatDateOnly(e.entry_date)}</td>
                      <td className="px-4 py-2.5">{kindLabel(e.kind)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {ch != null && Number.isFinite(ch) ? `${sym}${formatNumber(ch, 2)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {pay != null && Number.isFinite(pay) ? `${sym}${formatNumber(pay, 2)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                        {sym}
                        {formatNumber(Number(String(e.amount_signed).replace(/,/g, '')), 2)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                        {sym}
                        {formatNumber(Number(String(e.running_balance).replace(/,/g, '')), 2)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{e.pond_name || '—'}</td>
                      <td className="max-w-[200px] truncate px-4 py-2.5 text-slate-600">
                        {e.memo || e.reference || '—'}
                      </td>
                      <td className="max-w-[120px] truncate px-4 py-2.5 font-mono text-xs">
                        {e.journal_entry_number?.trim() || '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-0.5">
                          <button
                            type="button"
                            onClick={() => openLedgerEdit(e)}
                            className="rounded p-1 text-slate-600 hover:bg-slate-100"
                            title="Edit entry"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeLedger(e.id)}
                            className="rounded p-1 text-red-700 hover:bg-red-50"
                            title="Delete entry"
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

      <LandlordFormModal
        open={editOpen}
        mode="edit"
        landlordId={landlordNumId}
        ponds={ponds}
        currency={currency}
        onClose={() => {
          setEditOpen(false)
          clearActionQuery()
        }}
        onSuccess={() => {
          void load()
          setEditOpen(false)
          clearActionQuery()
        }}
      />

      {ledgerModal ? (
        <LandlordLedgerEntryModal
          open
          landlordId={landlordNumId}
          landlordName={detail.name}
          ponds={ponds}
          currency={currency}
          defaultKind={ledgerModal}
          onClose={() => {
            setLedgerModal(null)
            clearActionQuery()
          }}
          onSuccess={() => {
            void load()
            setLedgerModal(null)
            clearActionQuery()
          }}
        />
      ) : null}

      {ledgerEdit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Edit ledger entry</h3>
            <div className="mt-4 grid gap-3 text-sm">
              <label className="font-medium text-slate-700">
                Kind
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                  value={editKind}
                  onChange={(ev) => setEditKind(ev.target.value as typeof editKind)}
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
                  onChange={(ev) => setEditDate(ev.target.value)}
                />
              </label>
              <label className="font-medium text-slate-700">
                {editKind === 'adjustment' ? 'Signed amount' : 'Amount (positive)'}
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 tabular-nums"
                  value={editAmount}
                  onChange={(ev) => setEditAmount(ev.target.value)}
                />
              </label>
              <label className="font-medium text-slate-700">
                Pond
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                  value={editPond}
                  onChange={(ev) => setEditPond(ev.target.value)}
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
                    onChange={(ev) => setEditApplyPaid(ev.target.checked)}
                  />
                  Update pond paid
                </label>
              ) : null}
              <label className="font-medium text-slate-700">
                Memo
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                  value={editMemo}
                  onChange={(ev) => setEditMemo(ev.target.value)}
                />
              </label>
              <label className="font-medium text-slate-700">
                Reference
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                  value={editRef}
                  onChange={(ev) => setEditRef(ev.target.value)}
                />
              </label>
              {editKind === 'payment' ? (
                <>
                  <label className="font-medium text-slate-700">
                    Bank register
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                      value={editBankId}
                      onChange={(ev) => setEditBankId(ev.target.value)}
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
                    Site
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                      value={editStationId}
                      onChange={(ev) => setEditStationId(ev.target.value)}
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
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
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
