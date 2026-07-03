"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import api from "@/lib/api"
import { formatBankRegisterLabel } from "@/lib/bankAccountDisplay"
import { useToast } from "@/components/Toast"
import { formatNumber } from "@/utils/currency"
import { Loader2, Wallet } from "lucide-react"

const inputClassName =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
const selectClassName =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

type CustomerRow = { id: number; display_name: string }

type BankRegister = {
  id: number
  account_name: string
  bank_name?: string
  chart_account_code?: string | null
  chart_account_id?: number | null
  is_active?: boolean
}

type OutstandingInvoice = {
  id: number
  invoice_number: string
  invoice_date: string
  due_date: string | null
  customer_id: number
  customer_name: string
  balance_due: string | number
  days_overdue: number | null
  /** A/R on opening / not on an invoice; allocate with invoice_id 0 */
  synthetic?: boolean
  on_account?: boolean
}

function mergeCollectOutstanding(
  apiRows: OutstandingInvoice[],
  customerId: number
): OutstandingInvoice[] {
  const rows = [...apiRows]
  if (!rows.some(r => r.synthetic && r.on_account)) {
    rows.push({
      id: 0,
      synthetic: true,
      on_account: true,
      invoice_number: "On-account & customer advance (prepayment)",
      invoice_date: new Date().toISOString().split("T")[0],
      due_date: null,
      customer_id: customerId,
      customer_name: "",
      balance_due: 0,
      days_overdue: null,
    })
  }
  return rows
}

type ActiveShift = { id: number; expected_cash_total?: string }

