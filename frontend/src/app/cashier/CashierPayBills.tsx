"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import api from "@/lib/api"
import { useToast } from "@/components/Toast"
import { formatNumber } from "@/utils/currency"
import { Banknote, Loader2 } from "lucide-react"

const inputClassName =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
const selectClassName =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

type VendorRow = { id: number; display_name: string }

type BankLine = {
  id: number
  account_name: string
  bank_name?: string
  chart_account_id?: number | null
  is_active?: boolean
  is_equity_register?: boolean
  current_balance?: string | number | null
}

type OutstandingBill = {
  id: number
  bill_number: string
  bill_date: string
  balance_due: string | number
  synthetic?: boolean
  on_account?: boolean
  vendor_id: number
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

function allocBillId(b: OutstandingBill) {
  return b.synthetic ? 0 : b.id
}

export type CashierPayBillsProps = {
  vendors: VendorRow[]
  currencySymbol: string
  /** Active bank / cash registers (exclude equity-only registers in parent). */
  bankAccounts: BankLine[]
  onRecorded: () => void | Promise<void>
}

/**
 * Disburse to vendors against open A/P: Dr Accounts Payable, Cr Bank/Cash.
 * Bank account is required; amounts must be allocated to bills or on-account (opening) lines.
 */
export function CashierPayBills({ vendors, currencySymbol, bankAccounts, onRecorded }: CashierPayBillsProps) {
  const toast = useToast()
  const [vendorId, setVendorId] = useState<number | null>(null)
  const [outstanding, setOutstanding] = useState<OutstandingBill[]>([])
  const [allocations, setAllocations] = useState<Record<number, number>>({})
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split("T")[0])
  const [paymentMethod, setPaymentMethod] = useState("check")
  const [reference, setReference] = useState("")
  const [memo, setMemo] = useState("")
  const [bankId, setBankId] = useState<number | "">("")
  const [loadingBills, setLoadingBills] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const payableBanks = bankAccounts.filter(
    b => b.is_active !== false && b.is_equity_register !== true
  )

  useEffect(() => {
    if (!vendorId) {
      setOutstanding([])
      setAllocations({})
      setMemo("")
      setReference("")
      return
    }
    const v = vendors.find(x => x.id === vendorId)
    if (v) {
      setMemo(`POS vendor payment — ${v.display_name}`)
    }
    setLoadingBills(true)
    api
      .get("/payments/made/outstanding/", { params: { vendor_id: vendorId } })
      .then(res => {
        const rows = Array.isArray(res.data) ? res.data : []
        setOutstanding(rows as OutstandingBill[])
        const next: Record<number, number> = {}
        for (const bill of rows as OutstandingBill[]) {
          next[allocBillId(bill)] = 0
        }
        setAllocations(next)
      })
      .catch(() => {
        setOutstanding([])
        setAllocations({})
        toast.error("Could not load open bills for this vendor.")
      })
      .finally(() => setLoadingBills(false))
  }, [vendorId, vendors, toast])

  const totalAllocated = roundTwo(
    Object.values(allocations).reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0)
  )

  const rowKey = (b: OutstandingBill) => (b.synthetic ? `oa-v-${b.vendor_id}` : String(b.id))

  const setAlloc = (billIdKey: number, raw: number) => {
    const row = outstanding.find(
      b => (b.synthetic && billIdKey === 0) || (!b.synthetic && b.id === billIdKey)
    )
    if (!row) return
    const maxAmt = Number(row.balance_due) || 0
    const v = roundTwo(Math.min(Math.max(0, raw), maxAmt))
    setAllocations(prev => ({ ...prev, [billIdKey]: v }))
  }

  const payAllOldestFirst = () => {
    const totalBal = roundTwo(
      outstanding.reduce((s, b) => s + (Number(b.balance_due) || 0), 0)
    )
    let left = totalBal
    const sorted = [...outstanding].sort((a, b) => {
      if (a.synthetic && !b.synthetic) return 1
      if (!a.synthetic && b.synthetic) return -1
      return new Date(a.bill_date).getTime() - new Date(b.bill_date).getTime()
    })
    const next: Record<number, number> = { ...allocations }
    for (const k of Object.keys(next)) {
      next[Number(k)] = 0
    }
    for (const bill of sorted) {
      if (left <= 0) break
      const bal = Number(bill.balance_due) || 0
      const take = roundTwo(Math.min(left, bal))
      const aid = allocBillId(bill)
      next[aid] = take
      left = roundTwo(left - take)
    }
    setAllocations(next)
  }

  const runAfterRecord = useCallback(async () => {
    await onRecorded()
  }, [onRecorded])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!vendorId) {
      toast.error("Select a vendor.")
      return
    }
    if (bankId === "" || typeof bankId !== "number") {
      toast.error("Select a bank or cash account to pay from. Disbursements credit this register (A/P is reduced).")
      return
    }
    if (totalAllocated <= 0) {
      toast.error("Enter an amount to pay (allocate to at least one line).")
      return
    }
    const bank = payableBanks.find(b => b.id === bankId)
    if (bank && bank.current_balance != null && String(bank.current_balance).trim() !== "") {
      const bal = Number(bank.current_balance) || 0
      if (Number.isFinite(bal) && bal < totalAllocated - 0.005) {
        toast.error(
          `Insufficient funds in that register. Available: ${currencySymbol}${formatNumber(bal)}`
        )
        return
      }
    }
    const valid = Object.entries(allocations)
      .map(([k, amt]) => ({
        bill_id: Number(k),
        allocated_amount: amt,
      }))
      .filter(a => a.allocated_amount > 0)
    if (valid.length === 0) {
      toast.error("Allocate to at least one bill or on-account line.")
      return
    }

    setSubmitting(true)
    try {
      await api.post("/payments/made/", {
        vendor_id: vendorId,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        amount: totalAllocated,
        bank_account_id: bankId,
        reference_number: reference.trim() || null,
        memo: memo.trim() || null,
        allocations: valid,
      })
      toast.success("Payment posted: A/P reduced and bank/cash credited per GL rules.")
      setVendorId(null)
      setOutstanding([])
      setAllocations({})
      setReference("")
      setMemo("")
      setBankId("")
      await runAfterRecord()
    } catch (err) {
      toast.error(formatAxiosDetail(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
      <div className="mb-6 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Banknote className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Pay bills (A/P)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pay vendor open balances from a <strong>bank or cash</strong> register. The system posts:{" "}
              <span className="whitespace-nowrap">Debit A/P, Credit bank/cash</span> — same as{" "}
              <Link
                href="/payments/made/new"
                className="font-medium text-primary underline underline-offset-2"
              >
                Payments → Pay vendor
              </Link>
              .
            </p>
            <p className="mt-2 text-xs text-muted-foreground/90">
              You must select where funds leave from; on-account lines cover opening / legacy A/P not yet on a bill.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={e => void handleSubmit(e)} className="space-y-5" autoComplete="off">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pos-pay-vendor">
              Vendor <span className="text-destructive">*</span>
            </label>
            <select
              id="pos-pay-vendor"
              value={vendorId ?? ""}
              onChange={e => {
                const v = e.target.value
                setVendorId(v ? Number(v) : null)
              }}
              className={selectClassName}
              required
            >
              <option value="">Select vendor</option>
              {vendors.map(c => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pos-pay-date">
              Payment date
            </label>
            <input
              id="pos-pay-date"
              type="date"
              value={paymentDate}
              onChange={e => setPaymentDate(e.target.value)}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pos-pay-bank">
              Pay from (bank or cash) <span className="text-destructive">*</span>
            </label>
            <select
              id="pos-pay-bank"
              value={bankId === "" ? "" : String(bankId)}
              onChange={e => setBankId(e.target.value === "" ? "" : Number(e.target.value))}
              className={selectClassName}
              required
            >
              <option value="">Choose register (required)</option>
              {payableBanks.map(b => (
                <option key={b.id} value={b.id}>
                  {[b.bank_name, b.account_name].filter(Boolean).join(" — ") || `Register #${b.id}`}
                </option>
              ))}
            </select>
            {payableBanks.length === 0 ? (
              <p className="text-xs text-amber-700">
                No bank/cash registers found. Add a bank account under settings so disbursements can credit the right
                account.
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pos-pay-method">
              Method
            </label>
            <select
              id="pos-pay-method"
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className={selectClassName}
            >
              <option value="check">Check</option>
              <option value="ach">ACH</option>
              <option value="wire_transfer">Wire</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pos-pay-ref">
              Reference (optional)
            </label>
            <input
              id="pos-pay-ref"
              type="text"
              value={reference}
              onChange={e => setReference(e.target.value)}
              className={inputClassName}
              placeholder="Check #, ref…"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground" htmlFor="pos-pay-memo">
            Memo (optional)
          </label>
          <textarea
            id="pos-pay-memo"
            rows={2}
            value={memo}
            onChange={e => setMemo(e.target.value)}
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm font-medium text-foreground">Open bills &amp; A/P</label>
            {vendorId && outstanding.length > 0 ? (
              <button
                type="button"
                onClick={() => payAllOldestFirst()}
                className="text-sm font-medium text-primary underline underline-offset-2"
              >
                Pay oldest first (bills, then on-account)
              </button>
            ) : null}
          </div>
          {loadingBills ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading open amounts…
            </div>
          ) : !vendorId ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
              Choose a vendor to see unpaid bills and on-account A/P.
            </p>
          ) : outstanding.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
              No open amount for this vendor.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Bill / line</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Balance due</th>
                    <th className="px-3 py-2 text-right">Pay now</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map(bill => {
                    const aid = allocBillId(bill)
                    return (
                      <tr key={rowKey(bill)} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 font-medium">
                          {bill.bill_number}
                          {bill.synthetic ? (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              (A/P not on a bill)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{bill.bill_date}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {currencySymbol}
                          {formatNumber(Number(bill.balance_due) || 0)}
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

        <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total to pay</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {currencySymbol}
              {formatNumber(totalAllocated)}
            </p>
          </div>
          <button
            type="submit"
            disabled={
              submitting || totalAllocated <= 0 || !vendorId || bankId === "" || payableBanks.length === 0
            }
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Post payment
          </button>
        </div>
      </form>
    </section>
  )
}
