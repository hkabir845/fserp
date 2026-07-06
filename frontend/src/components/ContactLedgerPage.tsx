'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import api, { isApiSessionError } from '@/lib/api'
import { getCurrencySymbol } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import { printLedgerStatement, buildLedgerStatementCsv } from '@/utils/printDocument'
import { loadPrintBranding } from '@/utils/printBranding'
import { downloadCsvFile, downloadJsonFile } from '@/utils/businessDocumentExport'
import { DocumentExportButtons } from '@/components/DocumentExportButtons'
import { TransactionListEmptyState } from '@/components/TransactionListEmptyState'
import { ArrowLeft, BookOpen, FilterX, Loader2, RefreshCw, Search } from 'lucide-react'
import {
  hasActiveTransactionFilters,
  hasTransactionTextSearch,
  transactionDateParams,
} from '@/lib/transactionListFilters'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useToast } from '@/components/Toast'

export type LedgerEntity = 'customers' | 'vendors' | 'employees'

export interface LedgerTransaction {
  date: string
  type: string
  reference: string
  description: string
  debit: string
  credit: string
  balance: string
  related_id?: number
  allocations?: { invoice_id?: number; bill_id?: number; invoice_number?: string; bill_number?: string; amount: string }[]
}

export interface LedgerPayload {
  entity: string
  entity_id: number
  display_name: string
  balance_note?: string
  note?: string
  opening_balance?: string
  period_start_balance?: string
  closing_balance?: string
  closing_balance_all_time?: string
  stored_current_balance?: string
  transactions: LedgerTransaction[]
  start_date?: string | null
  end_date?: string | null
}

interface ContactLedgerPageProps {
  entity: LedgerEntity
  entityId: number
  backHref: string
  backLabel: string
  allowManualEntries?: boolean
}

