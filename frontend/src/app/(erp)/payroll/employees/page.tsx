'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api'
import { downloadCsvFile, formatPrintDateTime, safeFilenameSegment, toCsvText } from '@/lib/printAndExport'
import { apiDetail, formatDateSafe, fmtBdt } from '../payroll-utils'

interface Employee {
  id: number
  name: string
  phone?: string | null
  email?: string | null
  department?: string | null
  designation?: string | null
  join_date: string
  bank_name?: string | null
  bank_account_no?: string | null
  bank_branch?: string | null
  bank_routing_or_ifsc?: string | null
  opening_balance?: number
  opening_balance_as_of?: string | null
  gl_account_code?: string | null
  ledger_balance?: number | null
  is_active: boolean
  basic_salary?: number | null
  ready_for_payroll: boolean
}

const QK_EMP = ['payroll-employees'] as const

export default function PayrollEmployeesPage() {
  const qc = useQueryClient()
  const [tenantDomain, setTenantDomain] = useState<string>('')
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [salaryEmp, setSalaryEmp] = useState<Employee | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    setTenantDomain(localStorage.getItem('tenant_domain') || 'localhost')
  }, [])

  const {
    data: employees = [],
    isLoading: loadingEmp,
    isError: errEmp,
    error: errEmpObj,
  } = useQuery<Employee[]>({
    queryKey: QK_EMP,
    queryFn: async () => {
      const res = await api.get('/payroll/employees')
      return res.data
    },
    retry: false,
  })

  const createEmpMut = useMutation({
    mutationFn: async (body: {
      name: string
      phone?: string
      email?: string
      department?: string
      designation?: string
      join_date: string
      basic_salary: number
      bank_name?: string
      bank_account_no?: string
      bank_branch?: string
      bank_routing_or_ifsc?: string
      opening_balance?: number
      opening_balance_as_of?: string
    }) => {
      const res = await api.post('/payroll/employees', {
        ...body,
        join_date: new Date(body.join_date).toISOString(),
        opening_balance_as_of:
          body.opening_balance && body.opening_balance !== 0 && body.opening_balance_as_of
            ? new Date(body.opening_balance_as_of + 'T12:00:00').toISOString()
            : undefined,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_EMP })
      setShowAddEmp(false)
      setToast('Employee added.')
      setTimeout(() => setToast(null), 4000)
    },
    onError: (e: unknown) => setToast(apiDetail(e) || 'Could not add employee'),
  })

  const salaryMut = useMutation({
    mutationFn: async (vars: { id: number; basic: number }) => {
      const res = await api.put(`/payroll/employees/${vars.id}/salary`, {
        basic: vars.basic,
        effective_from: new Date().toISOString(),
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_EMP })
      setSalaryEmp(null)
      setToast('Salary saved.')
      setTimeout(() => setToast(null), 4000)
    },
    onError: (e: unknown) => setToast(apiDetail(e) || 'Could not save salary'),
  })

  const errDetail = apiDetail(errEmpObj) || (errEmpObj as Error)?.message

  const exportCsv = () => {
    const header = [
      'id',
      'name',
      'phone',
      'email',
      'department',
      'designation',
      'join_date',
      'basic_salary',
      'opening_balance',
      'opening_balance_as_of',
      'gl_account_code',
      'ledger_balance',
      'ready_for_payroll',
      'status',
    ]
    const dataRows: unknown[][] = employees.map((e) => [
      e.id,
      e.name,
      e.phone || '',
      e.email || '',
      e.department || '',
      e.designation || '',
      e.join_date,
      e.basic_salary ?? 0,
      e.opening_balance ?? 0,
      e.opening_balance_as_of || '',
      e.gl_account_code || '',
      e.ledger_balance ?? '',
      e.ready_for_payroll ? 'Yes' : 'No',
      e.is_active ? 'Active' : 'Inactive',
    ])
    const fn = `payroll_employees_${safeFilenameSegment(tenantDomain || 'export')}_${new Date().toISOString().slice(0, 10)}.csv`
    downloadCsvFile(fn, toCsvText(header, dataRows))
  }

  if (loadingEmp) {
    return (
      <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading employees…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ReportingHubBreadcrumb current="Payroll employees" className="print:hidden" />
      <div
        className="hidden print:block print:mb-4 print:border-b print:pb-3 print:border-gray-200"
        aria-hidden="true"
      >
        <div className="text-xl font-bold text-gray-900">Payroll employees</div>
        <div className="text-sm text-gray-600">
          Company: {tenantDomain || '—'} · Printed {formatPrintDateTime()} · Rows: {employees.length}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md rounded-lg border border-indigo-200 bg-white px-4 py-3 text-sm text-gray-800 shadow-lg print:hidden">
          {toast}
        </div>
      )}

      <header className="print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Employees</h1>
            <p className="mt-1 text-gray-600">Payroll roster — set salary to mark as ready for payroll.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Print
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Export CSV
            </button>
          </div>
        </div>
      </header>

      {errEmp && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 print:hidden">
          {errDetail || 'Could not load employees.'}
          {String(errDetail || '').toLowerCase().includes('tenant') ? (
            <span className="mt-2 block text-red-900">
              Use the company switcher in the header and pick a tenant domain (e.g. <code className="rounded bg-red-100 px-1">master</code> or{' '}
              <code className="rounded bg-red-100 px-1">localhost</code>).
            </span>
          ) : null}
        </div>
      )}

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden print:shadow-none print:border print:border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50/50 to-white flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Roster</h2>
            <p className="text-sm text-gray-500">Set salary to mark as ready for payroll</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddEmp(true)}
            className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            + Add employee
          </button>
        </div>
        <div className="p-5 print:px-0 print:py-3 sm:print:px-5">
          {employees.length === 0 ? (
            <p className="text-gray-500 text-sm print:hidden">No employees yet. Use "Add employee" to start.</p>
          ) : (
            <div className="overflow-x-auto -mx-5 sm:mx-0 print:mx-0 print:overflow-visible">
              <table className="min-w-full divide-y divide-gray-200 text-sm print:text-xs print:[&_th]:p-1.5 print:[&_td]:p-1.5">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Join</th>
                    <th className="px-4 py-3 text-right">Basic (BDT)</th>
                    <th className="px-4 py-3 text-right">Payable GL</th>
                    <th className="px-4 py-3">Ready</th>
                    <th className="px-4 py-3 text-right print:hidden">Salary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {employees.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50/80 print:break-inside-avoid">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{e.name}</div>
                        <div className="text-xs text-gray-500">{[e.email, e.phone].filter(Boolean).join(' · ') || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {e.designation || '—'}
                        {e.department ? <span className="text-gray-400"> · {e.department}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">{formatDateSafe(e.join_date)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtBdt(e.basic_salary)}</td>
                      <td className="px-4 py-3 text-right text-xs">
                        <div className="font-mono text-gray-700">{e.gl_account_code || '—'}</div>
                        <div className="tabular-nums text-gray-600">
                          {e.ledger_balance != null ? fmtBdt(e.ledger_balance) : '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {e.ready_for_payroll ? (
                          <span className="text-emerald-700 font-medium">Yes</span>
                        ) : (
                          <span className="text-gray-400">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right print:hidden">
                        <button
                          type="button"
                          onClick={() => setSalaryEmp(e)}
                          className="text-indigo-600 font-medium hover:underline"
                        >
                          Set / edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {showAddEmp && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 print:hidden"
          onClick={() => setShowAddEmp(false)}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">New employee</h3>
            <form
              className="mt-4 space-y-3"
              onSubmit={(ev) => {
                ev.preventDefault()
                const fd = new FormData(ev.currentTarget)
                const ob = Number(fd.get('opening_balance') || 0)
                createEmpMut.mutate({
                  name: String(fd.get('name') || '').trim(),
                  phone: String(fd.get('phone') || '') || undefined,
                  email: String(fd.get('email') || '') || undefined,
                  department: String(fd.get('department') || '') || undefined,
                  designation: String(fd.get('designation') || '') || undefined,
                  join_date: String(fd.get('join_date') || ''),
                  basic_salary: Number(fd.get('basic_salary') || 0),
                  bank_name: String(fd.get('bank_name') || '') || undefined,
                  bank_account_no: String(fd.get('bank_account_no') || '') || undefined,
                  bank_branch: String(fd.get('bank_branch') || '') || undefined,
                  bank_routing_or_ifsc: String(fd.get('bank_routing_or_ifsc') || '') || undefined,
                  opening_balance: ob,
                  opening_balance_as_of:
                    ob !== 0 ? String(fd.get('opening_balance_as_of') || '') || undefined : undefined,
                })
              }}
            >
              <div>
                <label className="text-xs font-semibold text-gray-600">Name *</label>
                <input name="name" required className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600">Phone</label>
                  <input name="phone" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Email</label>
                  <input name="email" type="email" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600">Department</label>
                  <input name="department" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Designation</label>
                  <input name="designation" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Join date *</label>
                <input
                  name="join_date"
                  type="date"
                  required
                  defaultValue={format(new Date(), 'yyyy-MM-dd')}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Monthly basic (BDT) *</label>
                <input
                  name="basic_salary"
                  type="number"
                  min={0}
                  step={1}
                  required
                  defaultValue={0}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">Creates salary structure. Use &quot;0&quot; only if you will set salary later.</p>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-600 mb-2">Bank (payroll)</p>
                <div className="grid grid-cols-2 gap-2">
                  <input name="bank_name" placeholder="Bank name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm col-span-2" />
                  <input name="bank_account_no" placeholder="Account no." className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <input name="bank_branch" placeholder="Branch" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <input
                    name="bank_routing_or_ifsc"
                    placeholder="Routing / IFSC"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm col-span-2"
                  />
                </div>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-600 mb-1">Opening net payable (GL)</p>
                <p className="text-xs text-gray-500 mb-2">+ = you owe employee; − = advance from employee. Offsets Retained earnings (3200).</p>
                <div className="grid grid-cols-2 gap-2">
                  <input name="opening_balance" type="number" step="0.01" defaultValue={0} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <input name="opening_balance_as_of" type="date" defaultValue={format(new Date(), 'yyyy-MM-dd')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddEmp(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createEmpMut.isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {createEmpMut.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {salaryEmp && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 print:hidden"
          onClick={() => setSalaryEmp(null)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">Salary — {salaryEmp.name}</h3>
            <p className="text-sm text-gray-600 mt-1">Monthly basic; allowances/deductions can be added via API later.</p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(ev) => {
                ev.preventDefault()
                const basic = Number(new FormData(ev.currentTarget).get('basic'))
                if (Number.isNaN(basic) || basic < 0) return
                salaryMut.mutate({ id: salaryEmp.id, basic })
              }}
            >
              <div>
                <label className="text-xs font-semibold text-gray-600">Monthly basic (BDT)</label>
                <input
                  name="basic"
                  type="number"
                  min={0}
                  step={1}
                  required
                  defaultValue={salaryEmp.basic_salary ?? 0}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setSalaryEmp(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">
                  Cancel
                </button>
                <button type="submit" disabled={salaryMut.isPending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
                  {salaryMut.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
