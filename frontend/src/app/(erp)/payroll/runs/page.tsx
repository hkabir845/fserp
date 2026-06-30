'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { MONTHS, apiDetail, fmtBdt, statusBadge } from '../payroll-utils'

interface PayrollRun {
  id: number
  run_number: string
  period_month: number
  period_year: number
  status: string
  run_date: string
}

interface PayslipRow {
  id: number
  employee_id: number
  employee_name?: string | null
  gross: number
  deduction: number
  net: number
}

const QK_RUNS = ['payroll-runs'] as const

export default function PayrollRunsPage() {
  const qc = useQueryClient()
  const [payslipRun, setPayslipRun] = useState<PayrollRun | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const {
    data: runs = [],
    isLoading: loadingRuns,
    isError: errRuns,
    error: errRunsObj,
  } = useQuery<PayrollRun[]>({
    queryKey: QK_RUNS,
    queryFn: async () => {
      const res = await api.get('/payroll/runs', { params: { limit: 50 } })
      return res.data
    },
    retry: false,
  })

  const { data: payslipRows = [], isLoading: loadingPayslips } = useQuery<PayslipRow[]>({
    queryKey: ['payroll-payslips', payslipRun?.id],
    queryFn: async () => {
      if (!payslipRun) return []
      const res = await api.get(`/payroll/runs/${payslipRun.id}/payslips`)
      return res.data
    },
    enabled: !!payslipRun,
    retry: false,
  })

  const calculateMut = useMutation({
    mutationFn: async (runId: number) => {
      const res = await api.post(`/payroll/runs/${runId}/calculate`)
      return res.data as { message: string; skipped_no_salary: string[]; payslips_created: number }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: QK_RUNS })
      qc.invalidateQueries({ queryKey: ['payroll-payslips'] })
      setToast(
        data.message +
          (data.skipped_no_salary?.length
            ? ` Skipped: ${data.skipped_no_salary.slice(0, 3).join('; ')}${data.skipped_no_salary.length > 3 ? '…' : ''}`
            : '')
      )
      setTimeout(() => setToast(null), 8000)
    },
    onError: (e: unknown) => setToast(apiDetail(e) || 'Calculate failed'),
  })

  const postMut = useMutation({
    mutationFn: async (runId: number) => {
      const res = await api.post(`/payroll/runs/${runId}/post`)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_RUNS })
      setToast('Payroll run posted.')
      setTimeout(() => setToast(null), 4000)
    },
    onError: (e: unknown) => setToast(apiDetail(e) || 'Post failed'),
  })

  const errDetail = apiDetail(errRunsObj) || (errRunsObj as Error)?.message

  if (loadingRuns) {
    return (
      <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading runs…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ReportingHubBreadcrumb current="Payroll runs" />
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md rounded-lg border border-primary/25 bg-white px-4 py-3 text-sm text-foreground shadow-lg">
          {toast}
        </div>
      )}

      <header>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Payroll runs</h1>
        <p className="mt-1 text-muted-foreground">Draft → calculate payslips → post. Create a new run from the Overview tab.</p>
      </header>

      {errRuns && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errDetail || 'Could not load payroll runs.'}
        </div>
      )}

      <section className="bg-white rounded-xl shadow-sm border border-border/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-border/70 bg-gradient-to-r from-muted/40 to-card">
          <h2 className="text-lg font-semibold text-foreground">Runs</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Draft → calculate payslips → post</p>
        </div>
        <div className="p-5">
          {runs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No runs yet. Open Payroll → Overview and use step 2 to create a run.</p>
          ) : (
            <div className="overflow-x-auto -mx-5 sm:mx-0">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-3">Run #</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {runs.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/40/80">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{r.run_number}</td>
                      <td className="px-4 py-3 text-foreground">
                        {MONTHS[(r.period_month || 1) - 1]} {r.period_year}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadge(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setPayslipRun(r)}
                          className="text-primary font-medium hover:underline"
                        >
                          Payslips
                        </button>
                        {r.status === 'draft' && (
                          <>
                            <button
                              type="button"
                              onClick={() => calculateMut.mutate(r.id)}
                              disabled={calculateMut.isPending}
                              className="text-foreground/85 font-medium hover:underline disabled:opacity-50"
                            >
                              Recalc
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm('Post this run? It will no longer be editable.')) postMut.mutate(r.id)
                              }}
                              disabled={postMut.isPending}
                              className="text-emerald-700 font-semibold hover:underline disabled:opacity-50"
                            >
                              Post
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {payslipRun && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/50 p-4"
          onClick={() => setPayslipRun(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-foreground">Payslips — {payslipRun.run_number}</h3>
            <p className="text-sm text-muted-foreground">
              {MONTHS[payslipRun.period_month - 1]} {payslipRun.period_year}
            </p>
            {loadingPayslips ? (
              <p className="mt-4 text-muted-foreground">Loading…</p>
            ) : payslipRows.length === 0 ? (
              <p className="mt-4 text-muted-foreground">No payslips yet. Use Recalc on a draft run.</p>
            ) : (
              <table className="mt-4 min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-muted-foreground border-b">
                    <th className="py-2">Employee</th>
                    <th className="py-2 text-right">Gross</th>
                    <th className="py-2 text-right">Deductions</th>
                    <th className="py-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {payslipRows.map((p) => (
                    <tr key={p.id} className="border-b border-border/70">
                      <td className="py-2 text-foreground">{p.employee_name || `#${p.employee_id}`}</td>
                      <td className="py-2 text-right tabular-nums">{fmtBdt(p.gross)}</td>
                      <td className="py-2 text-right tabular-nums text-warning-foreground">{fmtBdt(p.deduction)}</td>
                      <td className="py-2 text-right font-semibold tabular-nums text-emerald-800">{fmtBdt(p.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button
              type="button"
              onClick={() => setPayslipRun(null)}
              className="mt-6 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/85"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
