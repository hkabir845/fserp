'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { AMOUNT_SLATE_EDITABLE_CLASS } from '@/utils/amountFieldStyles'
import { BankRegisterBalances, ContactArApBalances } from '@/components/ContactArApBalances'
import { getCurrencySymbol } from '@/utils/currency'
import { AlertCircle, Loader2, X } from 'lucide-react'

interface BankAccount {
  id: number
  account_name: string
  current_balance: number | string | null
  opening_balance?: string | number | null
  opening_balance_date?: string | null
}

type ContactSnapshot = {
  kind: 'customer' | 'vendor'
  opening_balance: string
  opening_balance_date?: string | null
  current_balance: string
}

function normalizeBankAccountsFromApi(data: unknown): BankAccount[] {
  let rows: unknown[] = []
  if (Array.isArray(data)) rows = data
  else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.results)) rows = o.results
    else if (Array.isArray(o.data)) rows = o.data
  }
  return rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .map((r): BankAccount | null => {
      const id = typeof r.id === 'number' ? r.id : Number(r.id)
      if (!Number.isFinite(id)) return null
      return {
        id,
        account_name: String(r.account_name ?? ''),
        current_balance: r.current_balance as BankAccount['current_balance'],
        opening_balance: r.opening_balance as string | number | null | undefined,
        opening_balance_date: r.opening_balance_date as string | null | undefined,
      }
    })
    .filter((a): a is BankAccount => a != null)
}

interface AllocationRow {
  invoice_id?: number | null
  bill_id?: number | null
  allocated_amount?: number
  amount?: number | string
}

export interface PaymentDetailPayload {
  id: number
  payment_type: string
  payment_date: string
  payment_method: string
  amount: string | number
  reference_number?: string | null
  reference?: string | null
  memo?: string | null
  bank_account_id?: number | null
  customer_id?: number | null
  vendor_id?: number | null
  allocations?: AllocationRow[]
}

type Props = {
  open: boolean
  paymentId: number | null
  onClose: () => void
  onSaved: (note?: string) => void
}

const METHODS = [
  'cash',
  'check',
  'ach',
  'card',
  'credit_card',
  'bank',
  'transfer',
  'wire',
  'unspecified',
]

