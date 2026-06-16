'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { FileCheck, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { REFERENCE_FETCH_LIMIT } from '@/lib/pagination'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import { AquacultureSaleFormModal } from './AquacultureSaleFormModal'
import {
  type CustomerSuggestion,
  type FishSpeciesOpt,
  type IncomeTypeOpt,
  type Pond,
  type SaleRow,
  customerPickLabel,
  fishPerKg,
  isNonFishSaleIncome,
  normalizeCustomersFromApi,
} from './aquacultureSaleShared'

export default function AquacultureSalesPage() {
  const toast = useToast()
  const searchParams = useSearchParams()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [incomeTypes, setIncomeTypes] = useState<IncomeTypeOpt[]>([])
  const [fishSpecies, setFishSpecies] = useState<FishSpeciesOpt[]>([])
  const [rows, setRows] = useState<SaleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [currency, setCurrency] = useState('BDT')
  const [filterPond, setFilterPond] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<SaleRow | null>(null)
  const [customers, setCustomers] = useState<CustomerSuggestion[]>([])
  const [finalizeRow, setFinalizeRow] = useState<SaleRow | null>(null)
  const [finalizeSubmitting, setFinalizeSubmitting] = useState(false)
  const [finalizeRecordAs, setFinalizeRecordAs] = useState<'cash_paid' | 'on_account'>('cash_paid')
  const [finalizeCustomerId, setFinalizeCustomerId] = useState('')
  const [finalizePaymentMethod, setFinalizePaymentMethod] = useState('cash')
  const [finalizeDueDate, setFinalizeDueDate] = useState('')
  const loadPonds = useCallback(async () => {
    try {
      const [co, pRes, iRes, spRes, custRes] = await Promise.all([
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<Pond[]>('/aquaculture/ponds/'),
        api.get<IncomeTypeOpt[]>('/aquaculture/income-types/'),
        api.get<FishSpeciesOpt[]>('/aquaculture/fish-species/').catch(() => ({ data: [] })),
        api
          .get<unknown>('/customers/', { params: { skip: 0, limit: REFERENCE_FETCH_LIMIT } })
          .catch(() => ({ data: [] })),
      ])
      setCurrency(String(co.data?.currency || 'BDT').slice(0, 3))
      setPonds(Array.isArray(pRes.data) ? pRes.data : [])
      setIncomeTypes(Array.isArray(iRes.data) ? iRes.data : [])
      setFishSpecies(Array.isArray(spRes.data) ? spRes.data : [])
      setCustomers(normalizeCustomersFromApi(custRes.data))
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds'))
    }
  }, [toast])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterPond ? { pond_id: filterPond } : undefined
      const { data } = await api.get<SaleRow[]>('/aquaculture/sales/', { params })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load sales'))
    } finally {
      setLoading(false)
    }
  }, [toast, filterPond])

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    const raw = searchParams.get('pond_id')
    if (raw != null && /^\d+$/.test(raw.trim())) {
      setFilterPond(raw.trim())
    }
  }, [searchParams])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const sym = getCurrencySymbol(currency)

  const openNew = () => {
    setEditing(null)
    setModal(true)
  }

  const openEdit = (r: SaleRow) => {
    if (r.accounting_posted) {
      toast.error('This line is already in the books. Change it from Invoices, or delete that invoice to unlock editing here.')
      return
    }
    setEditing(r)
    setModal(true)
  }

  const remove = async (r: SaleRow) => {
    if (r.accounting_posted) {
      toast.error('Remove or void the linked invoice first, then you can delete this line.')
      return
    }
    if (!window.confirm('Delete this sale?')) return
    try {
      await api.delete(`/aquaculture/sales/${r.id}/`)
      toast.success('Deleted')
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  const openFinalize = (r: SaleRow) => {
    if (r.accounting_posted) return
    setFinalizeRow(r)
    setFinalizeRecordAs('cash_paid')
    setFinalizeCustomerId('')
    setFinalizePaymentMethod('cash')
    const d = new Date()
    d.setDate(d.getDate() + 30)
    setFinalizeDueDate(d.toISOString().slice(0, 10))
  }

  const submitFinalize = async () => {
    if (!finalizeRow) return
    setFinalizeSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        record_as: finalizeRecordAs,
        payment_method: finalizeRecordAs === 'cash_paid' ? finalizePaymentMethod : '',
      }
      if (finalizeRecordAs === 'on_account') {
        if (!finalizeCustomerId.trim()) {
          toast.error('Choose a customer for on-account (A/R) sales.')
          setFinalizeSubmitting(false)
          return
        }
        payload.customer_id = parseInt(finalizeCustomerId, 10)
        if (finalizeDueDate.trim()) payload.due_date = finalizeDueDate.trim()
      } else if (finalizeCustomerId.trim()) {
        payload.customer_id = parseInt(finalizeCustomerId, 10)
      }
      const { data } = await api.post<{ sale: SaleRow; invoice: { invoice_number?: string } }>(
        `/aquaculture/sales/${finalizeRow.id}/finalize/`,
        payload
      )
      const invNo = data?.invoice?.invoice_number || 'invoice'
      toast.success(`Recorded: ${invNo}. Revenue is in the journal (AUTO-INV sale entry).`)
      setFinalizeRow(null)
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not record to books'))
    } finally {
      setFinalizeSubmitting(false)
    }
  }

  const creditCustomerOptions = customers.filter((c) => {
    const n = customerPickLabel(c).trim().toLowerCase()
    return n !== 'walk-in' && n !== 'walk in'
  })

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-8">
      <datalist id="aq-sale-customer-suggestions">
        {customers.map((c) => (
          <option key={c.id} value={customerPickLabel(c)} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-teal-800">
            <Link href="/aquaculture" className="hover:underline">
              Aquaculture
            </Link>
            <span className="text-slate-400" aria-hidden>
              {' '}
              /{' '}
            </span>
            <span className="text-slate-700">Pond &amp; fish sales</span>
          </p>
          <h1 id="aq-sales-title" className="mt-1 text-xl font-bold tracking-tight text-slate-900">
            Pond &amp; fish sales
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            Record one buyer visit with multiple lines — different species, or the same species from different production
            cycles (size and price). Plus pond-side income such
            as empty feed sacks and sales of used or scrap materials. Use{' '}
            <Link href="/cashier" className="font-medium text-teal-800 underline">
              Cashier
            </Link>{' '}
            for packaged retail over the counter—this screen is the operational record for fish leaving ponds (kg, head)
            and aquaculture revenue. Use income type to classify each line; feed purchases stay on Expenses. Use{' '}
            <strong className="font-medium text-slate-800">Record to books</strong> on a row to create the invoice and GL
            entry (aquaculture revenue 4240–4244, cash or A/R).
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            Pond
            <select
              className="ml-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={filterPond}
              onChange={(e) => setFilterPond(e.target.value)}
            >
              <option value="">All</option>
              {ponds.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void loadRows()} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={loading || ponds.length === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Record sale
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : ponds.length === 0 ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-950">
          <p className="font-medium">Add at least one pond first</p>
          <p className="mt-1 text-amber-900/90">Sales are tied to a pond. Create ponds, then enter sales here.</p>
          <Link
            href="/aquaculture/ponds"
            className="mt-3 inline-block font-medium text-teal-800 underline decoration-teal-600/50 hover:decoration-teal-800"
          >
            Go to Ponds
          </Link>
        </div>
      ) : (
        <div className="mt-6 w-full min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full table-fixed border-collapse text-left text-sm" aria-labelledby="aq-sales-title">
            <caption className="sr-only">Aquaculture pond and fish sales</caption>
            <colgroup>
              <col className="w-[6%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[12%]" />
              <col className="w-[9%]" />
              <col className="w-[7%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-2 py-2 align-bottom">
                  Date
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  Pond
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  Cycle
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  Income
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  Species
                </th>
                <th scope="col" className="px-2 py-2 text-right align-bottom">
                  Qty/kg
                </th>
                <th scope="col" className="px-2 py-2 text-right align-bottom">
                  Heads
                </th>
                <th scope="col" className="px-2 py-2 text-right align-bottom" title="Fish per kg (from harvest lines with head count)">
                  Fish/kg
                </th>
                <th scope="col" className="px-2 py-2 text-right align-bottom">
                  Amount
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  Buyer
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  Books
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowFishPerKg =
                  r.income_type === 'fish_harvest_sale' ? fishPerKg(Number(r.weight_kg), r.fish_count) : null
                return (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 whitespace-nowrap align-top">{formatDateOnly(r.sale_date)}</td>
                  <td className="min-w-0 break-words px-2 py-2 align-top text-slate-800">{r.pond_name}</td>
                  <td className="min-w-0 break-words px-2 py-2 align-top text-slate-600">{r.production_cycle_name || '—'}</td>
                  <td className="min-w-0 break-words px-2 py-2 align-top text-slate-700">{r.income_type_label || r.income_type || '—'}</td>
                  <td className="min-w-0 break-words px-2 py-2 align-top text-slate-700">
                    {r.income_type && isNonFishSaleIncome(r.income_type, incomeTypes) ? '—' : r.fish_species_label || '—'}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums align-top">{formatNumber(Number(r.weight_kg))}</td>
                  <td className="px-2 py-2 text-right tabular-nums align-top">
                    {r.income_type && isNonFishSaleIncome(r.income_type, incomeTypes) ? '—' : (r.fish_count ?? '—')}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums align-top text-slate-600">
                    {rowFishPerKg != null ? formatNumber(rowFishPerKg) : '—'}
                  </td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums align-top">
                    {sym}
                    {formatNumber(Number(r.total_amount))}
                  </td>
                  <td className="min-w-0 break-words px-2 py-2 align-top">{r.buyer_name || '—'}</td>
                  <td className="min-w-0 px-2 py-2 align-top text-xs">
                    {r.accounting_posted && r.invoice_number ? (
                      <span className="inline-flex flex-col gap-0.5 break-words">
                        <span className="inline-flex w-fit max-w-full items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 ring-1 ring-emerald-200">
                          <FileCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          Posted
                        </span>
                        <Link
                          href="/invoices"
                          className="break-all text-teal-700 underline decoration-teal-600/40 hover:decoration-teal-800"
                        >
                          {r.invoice_number}
                        </Link>
                      </span>
                    ) : (
                      <span
                        className="inline-block rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 ring-1 ring-slate-200"
                        title="Use Record in Actions to create the invoice and GL entry"
                      >
                        Not posted
                      </span>
                    )}
                  </td>
                  <td className="min-w-0 px-2 py-2 align-top">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {!r.accounting_posted ? (
                        <button
                          type="button"
                          className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
                          title="Record to books"
                          onClick={() => openFinalize(r)}
                        >
                          Record
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`text-sm ${r.accounting_posted ? 'cursor-not-allowed text-slate-400' : 'text-blue-600 hover:underline'}`}
                        onClick={() => openEdit(r)}
                        disabled={!!r.accounting_posted}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={r.accounting_posted ? 'cursor-not-allowed text-slate-300' : 'text-red-600'}
                        onClick={() => void remove(r)}
                        disabled={!!r.accounting_posted}
                        title={r.accounting_posted ? 'Delete the linked invoice first' : 'Delete'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-2 py-8 text-center text-slate-500">
                    No sales recorded.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <AquacultureSaleFormModal
        open={modal}
        editing={editing}
        ponds={ponds}
        incomeTypes={incomeTypes}
        fishSpecies={fishSpecies}
        customers={customers}
        currency={currency}
        defaultPondId={filterPond}
        onClose={() => setModal(false)}
        onSaved={() => void loadRows()}
      />

      {finalizeRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-labelledby="finalize-sale-title"
            aria-modal="true"
          >
            <h2 id="finalize-sale-title" className="text-lg font-semibold text-slate-900">
              Record to books
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Creates invoice <span className="font-mono text-slate-800">INV-AQ-{finalizeRow.id}</span>, posts revenue
              to your aquaculture income account (by income type), and debits cash or accounts receivable. You can
              still see this row here for pond reporting; amounts lock until the invoice is removed.
            </p>
            <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-700">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Pond</span>
                <span className="text-right font-medium">{finalizeRow.pond_name}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Amount</span>
                <span className="font-medium tabular-nums">
                  {sym}
                  {formatNumber(Number(finalizeRow.total_amount))}
                </span>
              </div>
            </div>
            <fieldset className="mt-4 space-y-2">
              <legend className="text-sm font-medium text-slate-700">How was it settled?</legend>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="finalize-record-as"
                  checked={finalizeRecordAs === 'cash_paid'}
                  onChange={() => setFinalizeRecordAs('cash_paid')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-slate-800">Cash or immediate payment</span>
                  <span className="block text-slate-500">Invoice status: paid. Debits cash (or card clearing).</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="finalize-record-as"
                  checked={finalizeRecordAs === 'on_account'}
                  onChange={() => setFinalizeRecordAs('on_account')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-slate-800">On account (A/R)</span>
                  <span className="block text-slate-500">Invoice status: sent. Debits accounts receivable.</span>
                </span>
              </label>
            </fieldset>
            {finalizeRecordAs === 'cash_paid' ? (
              <label className="mt-3 block text-sm font-medium text-slate-700">
                Payment method
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={finalizePaymentMethod}
                  onChange={(e) => setFinalizePaymentMethod(e.target.value)}
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank">Bank / transfer</option>
                </select>
              </label>
            ) : (
              <>
                <label className="mt-3 block text-sm font-medium text-slate-700">
                  Bill-to customer <span className="text-red-600">*</span>
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={finalizeCustomerId}
                    onChange={(e) => setFinalizeCustomerId(e.target.value)}
                    required
                  >
                    <option value="">Select customer…</option>
                    {creditCustomerOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {customerPickLabel(c)}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500">
                    Or link the pond to a POS customer under Ponds — it will be used if you leave this empty (on
                    account only).
                  </span>
                </label>
                <label className="mt-3 block text-sm font-medium text-slate-700">
                  Due date
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={finalizeDueDate}
                    onChange={(e) => setFinalizeDueDate(e.target.value)}
                  />
                </label>
              </>
            )}
            {finalizeRecordAs === 'cash_paid' ? (
              <label className="mt-3 block text-sm font-medium text-slate-700">
                Invoice customer (optional)
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={finalizeCustomerId}
                  onChange={(e) => setFinalizeCustomerId(e.target.value)}
                >
                  <option value="">Walk-in (default)</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {customerPickLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={finalizeSubmitting}
                onClick={() => setFinalizeRow(null)}
                className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={finalizeSubmitting}
                onClick={() => void submitFinalize()}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {finalizeSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
