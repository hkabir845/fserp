'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Emp = { id: number; name: string; employee_code: string | null }
type Leave = {
  id: number
  employee_id: number
  leave_type: string
  start_date: string
  end_date: string
  status: string
}
type Att = { id: number; employee_id: number; work_date: string; status: string }
type HrSummary = {
  pending_leaves: number
  approved_leaves: number
  attendance_marked_today: number
  present_today: number
  absent_today: number
}

export default function HrTimePage() {
  const qc = useQueryClient()

  const { data: employees = [], error: empErr } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: async () => {
      const res = await api.get<Emp[]>('/payroll/employees')
      return res.data
    },
    retry: false,
  })

  const { data: leaves = [] } = useQuery({
    queryKey: ['hr-leaves'],
    queryFn: async () => {
      const res = await api.get<Leave[]>('/hr/leave-requests')
      return res.data
    },
    retry: false,
  })

  const { data: att = [] } = useQuery({
    queryKey: ['hr-att'],
    queryFn: async () => {
      const res = await api.get<Att[]>('/hr/attendance')
      return res.data
    },
    retry: false,
  })
  const { data: summary } = useQuery({
    queryKey: ['hr-summary'],
    queryFn: async () => {
      const res = await api.get<HrSummary>('/hr/summary')
      return res.data
    },
    retry: false,
  })

  const [eid, setEid] = useState<number | ''>('')
  const [ltype, setLtype] = useState('annual')
  const [sd, setSd] = useState(() => new Date().toISOString().slice(0, 10))
  const [ed, setEd] = useState(() => new Date().toISOString().slice(0, 10))

  const reqLeave = useMutation({
    mutationFn: async () => {
      if (eid === '') throw new Error('employee')
      const res = await api.post('/hr/leave-requests', {
        employee_id: eid,
        leave_type: ltype,
        start_date: sd,
        end_date: ed,
      })
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
  })

  const [aeid, setAeid] = useState<number | ''>('')
  const [adate, setAdate] = useState(() => new Date().toISOString().slice(0, 10))
  const [ast, setAst] = useState('present')
  const [bulkDate, setBulkDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [bulkStatus, setBulkStatus] = useState('present')
  const [bulkEmployeeIds, setBulkEmployeeIds] = useState<number[]>([])

  const upsertAtt = useMutation({
    mutationFn: async () => {
      if (aeid === '') throw new Error('emp')
      const res = await api.put('/hr/attendance', {
        employee_id: aeid,
        work_date: adate,
        status: ast,
      })
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-att'] }),
  })
  const bulkUpsertAtt = useMutation({
    mutationFn: async () => {
      if (bulkEmployeeIds.length === 0) throw new Error('no employee selected')
      const res = await api.put('/hr/attendance/bulk', {
        work_date: bulkDate,
        rows: bulkEmployeeIds.map((id) => ({ employee_id: id, status: bulkStatus })),
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-att'] })
      qc.invalidateQueries({ queryKey: ['hr-summary'] })
    },
  })

  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: number; approve: boolean }) => {
      const res = await api.patch(`/hr/leave-requests/${id}/decide`, { approve })
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
  })
  const mutationError =
    (reqLeave.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (upsertAtt.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (bulkUpsertAtt.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (decide.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail

  return (
          <div className="max-w-4xl space-y-8">
        <ReportingHubBreadcrumb current="Time & attendance" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">HRM — time & attendance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Leave requests and daily attendance for FMERP employees (extends payroll). Approve or reject pending
            requests.
          </p>
        </div>

        {empErr ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">Tenant required for HR data.</div>
        ) : null}
        {mutationError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{mutationError}</div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending leaves</div>
            <div className="mt-2 text-2xl font-semibold text-warning-foreground">{summary?.pending_leaves ?? 0}</div>
          </div>
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approved leaves</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-700">{summary?.approved_leaves ?? 0}</div>
          </div>
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Marked today</div>
            <div className="mt-2 text-2xl font-semibold text-primary">{summary?.attendance_marked_today ?? 0}</div>
          </div>
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Present today</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-700">{summary?.present_today ?? 0}</div>
          </div>
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Absent today</div>
            <div className="mt-2 text-2xl font-semibold text-rose-700">{summary?.absent_today ?? 0}</div>
          </div>
        </div>

        <section className="erp-panel">
          <h2 className="text-sm font-semibold">Request leave</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              className="rounded border px-3 py-2 text-sm"
              value={eid === '' ? '' : String(eid)}
              onChange={(e) => setEid(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} {e.employee_code ? `(${e.employee_code})` : ''}
                </option>
              ))}
            </select>
            <select className="rounded border px-3 py-2 text-sm" value={ltype} onChange={(e) => setLtype(e.target.value)}>
              <option value="annual">Annual</option>
              <option value="sick">Sick</option>
              <option value="casual">Casual</option>
              <option value="unpaid">Unpaid</option>
            </select>
            <CompanyDateInput value={sd} onChange={setSd} className="rounded border px-3 py-2 text-sm" />
            <CompanyDateInput value={ed} onChange={setEd} className="rounded border px-3 py-2 text-sm" />
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={eid === '' || reqLeave.isPending}
              onClick={() => reqLeave.mutate()}
            >
              {reqLeave.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </section>

        <section className="erp-panel">
          <h2 className="text-sm font-semibold">Mark attendance</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              className="rounded border px-3 py-2 text-sm"
              value={aeid === '' ? '' : String(aeid)}
              onChange={(e) => setAeid(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <CompanyDateInput value={adate} onChange={setAdate} className="rounded border px-3 py-2 text-sm" />
            <select className="rounded border px-3 py-2 text-sm" value={ast} onChange={(e) => setAst(e.target.value)}>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="half_day">Half day</option>
              <option value="leave">On leave</option>
              <option value="holiday">Holiday</option>
            </select>
            <button
              type="button"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={aeid === '' || upsertAtt.isPending}
              onClick={() => upsertAtt.mutate()}
              >
              {upsertAtt.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </section>

        <section className="erp-panel">
          <h2 className="text-sm font-semibold">Bulk attendance</h2>
          <p className="mt-1 text-xs text-muted-foreground">Mark one status for multiple employees on one date.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CompanyDateInput value={bulkDate} onChange={setBulkDate} className="rounded border px-3 py-2 text-sm" />
            <select className="rounded border px-3 py-2 text-sm" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="half_day">Half day</option>
              <option value="leave">On leave</option>
              <option value="holiday">Holiday</option>
            </select>
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={bulkEmployeeIds.length === 0 || bulkUpsertAtt.isPending}
              onClick={() => bulkUpsertAtt.mutate()}
            >
              {bulkUpsertAtt.isPending ? 'Applying…' : `Apply to selected (${bulkEmployeeIds.length})`}
            </button>
          </div>
          <div className="mt-3 grid max-h-44 grid-cols-1 gap-1 overflow-auto rounded border border-border p-2 sm:grid-cols-2">
            {employees.map((e) => {
              const checked = bulkEmployeeIds.includes(e.id)
              return (
                <label key={e.id} className="inline-flex items-center gap-2 text-sm text-foreground/85">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(ev) => {
                      if (ev.target.checked) {
                        setBulkEmployeeIds((prev) => [...prev, e.id])
                      } else {
                        setBulkEmployeeIds((prev) => prev.filter((id) => id !== e.id))
                      }
                    }}
                  />
                  {e.name}
                </label>
              )
            })}
          </div>
        </section>

        <section className="erp-panel">
          <h2 className="text-sm font-semibold">Leave requests</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {leaves.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 py-2">
                <span>
                  #{l.id} — emp {l.employee_id} · {l.leave_type} · {l.start_date} → {l.end_date}{' '}
                  <span className="text-muted-foreground">({l.status})</span>
                </span>
                {l.status === 'pending' ? (
                  <span className="space-x-1">
                    <button type="button" className="text-xs text-emerald-600 disabled:opacity-50" disabled={decide.isPending} onClick={() => decide.mutate({ id: l.id, approve: true })}>
                      Approve
                    </button>
                    <button type="button" className="text-xs text-destructive disabled:opacity-50" disabled={decide.isPending} onClick={() => decide.mutate({ id: l.id, approve: false })}>
                      Reject
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="erp-panel">
          <h2 className="text-sm font-semibold">Attendance (latest)</h2>
          <ul className="mt-2 text-sm">
            {att.slice(0, 40).map((a) => (
              <li key={a.id}>
                Emp {a.employee_id} · {a.work_date} · {a.status}
              </li>
            ))}
          </ul>
        </section>
      </div>
  )
}
