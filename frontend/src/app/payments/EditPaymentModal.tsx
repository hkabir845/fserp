'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { AMOUNT_SLATE_EDITABLE_CLASS } from '@/utils/amountFieldStyles'
import { BankRegisterBalances, ContactArApBalances } from '@/components/ContactArApBalances'
import { formatBankAccountTitle, normalizeBankAccountsFromApi, type BankAccountLike } from '@/lib/bankAccountDisplay'
import { getCurrencySymbol, formatAmountPlain, roundToDecimals } from '@/utils/currency'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { formatDateOnly, formatDate } from '@/utils/date'
import { AMOUNT_ALLOCATE_BLUE_CLASS, AMOUNT_ALLOCATE_GREEN_CLASS } from '@/utils/amountFieldStyles'
import { DocumentExportButtons } from '@/components/DocumentExportButtons'
import {
  buildPaymentDetailCsv,
  buildPaymentPrintHtml,
  downloadCsvFile,
  downloadJsonFile,
  paymentDisplayNumber,
  printHtmlDocument,
  type PaymentExport,
} from '@/utils/businessDocumentExport'
import { loadPrintBranding } from '@/utils/printBranding'

type BankAccount = BankAccountLike & {
  account_name: string
  current_balance: number | string | null
}

type ContactSnapshot = {
  kind: 'customer' | 'vendor'
  opening_balance: string
  opening_balance_date?: string | null
  current_balance: string
}

interface AllocationRow {
  invoice_id?: number | null
  bill_id?: number | null
  allocated_amount?: number | string
  amount?: number | string
}

/** Decimal string for allocation JSON (matches backend examples; avoids float drift). */
function normalizeMoneyString(v: unknown): string {
  if (v === null || v === undefined || v === '') return '0.00'
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  if (!Number.isFinite(n)) return '0.00'
  return formatAmountPlain(n)
}

function parseMoneyNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Sum allocation rows using amount or allocated_amount (same as API). */
function sumAllocationRows(rows: unknown[]): number {
  let s = 0
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    s += parseMoneyNumber(o.amount ?? o.allocated_amount)
  }
  return s
}

function normalizeAllocRowsForApi(rows: unknown[]): Record<string, unknown>[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') {
      throw new Error('Each allocation must be an object.')
    }
    const o = { ...(row as Record<string, unknown>) }
    o.amount = normalizeMoneyString(o.amount ?? o.allocated_amount)
    delete o.allocated_amount
    return o
  })
}

function formatApiErrorDetail(data: unknown): string {
  if (data == null) return 'Update failed.'
  if (typeof data === 'string') return data
  const d = data as Record<string, unknown>
  if (typeof d.detail === 'string') return d.detail
  if (Array.isArray(d.detail)) {
    return d.detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg?: unknown }).msg ?? '')
        }
        return JSON.stringify(item)
      })
      .filter(Boolean)
      .join(' ')
  }
  if (typeof d.detail === 'object' && d.detail !== null) {
    return JSON.stringify(d.detail)
  }
  return 'Update failed.'
}

interface OutstandingInvoice {
  id: number
  invoice_number: string
  invoice_date: string
  due_date: string | null
  customer_id: number
  customer_name: string
  total_amount?: number | string
  total?: number | string
  amount_paid?: number | string
  balance_due: number | string
  days_overdue: number | null
  synthetic?: boolean
  on_account?: boolean
}

interface OutstandingBill {
  id: number
  bill_number: string
  bill_date: string
  due_date: string | null
  vendor_id: number
  vendor_name: string
  total?: number | string
  total_amount?: number | string
  amount_paid?: number | string
  balance_due: number | string
  days_overdue: number | null
  status?: string
  synthetic?: boolean
  on_account?: boolean
}

function allocInvoiceId(inv: OutstandingInvoice) {
  return inv.synthetic ? 0 : inv.id
}

function allocBillId(bill: OutstandingBill) {
  return bill.synthetic ? 0 : bill.id
}

