'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateTime } from '@/utils/date'

type Activity = {
  id: number
  lead_id: number | null
  customer_id: number | null
  activity_type: string
  subject: string
  due_at: string | null
  completed_at: string | null
  notes: string | null
}
type LeadOption = { id: number; name: string; company_name: string | null }
type CrmSummary = {
  total_leads: number
  stages: Record<string, number>
  open_activities: number
  overdue_open_activities: number
}

export default function CrmActivitiesPage() {
  const qc = useQueryClient()
  const [openOnly, setOpenOnly] = useState(true)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [notes, setNotes] = useState('')

  const { data: leads = [] } = useQuery({
    queryKey: ['crm-leads-options'],
    queryFn: async () => {
      const res = await api.get<LeadOption[]>('/crm/leads')
      return res.data
    },
    retry: false,
  })
  const { data: summary } = useQuery({
    queryKey: ['crm-summary'],
    queryFn: async () => {
      const res = await api.get<CrmSummary>('/crm/summary')
      return res.data
    },
    retry: false,
  })
  const { data = [], error } = useQuery({
    queryKey: ['crm-activities', openOnly, overdueOnly, typeFilter, search],
    queryFn: async () => {
      const res = await api.get<Activity[]>('/crm/activities', {
        params: {
          open_only: openOnly,
          overdue_only: overdueOnly || undefined,
          activity_type: typeFilter || undefined,
          search: search.trim() || undefined,
        },
      })
      return res.data
    },
    retry: false,
  })

  const [leadId, setLeadId] = useState<number | ''>('')
  const [atype, setAtype] = useState('call')
  const [subject, setSubject] = useState('')

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post('/crm/activities', {
        lead_id: leadId || undefined,
        customer_id: undefined,
        activity_type: atype,
        subject: subject || 'Activity',
        due_at: dueAt || undefined,
        notes: notes || undefined,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-activities'] })
      qc.invalidateQueries({ queryKey: ['crm-summary'] })
      setSubject('')
      setNotes('')
      setDueAt('')
    },
  })

  const complete = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.patch(`/crm/activities/${id}`, { completed_at: new Date().toISOString() })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-activities'] })
      qc.invalidateQueries({ queryKey: ['crm-summary'] })
    },
  })
  const stats = useMemo(
    () => ({
      total: data.length,
      open: data.filter((a) => !a.completed_at).length,
      overdue: data.filter((a) => !a.completed_at && a.due_at && new Date(a.due_at).getTime() < Date.now()).length,
      completed: data.filter((a) => !!a.completed_at).length,
    }),
    [data]
  )
  const mutationError =
    (create.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (complete.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail

  return (
          <div className="max-w-4xl space-y-6">
        <ReportingHubBreadcrumb current="CRM activities" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">CRM activities</h1>
          <p className="mt-1 text-sm text-gray-600">Calls, visits, and follow-ups linked to leads (FMERP CRM).</p>
        </div>

        {error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">Tenant required.</div>
        ) : null}
        {mutationError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{mutationError}</div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Open (global)</div>
            <div className="mt-2 text-2xl font-semibold text-indigo-700">{summary?.open_activities ?? stats.open}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Overdue (global)</div>
            <div className="mt-2 text-2xl font-semibold text-rose-700">{summary?.overdue_open_activities ?? stats.overdue}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Shown open</div>
            <div className="mt-2 text-2xl font-semibold text-indigo-700">{stats.open}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Shown completed</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-700">{stats.completed}</div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Log activity</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select
              className="rounded border px-3 py-2 text-sm"
              value={leadId === '' ? '' : String(leadId)}
              onChange={(e) => setLeadId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Lead (required)</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}{l.company_name ? ` — ${l.company_name}` : ''}
                </option>
              ))}
            </select>
            <select className="rounded border px-3 py-2 text-sm" value={atype} onChange={(e) => setAtype(e.target.value)}>
              <option value="call">Call</option>
              <option value="visit">Visit</option>
              <option value="email">Email</option>
              <option value="task">Task</option>
              <option value="meeting">Meeting</option>
              <option value="note">Note</option>
            </select>
            <input
              className="rounded border px-3 py-2 text-sm"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <input className="rounded border px-3 py-2 text-sm" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            <input
              className="sm:col-span-2 lg:col-span-3 rounded border px-3 py-2 text-sm"
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button
              type="button"
              disabled={create.isPending || leadId === ''}
              onClick={() => create.mutate()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white"
            >
              {create.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">Linked activities keep pipeline actions auditable and measurable.</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
              Open only
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
              Overdue only
            </label>
            <select className="rounded border px-3 py-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              <option value="call">Call</option>
              <option value="visit">Visit</option>
              <option value="email">Email</option>
              <option value="task">Task</option>
              <option value="meeting">Meeting</option>
              <option value="note">Note</option>
            </select>
            <input
              className="lg:col-span-2 rounded border px-3 py-2 text-sm"
              placeholder="Search subject…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Recent</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 py-2">
                <div>
                  <span className="font-medium">{a.subject}</span>
                  <span className="text-gray-500"> · {a.activity_type}</span>
                  {a.lead_id ? <span className="ml-2 text-xs text-gray-400">lead #{a.lead_id}</span> : null}
                  {a.due_at ? <span className="ml-2 text-xs text-gray-400">due {formatDateTime(a.due_at)}</span> : null}
                  {a.completed_at ? (
                    <span className="ml-2 text-xs text-emerald-600">done</span>
                  ) : (
                    <button type="button" className="ml-2 text-xs text-indigo-600 disabled:opacity-50" disabled={complete.isPending} onClick={() => complete.mutate(a.id)}>
                      {complete.isPending ? 'Saving…' : 'Complete'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
  )
}
