"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import api from "@/lib/api"
import { isOffsetPagedPayload } from "@/lib/pagination"
import { formatBankRegisterLabel } from "@/lib/bankAccountDisplay"
import { useToast } from "@/components/Toast"
import { formatNumber } from "@/utils/currency"
import { formatDateOnly } from "@/utils/date"
import { HandCoins, Loader2, CheckCircle2 } from "lucide-react"

const inputClassName =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
const selectClassName =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

type CustomerRow = { id: number; display_name: string }

type BankLine = {
  id: number
  account_name: string
  bank_name?: string
  chart_account_code?: string | null
  chart_account_id?: number | null
  is_active?: boolean
  is_equity_register?: boolean
  current_balance?: string | number | null
}

type OutstandingInvoice = {
  id: number
  invoice_number: string
  invoice_date: string
  balance_due: string | number
  synthetic?: boolean
  on_account?: boolean
  customer_id: number
}

type PaymentRow = {
  id: number
  payment_number?: string
  payment_date: string
  payment_method?: string
  amount: number | string
  customer_id: number
  reference_number?: string | null
  reference?: string | null
  memo?: string | null
  deposit_status?: string
}

function roundTwo(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function formatAxiosDetail(error: unknown): string {
  const err = error as { response?: { data?: Record<string, unknown> } }
  const data = err.response?.data
  if (!data) return error instanceof Error ? error.message : "Request failed."
  const d = data.detail
  if (typeof d === "string") return d
  if (Array.isArray(d)) return d.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")
  if (d && typeof d === "object") return JSON.stringify(d)
  if (typeof data.error === "string") return data.error
  return "Request failed."
}

function makeIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* fallback below */
  }
  return `rcv-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function allocInvoiceId(inv: OutstandingInvoice) {
  return inv.synthetic ? 0 : inv.id
}

function normalizePayments(data: unknown): PaymentRow[] {
  if (isOffsetPagedPayload(data)) {
    return (data.results as PaymentRow[]) ?? []
  }
  if (Array.isArray(data)) return data as PaymentRow[]
  return []
}

export type CashierDueCollectionProps = {
  customers: CustomerRow[]
  currencySymbol: string
  /** Active bank / cash registers used as the deposit target. */
  bankAccounts: BankLine[]
  onRecorded?: () => void | Promise<void>
}

/**
 * Collect customer A/R: Dr Bank/Cash (or undeposited), Cr Accounts Receivable.
 * Lightweight POS form modeled on Pay bills — reuses parent customers/banks,
 * links cash to the open shift drawer, and lists recent receipts for confirmation.
 */
export function CashierDueCollection({
  customers,
  currencySymbol,
  bankAccounts,
  onRecorded,
}: CashierDueCollectionProps) {
  const toast = useToast()
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [outstanding, setOutstanding] = useState<OutstandingInvoice[]>([])
  const [allocations, setAllocations] = useState<Record<number, number>>({})
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split("T")[0])
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [reference, setReference] = useState("")
  const [memo, setMemo] = useState("")
  const [bankId, setBankId] = useState<number | "">("")
  const [cashEntry, setCashEntry] = useState("")
  const [loadingInvoices, setLoadingInvoices] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [lastRecorded, setLastRecorded] = useState<PaymentRow | null>(null)

  const depositBanks = bankAccounts.filter(
    b => b.is_active !== false && b.is_equity_register !== true
  )

  // Resolve the open shift once so cash receipts add to the drawer without tracking shift state.
  const [autoShiftId, setAutoShiftId] = useState<number | null>(null)
  const [linkToShift, setLinkToShift] = useState(true)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await api.get("/shifts/sessions/active/")
        const d = r.data
        if (!cancelled && d && typeof d.id !== "undefined" && d.id !== null) {
          setAutoShiftId(Number(d.id))
        }
      } catch {
        /* no open shift — receipt still records without drawer tracking */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadList = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await api.get("/payments/received/", {
        params: { paged: 1, skip: 0, limit: 30 },
      })
      setPayments(normalizePayments(res.data))
    } catch {
      setPayments([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (!customerId) {
      setOutstanding([])
      setAllocations({})
      setMemo("")
      setReference("")
      setCashEntry("")
      return
    }
    setCashEntry("")
    const c = customers.find(x => x.id === customerId)
    if (c) setMemo(`POS collection — ${c.display_name}`)
    setLoadingInvoices(true)
    api
      .get("/payments/received/outstanding/", { params: { customer_id: customerId } })
      .then(res => {
        const rows = Array.isArray(res.data) ? (res.data as OutstandingInvoice[]) : []
        setOutstanding(rows)
        const next: Record<number, number> = {}
        for (const inv of rows) next[allocInvoiceId(inv)] = 0
        setAllocations(next)
      })
      .catch(() => {
        setOutstanding([])
        setAllocations({})
        toast.error("Could not load open invoices for this customer.")
      })
      .finally(() => setLoadingInvoices(false))
  }, [customerId, customers, toast])

  const totalAllocated = roundTwo(
    Object.values(allocations).reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0)
  )

  const rowKey = (inv: OutstandingInvoice) =>
    inv.synthetic ? `oa-c-${inv.customer_id}` : String(inv.id)

  const setAlloc = (invIdKey: number, raw: number) => {
    const row = outstanding.find(
      inv => (inv.synthetic && invIdKey === 0) || (!inv.synthetic && inv.id === invIdKey)
    )
    if (!row) return
    const maxAmt = Number(row.balance_due) || 0
    const v = roundTwo(Math.min(Math.max(0, raw), maxAmt))
    setAllocations(prev => ({ ...prev, [invIdKey]: v }))
  }

  const totalOutstanding = roundTwo(
    outstanding.reduce((s, inv) => s + (Number(inv.balance_due) || 0), 0)
  )

  /** Distribute a cash amount across open invoices oldest-first (on-account line last). */
  const applyFifo = (target: number) => {
    let left = roundTwo(Math.max(0, target))
    const sorted = [...outstanding].sort((a, b) => {
      if (a.synthetic && !b.synthetic) return 1
      if (!a.synthetic && b.synthetic) return -1
      return new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime()
    })
    const next: Record<number, number> = { ...allocations }
    for (const k of Object.keys(next)) next[Number(k)] = 0
    for (const inv of sorted) {
      if (left <= 0) break
      const bal = Number(inv.balance_due) || 0
      const take = roundTwo(Math.min(left, bal))
      next[allocInvoiceId(inv)] = take
      left = roundTwo(left - take)
    }
    setAllocations(next)
  }

  const applyCashEntry = () => {
    const amt = roundTwo(parseFloat(cashEntry) || 0)
    if (amt <= 0) {
      toast.error("Enter a cash amount to auto-fill.")
      return
    }
    applyFifo(amt)
    if (amt > totalOutstanding + 0.005) {
      toast.error(
        `Cash entered (${currencySymbol}${formatNumber(amt)}) exceeds open dues (${currencySymbol}${formatNumber(totalOutstanding)}). Filled up to the open balance.`
      )
    }
  }

  const customerName = (cid: number) => {
    const c = customers.find(x => x.id === cid)
    return c?.display_name?.trim() || `Customer #${cid}`
  }

  const resetForm = () => {
    setCustomerId(null)
    setOutstanding([])
    setAllocations({})
    setReference("")
    setMemo("")
    setBankId("")
    setCashEntry("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerId) {
      toast.error("Select a customer.")
      return
    }
    if (totalAllocated <= 0) {
      toast.error("Enter an amount to collect (allocate to at least one line).")
      return
    }
    const valid = Object.entries(allocations)
      .map(([k, amt]) => ({ invoice_id: Number(k), allocated_amount: amt }))
      .filter(a => a.allocated_amount > 0)
    if (valid.length === 0) {
      toast.error("Allocate to at least one invoice or on-account line.")
      return
    }

    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        customer_id: customerId,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        amount: totalAllocated,
        reference_number: reference.trim() || null,
        memo: memo.trim() || null,
        allocations: valid,
      }
      if (bankId !== "" && typeof bankId === "number") {
        payload.bank_account_id = bankId
      }
      if (linkToShift && autoShiftId != null) {
        payload.shift_session_id = autoShiftId
      }
      const res = await api.post("/payments/received/", payload, {
        headers: { "Idempotency-Key": makeIdempotencyKey() },
      })
      toast.success("Payment recorded: A/R reduced and bank/cash debited per GL rules.")
      const saved = res.data as PaymentRow | undefined
      if (saved?.id) setLastRecorded(saved)
      resetForm()
      await loadList()
      try {
        await onRecorded?.()
      } catch {
        /* parent refresh is best-effort */
      }
    } catch (err) {
      toast.error(formatAxiosDetail(err))
    } finally {
      setSubmitting(false)
    }
  }

  const lastRecordedName =
    lastRecorded?.customer_id != null ? customerName(lastRecorded.customer_id) : null

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
        <div className="mb-6 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <HandCoins className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Collect dues (A/R)</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Collect customer balances into a <strong>bank or cash</strong> register. The system posts:{" "}
                <span className="whitespace-nowrap">Debit bank/cash, Credit A/R</span> — same as{" "}
                <Link
                  href="/payments/received/new"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Payments → Receive payment
                </Link>
                .
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={e => void handleSubmit(e)} className="space-y-5" autoComplete="off">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="pos-collect-customer">
                Customer <span className="text-destructive">*</span>
              </label>
              <select
                id="pos-collect-customer"
                value={customerId ?? ""}
                onChange={e => setCustomerId(e.target.value ? Number(e.target.value) : null)}
                className={selectClassName}
                required
              >
                <option value="">Select customer</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="pos-collect-date">
                Payment date
              </label>
              <input
                id="pos-collect-date"
                type="date"
                value={paymentDate}
                onChange={e => setPaymentDate(e.target.value)}
                className={inputClassName}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pos-collect-bank">
              Deposit to (bank or cash)
            </label>
            <select
              id="pos-collect-bank"
              value={bankId === "" ? "" : String(bankId)}
              onChange={e => setBankId(e.target.value === "" ? "" : Number(e.target.value))}
              className={selectClassName}
            >
              <option value="">Default — undeposited / cash (GL 1010 / 1020)</option>
              {depositBanks.map(b => (
                <option key={b.id} value={b.id}>
                  {formatBankRegisterLabel(b)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="pos-collect-method">
                Method
              </label>
              <select
                id="pos-collect-method"
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
                className={selectClassName}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="mobile_banking">Mobile banking</option>
                <option value="check">Check</option>
                <option value="card">Card</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="pos-collect-ref">
                Reference (optional)
              </label>
              <input
                id="pos-collect-ref"
                type="text"
                value={reference}
                onChange={e => setReference(e.target.value)}
                className={inputClassName}
                placeholder="Txn #, ref…"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pos-collect-memo">
              Memo (optional)
            </label>
            <textarea
              id="pos-collect-memo"
              rows={2}
              value={memo}
              onChange={e => setMemo(e.target.value)}
              className={inputClassName}
            />
          </div>

          {customerId && outstanding.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <label className="text-sm font-medium text-foreground" htmlFor="pos-collect-cash">
                Cash entry — auto-fill dues (FIFO)
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {currencySymbol}
                  </span>
                  <input
                    id="pos-collect-cash"
                    type="number"
                    min={0}
                    step="0.01"
                    value={cashEntry}
                    onChange={e => setCashEntry(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        applyCashEntry()
                      }
                    }}
                    className={`${inputClassName} pl-7 tabular-nums`}
                    placeholder="Enter amount received"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => applyCashEntry()}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-primary/90 px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary"
                >
                  Auto-fill FIFO
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Distributes the amount across oldest invoices first, then on-account A/R. Open dues:{" "}
                {currencySymbol}
                {formatNumber(totalOutstanding)}.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium text-foreground">Open invoices &amp; A/R</label>
              {customerId && outstanding.length > 0 ? (
                <button
                  type="button"
                  onClick={() => applyFifo(totalOutstanding)}
                  className="text-sm font-medium text-primary underline underline-offset-2"
                >
                  Collect all (oldest first)
                </button>
              ) : null}
            </div>
            {loadingInvoices ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading open amounts…
              </div>
            ) : !customerId ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
                Choose a customer to see unpaid invoices and on-account A/R.
              </p>
            ) : outstanding.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
                No open amount for this customer.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Invoice / line</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2 text-right">Balance due</th>
                      <th className="px-3 py-2 text-right">Collect now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.map(inv => {
                      const aid = allocInvoiceId(inv)
                      return (
                        <tr key={rowKey(inv)} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2 font-medium">
                            {inv.invoice_number}
                            {inv.synthetic ? (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                (A/R not on an invoice)
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{inv.invoice_date}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {currencySymbol}
                            {formatNumber(Number(inv.balance_due) || 0)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={allocations[aid] ?? 0}
                              onChange={e => setAlloc(aid, parseFloat(e.target.value) || 0)}
                              className={`${inputClassName} max-w-[7rem] text-right tabular-nums`}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {autoShiftId != null ? (
            <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <input
                type="checkbox"
                checked={linkToShift}
                onChange={e => setLinkToShift(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-foreground">Link to open shift #{autoShiftId}</span>
                <span className="ml-1 text-muted-foreground">
                  When method is <strong>cash</strong>, adds to the shift&apos;s expected drawer.
                </span>
              </span>
            </label>
          ) : null}

          <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total to collect</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {currencySymbol}
                {formatNumber(totalAllocated)}
              </p>
            </div>
            <button
              type="submit"
              disabled={submitting || totalAllocated <= 0 || !customerId}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Record payment
            </button>
          </div>
        </form>
      </section>

      {lastRecorded ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-semibold">Payment recorded successfully</p>
            <p className="mt-0.5 text-sm">
              {currencySymbol}
              {formatNumber(Number(lastRecorded.amount) || 0)}
              {lastRecordedName ? ` from ${lastRecordedName}` : ""} — listed below. A/R, customer
              ledger, and journal entry updated.
            </p>
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">Payments received</h3>
            <p className="text-xs text-muted-foreground">
              Recent receipts — same register as{" "}
              <Link href="/payments/received" className="font-medium text-primary underline underline-offset-2">
                Payments → Received
              </Link>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadList()}
            disabled={listLoading}
            className="text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
          >
            Refresh list
          </button>
        </div>

        {listLoading && payments.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading payments…
          </div>
        ) : payments.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground sm:px-5">
            No payments recorded yet. Record one above — it will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/40 text-left text-xs font-medium uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Payment #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Memo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {payments.map(payment => {
                  const isNew = lastRecorded?.id === payment.id
                  return (
                    <tr
                      key={payment.id}
                      className={
                        isNew
                          ? "bg-emerald-50/90 ring-1 ring-inset ring-emerald-300/80 dark:bg-emerald-950/30 dark:ring-emerald-800"
                          : "hover:bg-muted/30"
                      }
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {payment.payment_number ?? `PAY-${payment.id}`}
                        {isNew ? (
                          <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            Just recorded
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDateOnly(payment.payment_date)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {customerName(payment.customer_id)}
                      </td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">
                        {(payment.payment_method ?? "unspecified").replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {payment.reference_number ?? payment.reference ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            payment.deposit_status === "deposited"
                              ? "bg-success/15 text-success"
                              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200"
                          }`}
                        >
                          {payment.deposit_status === "deposited" ? "Deposited" : "Undeposited"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                        {currencySymbol}
                        {formatNumber(Number(payment.amount) || 0)}
                      </td>
                      <td
                        className="max-w-[12rem] truncate px-4 py-3 text-muted-foreground"
                        title={payment.memo || ""}
                      >
                        {payment.memo || "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
