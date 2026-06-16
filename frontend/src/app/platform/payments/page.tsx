'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateTime } from '@/utils/date'
import { PlatformLayout } from '@/components/PlatformLayout'

type SubscriptionInvoice = {
  id: number
  tenant_id: number
  tenant_name: string | null
  tenant_domain: string | null
  invoice_number: string
  total_amount: number
  paid_date: string | null
  payment_method: string | null
  status: string
}

function fmtMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 }).format(n)
  } catch {
    return n.toFixed(2)
  }
}

export default function PlatformPaymentsPage() {
  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ['platform-subscription-payments'],
    queryFn: async () => {
      const res = await api.get<SubscriptionInvoice[]>('/platform/subscription-invoices?status=paid&limit=300')
      return res.data
    },
    retry: 1,
  })

  const err = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? (error as Error)?.message

  return (
    <PlatformLayout>
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
        <p className="mt-1 text-sm text-slate-600">
          Paid subscription invoices (cash-in against tenant billing). Create invoices via your billing process or seed data.
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}

      {!isLoading && !isError && data.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          No paid invoices yet. Mark subscription invoices as paid to see them here.
        </div>
      )}

      {data.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Invoice #</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Tenant</th>
                <th className="px-4 py-3 text-right font-medium text-slate-600">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Paid</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Method</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-3 font-mono font-medium text-slate-900">{inv.invoice_number}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{inv.tenant_name || '—'}</div>
                    <div className="text-xs text-slate-500">{inv.tenant_domain || ''}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtMoney(inv.total_amount)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {inv.paid_date ? formatDateTime(inv.paid_date) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{inv.payment_method || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </PlatformLayout>
  )
}
