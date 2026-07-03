"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Loader2 } from "lucide-react"
import api from "@/lib/api"
import { isOffsetPagedPayload, REFERENCE_FETCH_LIMIT } from "@/lib/pagination"
import { getCurrencySymbol, formatNumber } from "@/utils/currency"
import { formatDateOnly } from "@/utils/date"
import {
  PaymentReceivedForm,
  type PaymentRecordedResult,
} from "@/components/payments/PaymentReceivedForm"

type CustomerRow = { id: number; display_name: string }

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

function normalizeCustomers(data: unknown): CustomerRow[] {
  const rows = Array.isArray(data) ? data : []
  return rows
    .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
    .flatMap(r => {
      const id = typeof r.id === "number" ? r.id : Number(r.id)
      if (!Number.isFinite(id)) return []
      return [{ id, display_name: String(r.display_name ?? "") }]
    })
}

function normalizePayments(data: unknown): PaymentRow[] {
  if (isOffsetPagedPayload(data)) {
    return (data.results as PaymentRow[]) ?? []
  }
  if (Array.isArray(data)) {
    return data as PaymentRow[]
  }
  return []
}

export type CashierDueCollectionProps = {
  onRecorded?: () => void | Promise<void>
}

export function CashierDueCollection({ onRecorded }: CashierDueCollectionProps) {
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [currencySymbol, setCurrencySymbol] = useState("৳")
  const [listLoading, setListLoading] = useState(true)
  const [lastRecorded, setLastRecorded] = useState<PaymentRecordedResult | null>(null)
  const [formKey, setFormKey] = useState(0)

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
    void (async () => {
      try {
        const [companyRes, custRes] = await Promise.allSettled([
          api.get("/companies/current"),
          api.get("/customers/", { params: { skip: 0, limit: REFERENCE_FETCH_LIMIT } }),
        ])
        if (companyRes.status === "fulfilled" && companyRes.value.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.value.data.currency))
        }
        if (custRes.status === "fulfilled") {
          setCustomers(normalizeCustomers(custRes.value.data))
        }
      } catch {
        /* optional */
      }
      await loadList()
    })()
  }, [loadList])

  const customerName = (customerId: number) => {
    const c = customers.find(x => x.id === customerId)
    return c?.display_name?.trim() || `Customer #${customerId}`
  }

  const handleSuccess = async (payment?: PaymentRecordedResult) => {
    if (payment?.id) {
      setLastRecorded(payment)
    }
    setFormKey(k => k + 1)
    await loadList()
    try {
      await onRecorded?.()
    } catch {
      /* parent refresh is best-effort */
    }
  }

  const lastRecordedName =
    lastRecorded?.customer_id != null ? customerName(lastRecorded.customer_id) : null

  return (
    <div className="space-y-6">
      <PaymentReceivedForm
        key={formKey}
        embedded
        showShiftLink
        cancelHref={null}
        onSuccess={payment => void handleSuccess(payment)}
      />

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