function mergeOutstandingForCustomer(
  apiRows: OutstandingInvoice[] | null | undefined,
  customerId: number
): OutstandingInvoice[] {
  const rows = Array.isArray(apiRows) ? [...apiRows] : []
  const hasOa = rows.some((r) => r.synthetic && r.on_account)
  if (!hasOa) {
    rows.push({
      id: 0,
      synthetic: true,
      on_account: true,
      invoice_number: 'On-account & customer advance (prepayment)',
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: null,
      customer_id: customerId,
      customer_name: '',
      balance_due: 0,
      days_overdue: null,
    })
  }
  return rows
}

function mergeOutstandingForVendor(
  apiRows: OutstandingBill[] | null | undefined,
  vendorId: number
): OutstandingBill[] {
  const rows = Array.isArray(apiRows) ? [...apiRows] : []
  const hasOa = rows.some((r) => r.synthetic && r.on_account)
  if (!hasOa) {
    rows.push({
      id: 0,
      synthetic: true,
      on_account: true,
      bill_number: 'On-account & vendor advance (prepayment)',
      bill_date: new Date().toISOString().split('T')[0],
      due_date: null,
      vendor_id: vendorId,
      vendor_name: '',
      total_amount: 0,
      amount_paid: 0,
      balance_due: 0,
      days_overdue: null,
    })
  }
  return rows
}

function recvRowKey(inv: OutstandingInvoice) {
  if (inv.synthetic && inv.on_account) return 'oa'
  return `inv-${inv.id}`
}

function madeRowKey(b: OutstandingBill) {
  if (b.synthetic && b.on_account) return 'oa'
  return `bill-${b.id}`
}

function isRecvOnAccount(inv: OutstandingInvoice) {
  return Boolean(inv.synthetic && inv.on_account)
}

function isMadeOnAccount(b: OutstandingBill) {
  return Boolean(b.synthetic && b.on_account)
}

function isDraftBillRow(b: OutstandingBill) {
  if (b.synthetic) return false
  return (b.status || '').toLowerCase() === 'draft'
}

function roundTwo(n: number): number {
  return roundToDecimals(n, 2)
}

export interface PaymentDetailPayload {
  id: number
  payment_number?: string
  payment_type: string
  payment_date: string
  payment_method: string
  amount: string | number
  reference_number?: string | null
  reference?: string | null
  memo?: string | null
  bank_account_id?: number | null
  bank_account_name?: string | null
  customer_id?: number | null
  vendor_id?: number | null
  customer_name?: string | null
  vendor_name?: string | null
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
  const [receivedLines, setReceivedLines] = useState<OutstandingInvoice[]>([])
  const [receivedAlloc, setReceivedAlloc] = useState<Record<string, number>>({})
  const [receivedLinesLoading, setReceivedLinesLoading] = useState(false)
  const [madeLines, setMadeLines] = useState<OutstandingBill[]>([])
  const [madeAlloc, setMadeAlloc] = useState<Record<string, number>>({})
  const [madeLinesLoading, setMadeLinesLoading] = useState(false)
  const [contactSnapshot, setContactSnapshot] = useState<ContactSnapshot | null>(null)
  const [contactDisplayName, setContactDisplayName] = useState('')
  const [currencySymbol, setCurrencySymbol] = useState('৳')

  const receivedAllocatedTotal = useMemo(() => {
    return roundTwo(
      receivedLines.reduce((s, inv) => s + (receivedAlloc[recvRowKey(inv)] ?? 0), 0)
    )
  }, [receivedLines, receivedAlloc])

  const madeAllocatedTotal = useMemo(() => {
    return roundTwo(madeLines.reduce((s, b) => s + (madeAlloc[madeRowKey(b)] ?? 0), 0))
  }, [madeLines, madeAlloc])

  const paymentAmountNum = useMemo(() => parseMoneyNumber(amount), [amount])