export default function ContactLedgerPage({
  entity,
  entityId,
  backHref,
  backLabel,
  allowManualEntries = false,
}: ContactLedgerPageProps) {
  const router = useRouter()
  const toast = useToast()
  const [currencySymbol, setCurrencySymbol] = useState('৳')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const debouncedSearch = useDebouncedValue(searchQ.trim())
  const [data, setData] = useState<LedgerPayload | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refetching, setRefetching] = useState(false)
  const [entryForm, setEntryForm] = useState({
    entry_date: new Date().toISOString().split('T')[0],
    entry_type: 'salary',
    reference: '',
    memo: '',
    debit: '',
    credit: '',
  })
  const [savingEntry, setSavingEntry] = useState(false)

  const ledgerPath = `/${entity}/${entityId}/ledger/`

  const hasTextSearch = hasTransactionTextSearch({ q: debouncedSearch })

  const hasActiveFilters = hasActiveTransactionFilters({
    search: searchQ,
    startDate,
    endDate,
  })

  const clearFilters = () => {
    setStartDate('')
    setEndDate('')
    setSearchQ('')
  }

  const load = useCallback(async () => {
    setRefetching(true)
    try {
      const params = new URLSearchParams()
      const dates = transactionDateParams(startDate, endDate, hasTextSearch)
      if (dates.start_date) params.set('start_date', dates.start_date)
      if (dates.end_date) params.set('end_date', dates.end_date)
      if (debouncedSearch) params.set('q', debouncedSearch)
      const q = params.toString()
      const url = q ? `${ledgerPath}?${q}` : ledgerPath
      const res = await api.get<LedgerPayload>(url)
      setData(res.data)
    } catch (e: unknown) {
      if (isApiSessionError(e)) return
      console.error(e)
      const detail =
        e &&
        typeof e === 'object' &&
        'response' in e &&
        e.response &&
        typeof e.response === 'object' &&
        'data' in e.response &&
        e.response.data &&
        typeof e.response.data === 'object' &&
        'detail' in e.response.data
          ? String((e.response.data as { detail?: unknown }).detail ?? '')
          : ''
      toast.error(detail || 'Failed to load ledger')
      setData(null)
    } finally {
      setInitialLoading(false)
      setRefetching(false)
    }
  }, [entity, entityId, startDate, endDate, debouncedSearch, hasTextSearch, ledgerPath, toast])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    api
      .get('/companies/current/')
      .then((r) => {
        if (r.data?.currency) setCurrencySymbol(getCurrencySymbol(r.data.currency))
      })
      .catch(() => {})
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  const handlePrintLedger = async () => {
    if (!data) return
    const titles: Record<LedgerEntity, string> = {
      customers: 'Customer account statement',
      vendors: 'Vendor account statement',
      employees: 'Employee ledger statement',
    }
    const branding = await loadPrintBranding(api)
    const ok = printLedgerStatement(
      {
        display_name: data.display_name,
        period_start_balance: data.period_start_balance,
        closing_balance: data.closing_balance,
        start_date: data.start_date ?? null,
        end_date: data.end_date ?? null,
        transactions: data.transactions,
      },
      {
        companyName: branding.companyName,
        companyAddress: branding.companyAddress,
        stationName: branding.stationName,
        currencySymbol,
        documentTitle: titles[entity],
        printedAt: formatDate(new Date(), true),
        branding,
      }
    )
    if (!ok) toast.error('Allow pop-ups in your browser to print.')
  }

  const ledgerExportInput = () => {
    if (!data) return null
    return {
      display_name: data.display_name,
      period_start_balance: data.period_start_balance,
      closing_balance: data.closing_balance,
      start_date: data.start_date ?? null,
      end_date: data.end_date ?? null,
      transactions: data.transactions,
    }
  }

  const handleDownloadLedgerCsv = () => {
    const input = ledgerExportInput()
    if (!input) return
    const slug = data!.display_name.replace(/[^\w.-]+/g, '_').slice(0, 40)
    downloadCsvFile(`ledger_${slug}_${new Date().toISOString().slice(0, 10)}.csv`, buildLedgerStatementCsv(input))
  }

  const handleDownloadLedgerJson = () => {
    if (!data) return
    const slug = data.display_name.replace(/[^\w.-]+/g, '_').slice(0, 40)
    downloadJsonFile(`ledger_${slug}_${new Date().toISOString().slice(0, 10)}.json`, data)
  }

  const submitEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    const debit = parseFloat(entryForm.debit || '0') || 0
    const credit = parseFloat(entryForm.credit || '0') || 0
    if (debit <= 0 && credit <= 0) {
      toast.error('Enter a debit or credit amount')
      return
    }
    setSavingEntry(true)
    try {
      await api.post(`/employees/${entityId}/ledger/entries/`, {
        entry_date: entryForm.entry_date,
        entry_type: entryForm.entry_type,
        reference: entryForm.reference || undefined,
        memo: entryForm.memo || undefined,
        debit: debit || undefined,
        credit: credit || undefined,
      })
      toast.success('Ledger entry saved')
      setEntryForm((f) => ({
        ...f,
        reference: '',
        memo: '',
        debit: '',
        credit: '',
      }))
      load()
    } catch (err: unknown) {
      console.error(err)
      toast.error('Could not save entry')
    } finally {
      setSavingEntry(false)
    }
  }

  return (
    <div className="flex h-screen page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto app-scroll-pad">
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <Link
              href={backHref}
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
            <div className="flex items-center gap-2 text-muted-foreground/70">/</div>
            <div className="flex items-center gap-2 text-foreground font-semibold">
              <BookOpen className="h-5 w-5" />
              Ledger
            </div>
          </div>

          {initialLoading && !data ? (
            <div className="flex justify-center py-24">
              <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
            </div>
          ) : data ? (
            <>
              <div className="mb-6 rounded-lg bg-white p-6 shadow">
                <h1 className="text-2xl font-bold text-foreground">{data.display_name}</h1>
                {data.note && (
                  <p className="mt-2 text-sm text-warning-foreground bg-warning/10 border border-amber-100 rounded px-3 py-2">
                    {data.note}
                  </p>
                )}
                {data.balance_note && (
                  <p className={`text-sm text-muted-foreground ${data.note ? 'mt-3' : 'mt-2'}`}>
                    {data.balance_note}
                  </p>
                )}
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Period start balance</p>
                    <p className="text-lg font-semibold text-foreground">
                      {currencySymbol}
                      {parseFloat(data.period_start_balance || '0').toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Closing balance (period)</p>
                    <p className="text-lg font-semibold text-primary">
                      {currencySymbol}
                      {parseFloat(data.closing_balance || '0').toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Stored profile balance</p>
                    <p className="text-lg font-semibold text-foreground/85">
                      {currencySymbol}
                      {parseFloat(data.stored_current_balance || '0').toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  {data.closing_balance_all_time != null && (
                    <div>
                      <p className="text-xs font-medium uppercase text-muted-foreground">All-time closing</p>
                      <p className="text-lg font-semibold text-muted-foreground">
                        {currencySymbol}
                        {parseFloat(data.closing_balance_all_time || '0').toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap items-end gap-4 border-t border-border/70 pt-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground">Start date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="mt-1 rounded border border-border px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground">End date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="mt-1 rounded border border-border px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="min-w-[14rem] flex-1">
                    <label className="block text-xs font-medium text-muted-foreground">Search (all dates)</label>
                    <div className="relative mt-1">
                      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                      <input
                        type="search"
                        value={searchQ}
                        onChange={(e) => setSearchQ(e.target.value)}
                        placeholder="Reference, description…"
                        className="w-full rounded border border-border py-2 pl-8 pr-3 text-sm"
                      />
                    </div>
                    {hasTextSearch && (startDate || endDate) ? (
                      <p className="mt-1 text-xs text-muted-foreground">Date range paused while searching.</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => load()}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary"
                  >
                    <RefreshCw className={`h-4 w-4 ${refetching ? 'animate-spin' : ''}`} />
                    Apply
                  </button>
                  {hasActiveFilters ? (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <FilterX className="h-3.5 w-3.5" aria-hidden />
                      Clear filters
                    </button>
                  ) : null}
                  <DocumentExportButtons
                    size="compact"
                    onPrint={() => void handlePrintLedger()}
                    onDownloadCsv={handleDownloadLedgerCsv}
                    onDownloadJson={handleDownloadLedgerJson}
                    printLabel="Print statement"
                  />
                </div>
              </div>

              {allowManualEntries && (
                <div className="mb-6 rounded-lg bg-white p-6 shadow">
                  <h2 className="text-lg font-semibold text-foreground">Add ledger entry</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Debit increases net payable to the employee; credit records payment or recovery.
                  </p>
                  <form onSubmit={submitEntry} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Date</label>
                      <input
                        type="date"
                        required
                        value={entryForm.entry_date}
                        onChange={(e) => setEntryForm((f) => ({ ...f, entry_date: e.target.value }))}
                        className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Type</label>
                      <select
                        value={entryForm.entry_type}
                        onChange={(e) => setEntryForm((f) => ({ ...f, entry_type: e.target.value }))}
                        className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                      >
                        <option value="salary">Salary / wages</option>
                        <option value="overtime">Overtime</option>
                        <option value="advance">Advance to employee</option>
                        <option value="repayment">Repayment / deduction</option>
                        <option value="bonus">Bonus</option>
                        <option value="adjustment">Adjustment</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Reference</label>
                      <input
                        value={entryForm.reference}
                        onChange={(e) => setEntryForm((f) => ({ ...f, reference: e.target.value }))}
                        className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                        placeholder="Optional"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">Memo</label>
                      <input
                        value={entryForm.memo}
                        onChange={(e) => setEntryForm((f) => ({ ...f, memo: e.target.value }))}
                        className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                        placeholder="Description"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Debit</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={entryForm.debit}
                        onChange={(e) => setEntryForm((f) => ({ ...f, debit: e.target.value }))}
                        className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Credit</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={entryForm.credit}
                        onChange={(e) => setEntryForm((f) => ({ ...f, credit: e.target.value }))}
                        className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={savingEntry}
                        className="w-full rounded-lg bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success/90 disabled:opacity-50"
                      >
                        {savingEntry ? 'Saving…' : 'Save entry'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              <div className="relative overflow-hidden rounded-lg bg-white shadow">
                {refetching ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Updating ledger" />
                  </div>
                ) : null}
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Reference</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Description</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">Debit</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">Credit</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white">
                    {data.transactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <TransactionListEmptyState
                            title={
                              hasTextSearch
                                ? 'No matching transactions'
                                : hasActiveFilters
                                  ? 'No transactions in this period'
                                  : 'No ledger activity yet'
                            }
                            description={
                              hasTextSearch
                                ? 'Try different keywords or clear filters to see all activity.'
                                : hasActiveFilters
                                  ? 'Adjust the date range or clear filters to widen the view.'
                                  : 'Invoices, bills, and payments for this contact will appear here.'
                            }
                            hasActiveFilters={hasActiveFilters}
                            onClearFilters={clearFilters}
                          />
                        </td>
                      </tr>
                    ) : (
                      data.transactions.map((row, idx) => (
                        <tr key={`${row.date}-${row.reference}-${idx}`} className="hover:bg-muted/40">
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-foreground">{row.date}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">{row.type}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">{row.reference}</td>
                          <td className="px-4 py-3 text-sm text-foreground/85">
                            <div>{row.description}</div>
                            {row.allocations && row.allocations.length > 0 && (
                              <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                                {row.allocations.map((a, i) => (
                                  <li key={i}>
                                    {(a.invoice_number || a.bill_number || 'Line')}: {currencySymbol}
                                    {parseFloat(a.amount).toLocaleString(undefined, {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-foreground">
                            {parseFloat(row.debit) > 0
                              ? `${currencySymbol}${parseFloat(row.debit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-foreground">
                            {parseFloat(row.credit) > 0
                              ? `${currencySymbol}${parseFloat(row.credit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-foreground">
                            {currencySymbol}
                            {parseFloat(row.balance).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">No data.</p>
          )}
        </div>
      </div>
  )
}
