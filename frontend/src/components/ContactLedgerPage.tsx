'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider } from '@/contexts/CompanyContext'
import api from '@/lib/api'
import { getCurrencySymbol } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import { printLedgerStatement } from '@/utils/printDocument'
import { ArrowLeft, BookOpen, Printer, RefreshCw } from 'lucide-react'
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
  const [printCompanyName, setPrintCompanyName] = useState('')
  const [printCompanyAddress, setPrintCompanyAddress] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [data, setData] = useState<LedgerPayload | null>(null)
  const [loading, setLoading] = useState(true)
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('start_date', startDate)
      if (endDate) params.set('end_date', endDate)
      const q = params.toString()
      const url = q ? `${ledgerPath}?${q}` : ledgerPath
      const res = await api.get<LedgerPayload>(url)
      setData(res.data)
    } catch (e: unknown) {
      console.error(e)
      toast.error('Failed to load ledger')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [entity, entityId, startDate, endDate, ledgerPath])

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
        const raw = r.data as Record<string, unknown> | undefined
        const n = raw?.name ?? raw?.company_name
        setPrintCompanyName(typeof n === 'string' ? n : '')
        const addr = raw?.address
        setPrintCompanyAddress(typeof addr === 'string' ? addr : '')
      })
      .catch(() => {})
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  const handlePrintLedger = () => {
    if (!data) return
    const titles: Record<LedgerEntity, string> = {
      customers: 'Customer account statement',
      vendors: 'Vendor account statement',
      employees: 'Employee ledger statement',
    }
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
        companyName: printCompanyName || 'Company',
        companyAddress: printCompanyAddress || undefined,
        currencySymbol,
        documentTitle: titles[entity],
        printedAt: formatDate(new Date(), true),
      }
    )
    if (!ok) toast.error('Allow pop-ups in your browser to print.')
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
    <CompanyProvider>
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <Link
              href={backHref}
              className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
            <div className="flex items-center gap-2 text-gray-400">/</div>
            <div className="flex items-center gap-2 text-gray-900 font-semibold">
              <BookOpen className="h-5 w-5" />
              Ledger
            </div>
          </div>

          {loading && !data ? (
            <div className="flex justify-center py-24">
              <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
            </div>
          ) : data ? (
            <>
              <div className="mb-6 rounded-lg bg-white p-6 shadow">
                <h1 className="text-2xl font-bold text-gray-900">{data.display_name}</h1>
                {data.note && (
                  <p className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded px-3 py-2">
                    {data.note}
                  </p>
                )}
                {data.balance_note && !data.note && (
                  <p className="mt-2 text-sm text-gray-600">{data.balance_note}</p>
                )}
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs font-medium uppercase text-gray-500">Period start balance</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {currencySymbol}
                      {parseFloat(data.period_start_balance || '0').toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-gray-500">Closing balance (period)</p>
                    <p className="text-lg font-semibold text-blue-700">
                      {currencySymbol}
                      {parseFloat(data.closing_balance || '0').toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-gray-500">Stored profile balance</p>
                    <p className="text-lg font-semibold text-gray-700">
                      {currencySymbol}
                      {parseFloat(data.stored_current_balance || '0').toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  {data.closing_balance_all_time != null && (
                    <div>
                      <p className="text-xs font-medium uppercase text-gray-500">All-time closing</p>
                      <p className="text-lg font-semibold text-gray-600">
                        {currencySymbol}
                        {parseFloat(data.closing_balance_all_time || '0').toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap items-end gap-4 border-t border-gray-100 pt-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500">Start date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="mt-1 rounded border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500">End date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="mt-1 rounded border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => load()}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStartDate('')
                      setEndDate('')
                    }}
                    className="text-sm text-gray-600 hover:text-gray-900"
                  >
                    Clear dates
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintLedger}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
                  >
                    <Printer className="h-4 w-4" />
                    Print statement
                  </button>
                </div>
              </div>

              {allowManualEntries && (
                <div className="mb-6 rounded-lg bg-white p-6 shadow">
                  <h2 className="text-lg font-semibold text-gray-900">Add ledger entry</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Debit increases net payable to the employee; credit records payment or recovery.
                  </p>
                  <form onSubmit={submitEntry} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500">Date</label>
                      <input
                        type="date"
                        required
                        value={entryForm.entry_date}
                        onChange={(e) => setEntryForm((f) => ({ ...f, entry_date: e.target.value }))}
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Type</label>
                      <select
                        value={entryForm.entry_type}
                        onChange={(e) => setEntryForm((f) => ({ ...f, entry_type: e.target.value }))}
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="salary">Salary / wages</option>
                        <option value="advance">Advance to employee</option>
                        <option value="repayment">Repayment / deduction</option>
                        <option value="bonus">Bonus</option>
                        <option value="adjustment">Adjustment</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Reference</label>
                      <input
                        value={entryForm.reference}
                        onChange={(e) => setEntryForm((f) => ({ ...f, reference: e.target.value }))}
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                        placeholder="Optional"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-gray-500">Memo</label>
                      <input
                        value={entryForm.memo}
                        onChange={(e) => setEntryForm((f) => ({ ...f, memo: e.target.value }))}
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                        placeholder="Description"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Debit</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={entryForm.debit}
                        onChange={(e) => setEntryForm((f) => ({ ...f, debit: e.target.value }))}
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Credit</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={entryForm.credit}
                        onChange={(e) => setEntryForm((f) => ({ ...f, credit: e.target.value }))}
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={savingEntry}
                        className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {savingEntry ? 'Saving…' : 'Save entry'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              <div className="overflow-hidden rounded-lg bg-white shadow">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Reference</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Description</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Debit</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Credit</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {data.transactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                          No transactions in this period.
                        </td>
                      </tr>
                    ) : (
                      data.transactions.map((row, idx) => (
                        <tr key={`${row.date}-${row.reference}-${idx}`} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">{row.date}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{row.type}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{row.reference}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            <div>{row.description}</div>
                            {row.allocations && row.allocations.length > 0 && (
                              <ul className="mt-1 list-inside list-disc text-xs text-gray-500">
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
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                            {parseFloat(row.debit) > 0
                              ? `${currencySymbol}${parseFloat(row.debit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                            {parseFloat(row.credit) > 0
                              ? `${currencySymbol}${parseFloat(row.credit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900">
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
            <p className="text-gray-600">No data.</p>
          )}
        </div>
      </div>
    </CompanyProvider>
  )
}
