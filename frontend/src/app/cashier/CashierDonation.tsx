"use client"

import { useCallback, useEffect, useState } from "react"
import api from "@/lib/api"
import { useToast } from "@/components/Toast"
import { formatNumber } from "@/utils/currency"
import { HeartHandshake, Loader2 } from "lucide-react"

const inputClassName =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
const selectClassName =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

type BankLine = {
  id: number
  account_name: string
  bank_name?: string
  chart_account_id?: number | null
  is_active?: boolean
  is_equity_register?: boolean
}

type ActiveShift = { id: number; expected_cash_total?: string }

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

export type CashierDonationProps = {
  currencySymbol: string
  /** Active bank / cash registers (exclude equity-only in parent). */
  bankAccounts: BankLine[]
  onRecorded: () => void | Promise<void>
}

/**
 * Dr chart 6910 Donation &amp; Social Support, Cr 1010 / selected register (same as POS sales).
 */
export function CashierDonation({ currencySymbol, bankAccounts, onRecorded }: CashierDonationProps) {
  const toast = useToast()
  const [amount, setAmount] = useState("")
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().split("T")[0])
  const [bankId, setBankId] = useState<number | "">("")
  const [memo, setMemo] = useState("POS — donation & social support")
  const [submitting, setSubmitting] = useState(false)
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)
  const [linkToShift, setLinkToShift] = useState(true)

  const payableBanks = bankAccounts.filter(
    b => b.is_active !== false && b.is_equity_register !== true
  )

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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = roundTwo(parseFloat(String(amount).replace(/,/g, "")))
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a positive amount.")
      return
    }
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        amount: String(n),
        entry_date: entryDate,
        memo: memo.trim() || "POS — donation & social support",
      }
      if (bankId !== "") {
        payload.bank_account_id = bankId
      }
      if (linkToShift && activeShift) {
        payload.shift_session_id = activeShift.id
      }
      await api.post("/cashier/cash-donation/", payload)
      toast.success("Donation & social support recorded. Expense 6910; cash reduced on the selected register.")
      setAmount("")
      await onRecorded()
      void loadShift()
    } catch (err) {
      toast.error(formatAxiosDetail(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-200/80 bg-rose-50 text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/50 dark:text-rose-200">
            <HeartHandshake className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Donation &amp; social support</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Records a cash payout from the register. Posts to <strong>6910</strong> Donation &amp; Social Support
              (debit) and <strong>1010</strong> Cash on Hand or your selected register (credit) — the same path as
              other POS cash movements.
            </p>
          </div>
        </div>

        {activeShift ? (
          <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={linkToShift}
              onChange={e => setLinkToShift(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">Link to open shift #{activeShift.id}</span>
              <span className="block text-xs text-muted-foreground">
                When checked, reduces this shift&apos;s expected cash drawer (cash out).
              </span>
            </span>
          </label>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">
            No open shift — the journal still posts. Open a shift under Shifts to tie the payout to a drawer
            count.
          </p>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Amount</label>
              <div className="flex gap-2">
                <span className="inline-flex min-w-9 items-center justify-center rounded-lg border border-border bg-muted/40 px-2 text-sm text-muted-foreground">
                  {currencySymbol}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClassName}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Date</label>
              <input
                type="date"
                className={inputClassName}
                value={entryDate}
                onChange={e => setEntryDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Pay from (cash register)</label>
            <select
              className={selectClassName}
              value={bankId === "" ? "" : String(bankId)}
              onChange={e => setBankId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Default — 1010 Cash on Hand (GL only)</option>
              {payableBanks.map(b => (
                <option key={b.id} value={b.id}>
                  {b.account_name}
                  {b.chart_account_id == null ? " (no GL link — link in Bank accounts)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Choose a register to match your physical till, or use the default to credit <strong>1010</strong> Cash
              on Hand in the books.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Note</label>
            <input
              type="text"
              className={inputClassName}
              value={memo}
              onChange={e => setMemo(e.target.value)}
              maxLength={300}
            />
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200/90 bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <HeartHandshake className="h-4 w-4" />}
              Record {currencySymbol}
              {amount ? formatNumber(parseFloat(String(amount)) || 0) : "0"} expense
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