  useEffect(() => {
    if (!open || !paymentId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setContactSnapshot(null)
      setContactDisplayName('')
      setReceivedLines([])
      setReceivedAlloc({})
      setMadeLines([])
      setMadeAlloc({})
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
        setBanks(normalizeBankAccountsFromApi(bankRes.data) as BankAccount[])
        const p = payRes.data
        setDetail(p)
        setPaymentDate((p.payment_date || '').split('T')[0])
        setPaymentMethod((p.payment_method || 'unspecified').toLowerCase())
        setReference(String(p.reference_number ?? p.reference ?? ''))
        setMemo(String(p.memo ?? ''))
        setAmount(String(p.amount ?? ''))
        setBankAccountId(p.bank_account_id != null ? String(p.bank_account_id) : '')

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
            setContactDisplayName(
              String(c.display_name ?? c.customer_name ?? c.company_name ?? `Customer #${p.customer_id}`),
            )
          } catch {
            if (!cancelled) setContactSnapshot(null)
          }
          setReceivedLinesLoading(true)
          try {
            const outRes = await api.get<OutstandingInvoice[]>('/payments/received/outstanding/', {
              params: { customer_id: p.customer_id, exclude_payment_id: paymentId },
            })
            if (cancelled) return
            const merged = mergeOutstandingForCustomer(outRes.data, p.customer_id)
            setReceivedLines(merged)
            const payAllocs = (p.allocations ?? []) as AllocationRow[]
            const nextAlloc: Record<string, number> = {}
            for (const inv of merged) {
              const key = recvRowKey(inv)
              const aid = allocInvoiceId(inv)
              const fromPay = payAllocs.find((x) => Number(x.invoice_id ?? -1) === aid)
              nextAlloc[key] = fromPay
                ? parseMoneyNumber(fromPay.allocated_amount ?? fromPay.amount)
                : 0
            }
            setReceivedAlloc(nextAlloc)
          } catch {
            if (!cancelled) {
              setReceivedLines([])
              setReceivedAlloc({})
            }
          } finally {
            if (!cancelled) setReceivedLinesLoading(false)
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
            setContactDisplayName(
              String(
                v.display_name ?? v.vendor_name ?? v.company_name ?? `Vendor #${p.vendor_id}`,
              ),
            )
          } catch {
            if (!cancelled) setContactSnapshot(null)
          }
          setMadeLinesLoading(true)
          try {
            const outRes = await api.get<OutstandingBill[]>('/payments/made/outstanding/', {
              params: { vendor_id: p.vendor_id, exclude_payment_id: paymentId },
            })
            if (cancelled) return
            const merged = mergeOutstandingForVendor(outRes.data, p.vendor_id)
            setMadeLines(merged)
            const payAllocs = (p.allocations ?? []) as AllocationRow[]
            const nextAlloc: Record<string, number> = {}
            for (const bill of merged) {
              const key = madeRowKey(bill)
              const bid = allocBillId(bill)
              const fromPay = payAllocs.find((x) => Number(x.bill_id ?? -1) === bid)
              nextAlloc[key] = fromPay
                ? parseMoneyNumber(fromPay.allocated_amount ?? fromPay.amount)
                : 0
            }
            setMadeAlloc(nextAlloc)
          } catch {
            if (!cancelled) {
              setMadeLines([])
              setMadeAlloc({})
            }
          } finally {
            if (!cancelled) setMadeLinesLoading(false)
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

  const updateRecvAlloc = (inv: OutstandingInvoice, raw: number) => {
    const key = recvRowKey(inv)
    const maxBd = Number(inv.balance_due) || 0
    const payCap = paymentAmountNum > 0 ? paymentAmountNum : 1e12
    const cap = isRecvOnAccount(inv) ? Math.max(maxBd, payCap) : maxBd
    const v = roundTwo(Math.min(Math.max(0, raw), cap))
    setReceivedAlloc((prev) => ({ ...prev, [key]: v }))
  }

  const updateMadeAlloc = (bill: OutstandingBill, raw: number) => {
    const key = madeRowKey(bill)
    const maxBd = isDraftBillRow(bill) ? 0 : Number(bill.balance_due) || 0
    const payCap = paymentAmountNum > 0 ? paymentAmountNum : 1e12
    const cap = isMadeOnAccount(bill) ? Math.max(maxBd, payCap) : maxBd
    const v = roundTwo(Math.min(Math.max(0, raw), cap))
    setMadeAlloc((prev) => ({ ...prev, [key]: v }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!paymentId || !detail) return
    setSaving(true)
    setError('')
    const numAmount = parseMoneyNumber(amount)
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError('Enter a positive amount.')
      setSaving(false)
      return
    }

    let parsed: Record<string, unknown>[] = []
    if (detail.payment_type === 'received') {
      if (!receivedLinesLoading && receivedLines.length === 0) {
        setError('Invoice allocation lines could not be loaded. Close and try again.')
        setSaving(false)
        return
      }
      for (const inv of receivedLines) {
        const key = recvRowKey(inv)
        const raw = receivedAlloc[key] ?? 0
        const amt = roundTwo(Math.max(0, Number.isFinite(raw) ? raw : 0))
        if (amt <= 0) continue
        const aid = allocInvoiceId(inv)
        if (aid === 0 && isRecvOnAccount(inv)) {
          parsed.push({ invoice_id: 0, amount: normalizeMoneyString(amt), on_account: true })
        } else {
          parsed.push({ invoice_id: aid, amount: normalizeMoneyString(amt) })
        }
      }
    } else {
      if (!madeLinesLoading && madeLines.length === 0) {
        setError('Bill allocation lines could not be loaded. Close and try again.')
        setSaving(false)
        return
      }
      for (const bill of madeLines) {
        const key = madeRowKey(bill)
        const raw = madeAlloc[key] ?? 0
        const amt = roundTwo(Math.max(0, Number.isFinite(raw) ? raw : 0))
        if (amt <= 0) continue
        const bid = allocBillId(bill)
        if (bid === 0 && isMadeOnAccount(bill)) {
          parsed.push({ bill_id: 0, amount: normalizeMoneyString(amt), on_account: true })
        } else {
          parsed.push({ bill_id: bid, amount: normalizeMoneyString(amt) })
        }
      }
    }

    let normalizedAllocRows: Record<string, unknown>[]
    try {
      normalizedAllocRows = normalizeAllocRowsForApi(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid allocation rows.')
      setSaving(false)
      return
    }
    const allocSum = sumAllocationRows(normalizedAllocRows)
    if (Math.round(allocSum * 100) !== Math.round(numAmount * 100)) {
      setError(
        `Allocations must sum to the payment amount (${normalizeMoneyString(numAmount)}); they currently sum to ${normalizeMoneyString(allocSum)}.`
      )
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
        body.invoice_allocations = normalizedAllocRows
      } else {
        body.bill_allocations = normalizedAllocRows
      }
      const res = await api.put(`/payments/${paymentId}/`, body)
      const note =
        (res.data as { rollback_note?: string })?.rollback_note ||
        'Payment updated; general ledger was reversed and reposted.'
      onSaved(note)
      onClose()
    } catch (err: unknown) {
      const ax = err as { response?: { data?: unknown } }
      setError(formatApiErrorDetail(ax.response?.data))
    } finally {
      setSaving(false)
    }
  }

  const paymentExportPayload = (): PaymentExport | null => {
    if (!detail) return null
    const isReceived = detail.payment_type === 'received'
    const bankName =
      detail.bank_account_name ||
      banks.find((b) => b.id === detail.bank_account_id)?.account_name ||
      ''
    return {
      ...detail,
      payment_number: detail.payment_number || paymentDisplayNumber(detail),
      customer_name: isReceived ? contactDisplayName || detail.customer_name || '' : undefined,
      vendor_name: !isReceived ? contactDisplayName || detail.vendor_name || '' : undefined,
      bank_account_name: bankName,
      allocations: (detail.allocations ?? []).map((a) => ({
        ...a,
        invoice_number: receivedLines.find((inv) => allocInvoiceId(inv) === Number(a.invoice_id))
          ?.invoice_number,
        bill_number: madeLines.find((bill) => allocBillId(bill) === Number(a.bill_id))?.bill_number,
      })),
    }
  }

  const handlePrintPayment = async () => {
    const payload = paymentExportPayload()
    if (!payload) return
    const isReceived = payload.payment_type === 'received'
    const allocRows = (payload.allocations ?? []).map((a) => {
      const amt = parseMoneyNumber(a.amount ?? a.allocated_amount)
      if (isReceived) {
        const ref =
          a.invoice_number ||
          (a.invoice_id ? `INV-${a.invoice_id}` : 'On account')
        return { label: 'Invoice', reference: ref, amount: amt }
      }
      const ref = a.bill_number || (a.bill_id ? `BILL-${a.bill_id}` : 'On account')
      return { label: 'Bill', reference: ref, amount: amt }
    })
    const branding = await loadPrintBranding(api)
    const bodyHtml = buildPaymentPrintHtml(payload, {
      currencySymbol,
      formatDateOnly,
      formatDateTime: (d) => formatDate(d, true),
      formatNumber: (n) =>
        n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      resolveAllocRows: allocRows,
    })
    const title = isReceived ? 'Money receipt' : 'Payment voucher'
    const ok = await printHtmlDocument(`${title} ${paymentDisplayNumber(payload)}`, bodyHtml, branding)
    if (!ok) window.alert('Allow pop-ups to print this payment.')
  }

  const handleDownloadPaymentCsv = () => {
    const payload = paymentExportPayload()
    if (!payload) return
    downloadCsvFile(
      `payment_${paymentDisplayNumber(payload)}.csv`,
      buildPaymentDetailCsv(payload),
    )
  }

  const handleDownloadPaymentJson = () => {
    const payload = paymentExportPayload()
    if (!payload) return
    downloadJsonFile(`payment_${paymentDisplayNumber(payload)}.json`, payload)
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
      <div className="relative max-h-[96vh] w-full max-w-[1440px] overflow-y-auto rounded-xl border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">Edit payment</h2>
          <div className="flex items-center gap-2">
            {!loading && detail ? (
              <DocumentExportButtons
                size="compact"
                onPrint={() => void handlePrintPayment()}
                onDownloadCsv={handleDownloadPaymentCsv}
                onDownloadJson={handleDownloadPaymentJson}
                printLabel={detail.payment_type === 'received' ? 'Print receipt' : 'Print voucher'}
              />
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
              aria-label="Cancel"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <p className="text-sm text-muted-foreground">
            Saves run in one database transaction: the old <code className="rounded bg-muted px-1 text-xs">AUTO-PAY</code>{' '}
            journal is removed, customer or vendor subledgers are restored, then the payment is updated and
            re-posted. If anything fails, nothing is committed.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {contactSnapshot && !loading && (
            <>
              <ContactArApBalances
                role={contactSnapshot.kind}
                openingBalance={contactSnapshot.opening_balance}
                openingBalanceDate={contactSnapshot.opening_balance_date}
                currentBalance={contactSnapshot.current_balance}
                currencySymbol={currencySymbol}
              />
              {contactSnapshot.kind === 'customer' && parseMoneyNumber(contactSnapshot.current_balance) < 0 ? (
                <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                  This customer has a credit balance (A/R is negative). Each line cannot exceed that invoice&apos;s
                  unpaid balance—reduce an allocation or the payment total if needed.
                </p>
              ) : null}
            </>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/70" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Date</label>
                  <CompanyDateInput value={paymentDate} onChange={setPaymentDate} className="w-full rounded-lg border border-border px-3 py-2 text-sm" required={true} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Amount</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onBlur={() => {
                      const n = parseMoneyNumber(amount)
                      if (String(amount).trim() === '') return
                      if (Number.isFinite(n)) setAmount(formatAmountPlain(n))
                    }}
                    className={AMOUNT_SLATE_EDITABLE_CLASS}
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Bank register (optional)</label>
                  <select
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <option value="">None (clearing / undeposited)</option>
                    {banks.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {formatBankAccountTitle(b)}
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
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Reference</label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Memo</label>
                  <textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">
                    {detail?.payment_type === 'received' ? 'Apply to invoices' : 'Apply to bills'}
                  </label>
                  {detail?.payment_type === 'received' ? (
                    receivedLinesLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground/70" />
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="min-w-full divide-y divide-border text-sm">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                                Invoice
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                                Date
                              </th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                                Balance due
                              </th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                                Allocate
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/70 bg-white">
                            {receivedLines.map((inv) => {
                              const key = recvRowKey(inv)
                              const allocated = receivedAlloc[key] ?? 0
                              const bal = Number(inv.balance_due) || 0
                              return (
                                <tr key={key}>
                                  <td className="max-w-[14rem] px-3 py-2 font-medium text-foreground">
                                    {inv.invoice_number}
                                    {isRecvOnAccount(inv) ? (
                                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                                        (on-account / advance)
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                                    {formatDateOnly(inv.invoice_date)}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                                    {currencySymbol}
                                    {bal.toLocaleString(undefined, {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min={0}
                                      max={isRecvOnAccount(inv) ? undefined : bal}
                                      value={allocated}
                                      onChange={(e) =>
                                        updateRecvAlloc(inv, Number(e.target.value))
                                      }
                                      onBlur={() => updateRecvAlloc(inv, allocated)}
                                      className={AMOUNT_ALLOCATE_GREEN_CLASS}
                                    />
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : madeLinesLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground/70" />
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="min-w-full divide-y divide-border text-sm">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Bill</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Date</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                              Balance due
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                              Allocate
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/70 bg-white">
                          {madeLines.map((bill) => {
                            const key = madeRowKey(bill)
                            const allocated = madeAlloc[key] ?? 0
                            const bal = Number(bill.balance_due) || 0
                            const draft = isDraftBillRow(bill)
                            return (
                              <tr key={key}>
                                <td className="max-w-[14rem] px-3 py-2 font-medium text-foreground">
                                  {bill.bill_number}
                                  {draft ? (
                                    <span className="ml-1 text-xs font-normal text-warning-foreground">
                                      (Draft — approve on Bills to pay)
                                    </span>
                                  ) : null}
                                  {isMadeOnAccount(bill) ? (
                                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                                      (on-account / advance)
                                    </span>
                                  ) : null}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                                  {formatDateOnly(bill.bill_date)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                                  {currencySymbol}
                                  {bal.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    disabled={draft}
                                    title={
                                      draft
                                        ? 'Approve this bill (Open) on the Bills page before allocating payment.'
                                        : undefined
                                    }
                                    max={
                                      isMadeOnAccount(bill)
                                        ? undefined
                                        : draft
                                          ? 0
                                          : bal
                                    }
                                    value={allocated}
                                      onChange={(e) =>
                                        updateMadeAlloc(bill, Number(e.target.value))
                                      }
                                      onBlur={() => updateMadeAlloc(bill, allocated)}
                                      className={AMOUNT_ALLOCATE_BLUE_CLASS}
                                    />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Allocated total{' '}
                    <span className="font-medium tabular-nums text-foreground/85">
                      {currencySymbol}
                      {(detail?.payment_type === 'received'
                        ? receivedAllocatedTotal
                        : madeAllocatedTotal
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>{' '}
                    · must match payment amount (
                    {currencySymbol}
                    {paymentAmountNum.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    ).
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
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