export default function EditPaymentModal({ open, paymentId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<PaymentDetailPayload | null>(null)
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [memo, setMemo] = useState('')
  const [amount, setAmount] = useState('')
  const [bankAccountId, setBankAccountId] = useState<string>('')
  const [allocationsJson, setAllocationsJson] = useState('[]')
  const [contactSnapshot, setContactSnapshot] = useState<ContactSnapshot | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState('৳')

  useEffect(() => {
    if (!open || !paymentId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setContactSnapshot(null)
      try {
        const [payRes, bankRes, companyRes] = await Promise.all([
          api.get<PaymentDetailPayload>(`/payments/${paymentId}/`),
          api.get('/bank-accounts/'),
          api.get('/companies/current').catch(() => ({ data: null })),
        ])
        if (cancelled) return
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
        setBanks(normalizeBankAccountsFromApi(bankRes.data))
        const p = payRes.data
        setDetail(p)
        setPaymentDate((p.payment_date || '').split('T')[0])
        setPaymentMethod((p.payment_method || 'unspecified').toLowerCase())
        setReference(String(p.reference_number ?? p.reference ?? ''))
        setMemo(String(p.memo ?? ''))
        setAmount(String(p.amount ?? ''))
        setBankAccountId(p.bank_account_id != null ? String(p.bank_account_id) : '')
        const allocs = (p.allocations ?? []).map((a) => {
          if (p.payment_type === 'received') {
            return { invoice_id: a.invoice_id, amount: String(a.allocated_amount ?? a.amount ?? '') }
          }
          return { bill_id: a.bill_id, amount: String(a.allocated_amount ?? a.amount ?? '') }
        })
        setAllocationsJson(JSON.stringify(allocs, null, 2))

        if (p.payment_type === 'received' && p.customer_id) {
          try {
            const cr = await api.get(`/customers/${p.customer_id}/`)
            if (cancelled) return
            const c = cr.data as Record<string, string | undefined>
            setContactSnapshot({
              kind: 'customer',
              opening_balance: String(c.opening_balance ?? '0'),
              opening_balance_date: c.opening_balance_date ?? null,
              current_balance: String(c.current_balance ?? '0'),
            })
          } catch {
            if (!cancelled) setContactSnapshot(null)
          }
        } else if (p.payment_type === 'made' && p.vendor_id) {
          try {
            const vr = await api.get(`/vendors/${p.vendor_id}/`)
            if (cancelled) return
            const v = vr.data as Record<string, string | undefined>
            setContactSnapshot({
              kind: 'vendor',
              opening_balance: String(v.opening_balance ?? '0'),
              opening_balance_date: v.opening_balance_date ?? null,
              current_balance: String(v.current_balance ?? '0'),
            })
          } catch {
            if (!cancelled) setContactSnapshot(null)
          }
        } else {
          setContactSnapshot(null)
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) setError('Could not load this payment.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, paymentId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!paymentId || !detail) return
    setSaving(true)
    setError('')
    let parsed: unknown
    try {
      parsed = JSON.parse(allocationsJson || '[]')
    } catch {
      setError('Allocations must be valid JSON (array of { invoice_id, amount } or { bill_id, amount }).')
      setSaving(false)
      return
    }
    if (!Array.isArray(parsed)) {
      setError('Allocations JSON must be an array.')
      setSaving(false)
      return
    }
    const numAmount = Number(amount)
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError('Enter a positive amount.')
      setSaving(false)
      return
    }
    try {
      const body: Record<string, unknown> = {
        payment_date: paymentDate,
        payment_method: paymentMethod,
        reference_number: reference.trim(),
        memo: memo.trim(),
        amount: numAmount,
        bank_account_id: bankAccountId === '' ? null : Number(bankAccountId),
      }
      if (detail.payment_type === 'received') {
        body.invoice_allocations = parsed
      } else {
        body.bill_allocations = parsed
      }
      const res = await api.put(`/payments/${paymentId}/`, body)
      const note =
        (res.data as { rollback_note?: string })?.rollback_note ||
        'Payment updated; general ledger was reversed and reposted.'
      onSaved(note)
      onClose()
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      const msg = ax.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Update failed.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Edit payment</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Cancel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <p className="text-sm text-slate-600">
            Saves run in one database transaction: the old <code className="rounded bg-slate-100 px-1 text-xs">AUTO-PAY</code>{' '}
            journal is removed, customer or vendor subledgers are restored, then the payment is updated and
            re-posted. If anything fails, nothing is committed.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {contactSnapshot && !loading && (
            <ContactArApBalances
              role={contactSnapshot.kind}
              openingBalance={contactSnapshot.opening_balance}
              openingBalanceDate={contactSnapshot.opening_balance_date}
              currentBalance={contactSnapshot.current_balance}
              currencySymbol={currencySymbol}
            />
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Amount</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={AMOUNT_SLATE_EDITABLE_CLASS}
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Bank register (optional)</label>
                  <select
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">None (clearing / undeposited)</option>
                    {banks.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.account_name}
                      </option>
                    ))}
                  </select>
                  {bankAccountId
                    ? (() => {
                        const acc = banks.find((x) => String(x.id) === bankAccountId)
                        if (!acc) return null
                        return (
                          <BankRegisterBalances
                            openingBalance={acc.opening_balance}
                            openingBalanceDate={acc.opening_balance_date}
                            currentBalance={acc.current_balance}
                            currencySymbol={currencySymbol}
                            className="mt-2"
                          />
                        )
                      })()
                    : null}
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Reference</label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Memo</label>
                  <textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    {detail?.payment_type === 'received'
                      ? 'Invoice allocations (JSON)'
                      : 'Bill allocations (JSON)'}
                  </label>
                  <textarea
                    value={allocationsJson}
                    onChange={(e) => setAllocationsJson(e.target.value)}
                    rows={8}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                    spellCheck={false}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Example:{' '}
                    <code className="rounded bg-slate-100 px-1">
                      [{`{ "invoice_id": 1, "amount": "100.00" }`}]
                    </code>{' '}
                    or{' '}
                    <code className="rounded bg-slate-100 px-1">[{`{ "bill_id": 2, "amount": "50.00" }`}]</code>.
                    Amounts must sum to the payment amount.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save changes
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
