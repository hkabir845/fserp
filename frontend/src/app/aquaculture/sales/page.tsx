'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { FileCheck, Loader2, Plus, RefreshCw, ShoppingBag, Trash2 } from 'lucide-react'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { AQ_HERO_BTN_GHOST, AQ_HERO_BTN_PRIMARY, AQ_HERO_SELECT_BLOCK, PipelineStatCard } from '@/components/aquaculture/AquacultureUi'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import api from '@/lib/api'
import { REFERENCE_FETCH_LIMIT } from '@/lib/pagination'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import { AquacultureSaleFormModal } from './AquacultureSaleFormModal'
import { aquacultureT, aquacultureTFormat } from '@/lib/aquacultureI18n'
import { useT } from '@/lib/i18n'
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
  const pageMeta = usePageMeta()
  const toast = useToast()
  const { lang, t, pick } = useT()
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
      toast.error(extractErrorMessage(e, aquacultureT('couldNotLoadPonds', lang)))
    }
  }, [toast, lang])

  const loadIncomeTypes = useCallback(async () => {
    try {
      const { data } = await api.get<IncomeTypeOpt[]>('/aquaculture/income-types/')
      setIncomeTypes(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, aquacultureT('couldNotLoadIncomeTypes', lang)))
    }
  }, [toast, lang])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterPond ? { pond_id: filterPond } : undefined
      const { data } = await api.get<SaleRow[]>('/aquaculture/sales/', { params })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, aquacultureT('couldNotLoadSales', lang)))
    } finally {
      setLoading(false)
    }
  }, [toast, filterPond])

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    if (!modal) return
    void loadIncomeTypes()
  }, [modal, loadIncomeTypes])

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
      toast.error(aquacultureT('salePostedEditBlocked', lang))
      return
    }
    setEditing(r)
    setModal(true)
  }

  const remove = async (r: SaleRow) => {
    if (r.accounting_posted) {
      toast.error(aquacultureT('salePostedDeleteBlocked', lang))
      return
    }
    if (!window.confirm(aquacultureT('confirmDelete', lang))) return
    try {
      await api.delete(`/aquaculture/sales/${r.id}/`)
      toast.success(t('deleted'))
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, t('deleteFailed')))
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
          toast.error(aquacultureT('chooseCustomerAr', lang))
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
      const invNo = data?.invoice?.invoice_number || pick('invoice', 'ইনভয়েস')
      toast.success(aquacultureTFormat('recordedInvoice', lang, { invNo }))
      setFinalizeRow(null)
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, aquacultureT('couldNotRecordBooks', lang)))
    } finally {
      setFinalizeSubmitting(false)
    }
  }

  const creditCustomerOptions = customers.filter((c) => {
    const n = customerPickLabel(c).trim().toLowerCase()
    return n !== 'walk-in' && n !== 'walk in'
  })

  return (
    <AquaculturePageShell
      titleId="aq-sales-title"
      eyebrow={pageMeta.eyebrow ?? aquacultureT('pondFishSales', lang)}
      title={pageMeta.title}
      titleIcon={ShoppingBag}
      description={pageMeta.description ?? ''}
      maxWidthClass="max-w-[1440px]"
      actions={
        <>
          <label className="text-xs font-medium text-teal-100">
            {t('pond')}
            <select
              className={AQ_HERO_SELECT_BLOCK}
              value={filterPond}
              onChange={(e) => setFilterPond(e.target.value)}
            >
              <option value="">{t('all')}</option>
              {ponds.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void loadRows()} className={AQ_HERO_BTN_GHOST}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t('refresh')}
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={loading || ponds.length === 0}
            className={AQ_HERO_BTN_PRIMARY}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {aquacultureT('recordSale', lang)}
          </button>
        </>
      }
      stats={
        ponds.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <PipelineStatCard
              title={aquacultureT('pondFishSales', lang)}
              value={rows.length}
              sub={t('total')}
              icon={ShoppingBag}
              tone="slate"
            />
          </div>
        ) : undefined
      }
    >
      <datalist id="aq-sale-customer-suggestions">
        {customers.map((c) => (
          <option key={c.id} value={customerPickLabel(c)} />
        ))}
      </datalist>

      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      ) : ponds.length === 0 ? (
        <div className="mt-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-5 text-sm text-warning-foreground">
          <p className="font-medium">{aquacultureT('addAtLeastOnePond', lang)}</p>
          <p className="mt-1 text-warning-foreground/90">{aquacultureT('salesNeedPond', lang)}</p>
          <Link
            href="/aquaculture/ponds"
            className="mt-3 inline-block font-medium text-primary underline decoration-teal-600/50 hover:decoration-teal-800"
          >
            {aquacultureT('goToPonds', lang)}
          </Link>
        </div>
      ) : (
        <div className="mt-6 w-full min-w-0 rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full table-fixed border-collapse text-left text-sm" aria-labelledby="aq-sales-title">
            <caption className="sr-only">{aquacultureT('pondFishSales', lang)}</caption>
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
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-2 align-bottom">
                  {t('date')}
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  {t('pond')}
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  {aquacultureT('cycle', lang)}
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  {aquacultureT('income', lang)}
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  {aquacultureT('species', lang)}
                </th>
                <th scope="col" className="px-2 py-2 text-right align-bottom">
                  {aquacultureT('qtyKg', lang)}
                </th>
                <th scope="col" className="px-2 py-2 text-right align-bottom">
                  {pick('Heads', 'Head (টি)')}
                </th>
                <th scope="col" className="px-2 py-2 text-right align-bottom" title={pick('Fish per kg (from harvest lines with head count)', 'প্রতি kg মাছ (head count সহ ধরা লাইন)')}>
                  {aquacultureT('fishPerKgCol', lang)}
                </th>
                <th scope="col" className="px-2 py-2 text-right align-bottom">
                  {pick('Amount', 'পরিমাণ')}
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  {aquacultureT('buyer', lang)}
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  {aquacultureT('books', lang)}
                </th>
                <th scope="col" className="px-2 py-2 align-bottom">
                  <span className="sr-only">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowFishPerKg =
                  r.income_type === 'fish_harvest_sale' ? fishPerKg(Number(r.weight_kg), r.fish_count) : null
                return (
                <tr key={r.id} className="border-b border-border/70">
                  <td className="px-2 py-2 whitespace-nowrap align-top">{formatDateOnly(r.sale_date)}</td>
                  <td className="min-w-0 break-words px-2 py-2 align-top text-foreground">{r.pond_name}</td>
                  <td className="min-w-0 break-words px-2 py-2 align-top text-muted-foreground">{r.production_cycle_name || '—'}</td>
                  <td className="min-w-0 break-words px-2 py-2 align-top text-foreground/85">{r.income_type_label || r.income_type || '—'}</td>
                  <td className="min-w-0 break-words px-2 py-2 align-top text-foreground/85">
                    {r.income_type && isNonFishSaleIncome(r.income_type, incomeTypes) ? '—' : r.fish_species_label || '—'}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums align-top">{formatNumber(Number(r.weight_kg))}</td>
                  <td className="px-2 py-2 text-right tabular-nums align-top">
                    {r.income_type && isNonFishSaleIncome(r.income_type, incomeTypes) ? '—' : (r.fish_count ?? '—')}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums align-top text-muted-foreground">
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
                          {pick('Posted', 'পোস্ট করা')}
                        </span>
                        <Link
                          href="/invoices"
                          className="break-all text-primary underline decoration-teal-600/40 hover:decoration-teal-800"
                        >
                          {r.invoice_number}
                        </Link>
                      </span>
                    ) : (
                      <span
                        className="inline-block rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground ring-1 ring-border"
                        title={aquacultureT('recordToBooksTitle', lang)}
                      >
                        {aquacultureT('notPosted', lang)}
                      </span>
                    )}
                  </td>
                  <td className="min-w-0 px-2 py-2 align-top">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {!r.accounting_posted ? (
                        <button
                          type="button"
                          className="rounded-md bg-foreground px-2 py-1 text-xs font-medium text-white hover:bg-foreground/90"
                          title={aquacultureT('recordToBooks', lang)}
                          onClick={() => openFinalize(r)}
                        >
                          {pick('Record', 'রেকর্ড')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`text-sm ${r.accounting_posted ? 'cursor-not-allowed text-muted-foreground/70' : 'text-primary hover:underline'}`}
                        onClick={() => openEdit(r)}
                        disabled={!!r.accounting_posted}
                      >
                        {t('edit')}
                      </button>
                      <button
                        type="button"
                        className={r.accounting_posted ? 'cursor-not-allowed text-muted-foreground/40' : 'text-destructive'}
                        onClick={() => void remove(r)}
                        disabled={!!r.accounting_posted}
                        title={r.accounting_posted ? aquacultureT('deleteLinkedInvoiceFirst', lang) : t('delete')}
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
                  <td colSpan={12} className="px-2 py-8 text-center text-muted-foreground">
                    {aquacultureT('noSalesYet', lang)}
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
            <h2 id="finalize-sale-title" className="text-lg font-semibold text-foreground">
              {aquacultureT('recordToBooks', lang)}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {aquacultureTFormat('finalizeIntro', lang, { invRef: `INV-AQ-${finalizeRow.id}` })}
            </p>
            <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/50 p-3 text-sm text-foreground/85">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">{t('pond')}</span>
                <span className="text-right font-medium">{finalizeRow.pond_name}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">{pick('Amount', 'পরিমাণ')}</span>
                <span className="font-medium tabular-nums">
                  {sym}
                  {formatNumber(Number(finalizeRow.total_amount))}
                </span>
              </div>
            </div>
            <fieldset className="mt-4 space-y-2">
              <legend className="text-sm font-medium text-foreground/85">{aquacultureT('howSettled', lang)}</legend>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="finalize-record-as"
                  checked={finalizeRecordAs === 'cash_paid'}
                  onChange={() => setFinalizeRecordAs('cash_paid')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-foreground">{aquacultureT('cashImmediate', lang)}</span>
                  <span className="block text-muted-foreground">{aquacultureT('cashImmediateHint', lang)}</span>
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
                  <span className="font-medium text-foreground">{aquacultureT('onAccountAr', lang)}</span>
                  <span className="block text-muted-foreground">{aquacultureT('onAccountArHint', lang)}</span>
                </span>
              </label>
            </fieldset>
            {finalizeRecordAs === 'cash_paid' ? (
              <label className="mt-3 block text-sm font-medium text-foreground/85">
                {aquacultureT('paymentMethod', lang)}
                <select
                  className="erp-select mt-1 w-full"
                  value={finalizePaymentMethod}
                  onChange={(e) => setFinalizePaymentMethod(e.target.value)}
                >
                  <option value="cash">{aquacultureT('payCash', lang)}</option>
                  <option value="card">{aquacultureT('payCard', lang)}</option>
                  <option value="bank">{aquacultureT('payBank', lang)}</option>
                </select>
              </label>
            ) : (
              <>
                <label className="mt-3 block text-sm font-medium text-foreground/85">
                  {aquacultureT('billToCustomer', lang)} <span className="text-destructive">*</span>
                  <select
                    className="erp-select mt-1 w-full"
                    value={finalizeCustomerId}
                    onChange={(e) => setFinalizeCustomerId(e.target.value)}
                    required
                  >
                    <option value="">{aquacultureT('selectCustomer', lang)}</option>
                    {creditCustomerOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {customerPickLabel(c)}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {aquacultureT('pondCustomerHint', lang)}
                  </span>
                </label>
                <label className="mt-3 block text-sm font-medium text-foreground/85">
                  {aquacultureT('dueDate', lang)}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2"
                    value={finalizeDueDate}
                    onChange={(e) => setFinalizeDueDate(e.target.value)}
                  />
                </label>
              </>
            )}
            {finalizeRecordAs === 'cash_paid' ? (
              <label className="mt-3 block text-sm font-medium text-foreground/85">
                {aquacultureT('invoiceCustomerOptional', lang)}
                <select
                  className="erp-select mt-1 w-full"
                  value={finalizeCustomerId}
                  onChange={(e) => setFinalizeCustomerId(e.target.value)}
                >
                  <option value="">{aquacultureT('walkInDefault', lang)}</option>
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
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={finalizeSubmitting}
                onClick={() => void submitFinalize()}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-white hover:bg-foreground/90 disabled:opacity-60"
              >
                {finalizeSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {pick('Confirm', 'নিশ্চিত করুন')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AquaculturePageShell>
  )
}