function roundTwo(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function isOnAccountRow(inv: OutstandingInvoice) {
  return Boolean(inv.synthetic && inv.on_account)
}

/** Distribute `amount` across open items oldest-first; remainder becomes on-account advance. */
function distributeFifo(amount: number, rows: OutstandingInvoice[]): Record<number, number> {
  let remaining = roundTwo(Math.max(0, amount))
  const sorted = [...rows].sort((a, b) => {
    if (isOnAccountRow(a) && !isOnAccountRow(b)) return 1
    if (!isOnAccountRow(a) && isOnAccountRow(b)) return -1
    return new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime()
  })
  const next: Record<number, number> = {}
  for (const inv of rows) {
    next[inv.synthetic ? 0 : inv.id] = 0
  }
  for (const inv of sorted) {
    if (remaining <= 0) break
    const aid = inv.synthetic ? 0 : inv.id
    if (isOnAccountRow(inv)) {
      next[aid] = remaining
      remaining = 0
      break
    }
    const bal = Number(inv.balance_due) || 0
    const take = roundTwo(Math.min(remaining, bal))
    next[aid] = take
    remaining = roundTwo(remaining - take)
  }
  return next
}

function isNetworkOrTimeoutError(error: unknown): boolean {
  const err = error as { code?: string; response?: unknown }
  // No HTTP response means the request never completed (timeout, dropped connection);
  // the server may still have committed the payment.
  return err?.code === "ECONNABORTED" || !err?.response
}

function makeIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through to fallback */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const COLLECT_PAYMENT_TIMEOUT_MS = 180_000
const COLLECT_PAYMENT_VERIFY_TIMEOUT_MS = 45_000
const COLLECT_PAYMENT_POLL_MS = 2_000
const COLLECT_PAYMENT_POLL_ATTEMPTS = 6

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function postCollectPayment(
  payload: Record<string, unknown>,
  idempotencyKey: string,
  timeoutMs: number
) {
  return api.post("/payments/received/", payload, {
    timeout: timeoutMs,
    headers: { "Idempotency-Key": idempotencyKey },
  })
}

/** After a client timeout, confirm whether the server already committed this payment. */
async function verifyCollectPaymentRecorded(
  idempotencyKey: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  try {
    await postCollectPayment(payload, idempotencyKey, COLLECT_PAYMENT_VERIFY_TIMEOUT_MS)
    return true
  } catch (err) {
    if (!isNetworkOrTimeoutError(err)) throw err
  }
  for (let i = 0; i < COLLECT_PAYMENT_POLL_ATTEMPTS; i++) {
    await sleep(COLLECT_PAYMENT_POLL_MS)
    try {
      const res = await api.get<{ recorded?: boolean }>("/payments/received/idempotency-status/", {
        params: { key: idempotencyKey },
        timeout: 15_000,
      })
      if (res.data?.recorded === true) return true
    } catch {
      /* server may still be finishing the original request */
    }
  }
  return false
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

export type CashierCollectPaymentProps = {
  customers: CustomerRow[]
  currencySymbol: string
  bankRegisters: BankRegister[]
  onRecorded: () => void | Promise<void>
}

export function CashierCollectPayment({
  customers,
  currencySymbol,
  bankRegisters,
  onRecorded,
}: CashierCollectPaymentProps) {
  const toast = useToast()
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [outstanding, setOutstanding] = useState<OutstandingInvoice[]>([])
  const [paymentAmount, setPaymentAmount] = useState(0)
  const [allocations, setAllocations] = useState<Record<number, number>>({})
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split("T")[0])
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [reference, setReference] = useState("")
  const [memo, setMemo] = useState("")
  const [depositBankId, setDepositBankId] = useState<number | "">("")
  const [loadingInvoices, setLoadingInvoices] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)
  const [linkToShift, setLinkToShift] = useState(true)
  // Stable key for the current payment attempt: kept across retries so a repeat of a
  // slow-but-successful call is deduplicated server-side; reset only after a confirmed success.
  const idempotencyKeyRef = useRef<string | null>(null)

  const loadShift = useCallback(async () => {
    try {
      const r = await api.get("/shifts/sessions/active/")
      const d = r.data
      if (d && typeof d === "object" && d.id != null) {
        setActiveShift({ id: Number(d.id), expected_cash_total: String(d.expected_cash_total ?? "0") })
        setLinkToShift(true)
      } else {
        setActiveShift(null)
        setLinkToShift(false)
      }
    } catch {
      setActiveShift(null)
      setLinkToShift(false)
    }
  }, [])

  useEffect(() => {
    void loadShift()
  }, [loadShift])

  const loadOutstanding = useCallback(
    async (cid: number) => {
      setLoadingInvoices(true)
      try {
        const res = await api.get("/payments/received/outstanding/", {
          params: { customer_id: cid },
        })
        const raw = Array.isArray(res.data) ? res.data : []
        const rows = mergeCollectOutstanding(raw as OutstandingInvoice[], cid)
        setOutstanding(rows)
        const next: Record<number, number> = {}
        for (const inv of rows) {
          next[inv.synthetic ? 0 : inv.id] = 0
        }
        setAllocations(next)
      } catch {
        const rows = mergeCollectOutstanding([], cid)
        setOutstanding(rows)
        const next: Record<number, number> = {}
        for (const inv of rows) {
          next[inv.synthetic ? 0 : inv.id] = 0
        }
        setAllocations(next)
        toast.error("Could not load open invoices; you can still record on-account or advance below.")
      } finally {
        setLoadingInvoices(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    if (!customerId) {
      setOutstanding([])
      setPaymentAmount(0)
      setAllocations({})
      setMemo("")
      setReference("")
      return
    }
    const c = customers.find(x => x.id === customerId)
    if (c) {
      setMemo(`POS payment — ${c.display_name}`)
    }
    setPaymentAmount(0)
    void loadOutstanding(customerId)
  }, [customerId, customers, toast, loadOutstanding])

  // Refresh side totals (shift + parent) without touching this form's fields.
  // Guarded so a refresh failure never looks like a payment failure.
  const refreshSideTotals = useCallback(async () => {
    try {
      await loadShift()
    } catch {
      /* ignore */
    }
    try {
      await onRecorded()
    } catch {
      /* ignore */
    }
  }, [loadShift, onRecorded])

  const clearAfterSuccessfulRecord = useCallback(() => {
    idempotencyKeyRef.current = null
    setCustomerId(null)
    setOutstanding([])
    setPaymentAmount(0)
    setAllocations({})
    setReference("")
    setMemo("")
  }, [])

  const totalDue = roundTwo(
    outstanding
      .filter(i => !isOnAccountRow(i))
      .reduce((s, i) => s + (Number(i.balance_due) || 0), 0)
  )

  const rowKey = (inv: OutstandingInvoice) => (inv.synthetic ? `oa-${inv.customer_id}` : String(inv.id))

  const handlePaymentAmountChange = (raw: number) => {
    const amt = roundTwo(Math.max(0, Number.isFinite(raw) ? raw : 0))
    setPaymentAmount(amt)
    setAllocations(distributeFifo(amt, outstanding))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerId) {
      toast.error("Select a customer.")
      return
    }
    if (paymentAmount <= 0) {
      toast.error("Enter the amount received from the customer.")
      return
    }
    const valid = Object.entries(allocations)
      .map(([id, amt]) => {
        const n = Number(id)
        return { invoice_id: n, allocated_amount: amt }
      })
      .filter(a => a.allocated_amount > 0)
    if (!valid.length) {
      toast.error("Allocate to at least one invoice.")
      return
    }

    setSubmitting(true)
    // Reuse the same key on retry so a slow-but-successful call is not duplicated.
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = makeIdempotencyKey()
    }
    const idempotencyKey = idempotencyKeyRef.current
    const payload: Record<string, unknown> = {
      customer_id: customerId,
      payment_date: paymentDate,
      payment_method: paymentMethod,
      amount: paymentAmount,
      reference_number: reference.trim() || null,
      memo: memo.trim() || null,
      allocations: valid,
    }
    if (depositBankId !== "" && typeof depositBankId === "number") {
      payload.bank_account_id = depositBankId
    }
    if (linkToShift && activeShift?.id) {
      payload.shift_session_id = activeShift.id
    }

    try {
      await postCollectPayment(payload, idempotencyKey, COLLECT_PAYMENT_TIMEOUT_MS)
      toast.success("Payment recorded.")
      clearAfterSuccessfulRecord()
      await refreshSideTotals()
    } catch (err) {
      if (isNetworkOrTimeoutError(err)) {
        try {
          const recorded = await verifyCollectPaymentRecorded(idempotencyKey, payload)
          if (recorded) {
            toast.success("Payment recorded.")
            clearAfterSuccessfulRecord()
            await refreshSideTotals()
            return
          }
        } catch (verifyErr) {
          toast.error(formatAxiosDetail(verifyErr))
          return
        }
        toast.error(
          "Payment is taking longer than usual. Wait a few seconds, then click Record payment again — safe, no duplicate."
        )
        await refreshSideTotals()
      } else {
        toast.error(formatAxiosDetail(err))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
      <div className="mb-6 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Collect due (A/R)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the amount received; it is applied to open invoices oldest-first. Full profile:{" "}
              <Link href="/payments/received/new" className="font-medium text-primary underline underline-offset-2">
                Record payment
              </Link>{" "}
              (e.g. add a new customer first).
            </p>
          </div>
        </div>
        {activeShift ? (
          <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            <p className="font-medium">Open shift #{activeShift.id}</p>
            <p className="mt-0.5 text-emerald-800/90 dark:text-emerald-200/90">
              Cash collections can add to this shift&apos;s expected drawer when linked below.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            No open shift — payment still records; open a shift under Shifts if you need drawer tracking.
          </div>
        )}
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
              onChange={e => {
                const v = e.target.value
                setCustomerId(v ? Number(v) : null)
              }}
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pos-collect-method">
              Payment method
            </label>
            <select
              id="pos-collect-method"
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className={selectClassName}
            >
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Bank transfer</option>
              <option value="mobile_money">Mobile money</option>
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
              placeholder="Receipt #, txn id…"
            />
          </div>
        </div>

        {bankRegisters.length > 0 ? (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pos-collect-bank">
              Bank / till register (optional)
            </label>
            <select
              id="pos-collect-bank"
              value={depositBankId === "" ? "" : String(depositBankId)}
              onChange={e =>
                setDepositBankId(e.target.value === "" ? "" : Number(e.target.value))
              }
              className={selectClassName}
            >
              <option value="">Default cash / undeposited (GL rules)</option>
              {bankRegisters.map(b => (
                <option key={b.id} value={b.id}>
                  {formatBankRegisterLabel(b)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

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

        {activeShift ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              checked={linkToShift}
              onChange={e => setLinkToShift(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">Link to this shift</span>
              <span className="block text-muted-foreground">
                When payment method is <strong>cash</strong>, adds to the shift&apos;s expected cash for drawer
                reconciliation. Non-cash methods do not change expected cash.
              </span>
            </span>
          </label>
        ) : null}

        {customerId ? (
          <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <label className="text-sm font-medium text-foreground" htmlFor="pos-collect-amount">
              Amount received <span className="text-destructive">*</span>
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  {currencySymbol}
                </span>
                <input
                  id="pos-collect-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={paymentAmount || ""}
                  placeholder="0.00"
                  onChange={e => handlePaymentAmountChange(parseFloat(e.target.value) || 0)}
                  className={`${inputClassName} pl-8 text-lg font-semibold tabular-nums`}
                />
              </div>
              {totalDue > 0 ? (
                <button
                  type="button"
                  onClick={() => handlePaymentAmountChange(totalDue)}
                  className="text-sm font-medium text-primary underline underline-offset-2"
                >
                  Pay full due ({currencySymbol}
                  {formatNumber(totalDue)})
                </button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Applied to oldest open invoices first. Any extra becomes customer advance on the on-account line.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Allocation preview</label>
          {loadingInvoices ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading invoices…
            </div>
          ) : !customerId ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
              Choose a customer to see unpaid invoices, on-account A/R, and customer advance.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Balance due</th>
                    <th className="px-3 py-2 text-right">Applied</th>
                    <th className="px-3 py-2 text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map(inv => {
                    const allocId = inv.synthetic ? 0 : inv.id
                    const applied = allocations[allocId] ?? 0
                    const balanceDue = Number(inv.balance_due) || 0
                    const remaining =
                      isOnAccountRow(inv) || balanceDue <= 0
                        ? 0
                        : roundTwo(Math.max(0, balanceDue - applied))
                    const isPartial =
                      !isOnAccountRow(inv) && applied > 0 && remaining > 0 && applied < balanceDue
                    const isFullyPaid = !isOnAccountRow(inv) && applied > 0 && remaining <= 0
                    return (
                      <tr
                        key={rowKey(inv)}
                        className={[
                          "border-b border-border/60 last:border-0",
                          isPartial ? "bg-amber-50/80 dark:bg-amber-950/20" : "",
                          isFullyPaid ? "bg-emerald-50/60 dark:bg-emerald-950/20" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <td className="px-3 py-2 font-medium">
                          {inv.invoice_number}
                          {inv.synthetic ? (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              {inv.on_account
                                ? "(on-account; prepayment as customer credit)"
                                : "(A/R not on an invoice)"}
                            </span>
                          ) : null}
                          {isPartial ? (
                            <span className="ml-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                              (partial)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{inv.invoice_date}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {currencySymbol}
                          {formatNumber(balanceDue)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700 dark:text-emerald-300">
                          {applied > 0 ? (
                            <>
                              {currencySymbol}
                              {formatNumber(applied)}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {!isOnAccountRow(inv) && balanceDue > 0 ? (
                            <>
                              {currencySymbol}
                              {formatNumber(remaining)}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total to collect</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {currencySymbol}
              {formatNumber(paymentAmount)}
            </p>
          </div>
          <button
            type="submit"
            disabled={submitting || paymentAmount <= 0 || !customerId}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Record payment
          </button>
        </div>
      </form>
    </section>
  )
}
