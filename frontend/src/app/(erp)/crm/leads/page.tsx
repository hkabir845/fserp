'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Lead = {
  id: number
  name: string
  company_name: string | null
  email: string | null
  phone: string | null
  source: string | null
  stage: string
  estimated_value: string | null
  next_action: string | null
  notes: string | null
}
type CrmSummary = {
  total_leads: number
  stages: Record<string, number>
  open_activities: number
  overdue_open_activities: number
}

export default function CrmLeadsPage() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [stage, setStage] = useState('new')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')

  const { data: leads = [], isLoading, error } = useQuery({
    queryKey: ['crm-leads', stageFilter, search],
    queryFn: async () => {
      const res = await api.get<Lead[]>('/crm/leads', {
        params: {
          stage: stageFilter || undefined,
          search: search.trim() || undefined,
        },
      })
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

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post('/crm/leads', {
        name,
        company_name: company || null,
        stage,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-leads'] })
      setName('')
      setCompany('')
    },
  })

  return (
          <div className="max-w-6xl space-y-6">
        <ReportingHubBreadcrumb current="CRM leads" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads & pipeline</h1>
          <p className="mt-1 text-sm text-gray-600">
            Track prospects for mash, pellet, crumble, and specialty feeds — assign stages as you qualify opportunities.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total leads</div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">{summary?.total_leads ?? leads.length}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Won</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-700">{summary?.stages?.won ?? 0}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Open activities</div>
            <div className="mt-2 text-2xl font-semibold text-indigo-700">{summary?.open_activities ?? 0}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Overdue activities</div>
            <div className="mt-2 text-2xl font-semibold text-rose-700">{summary?.overdue_open_activities ?? 0}</div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">New lead</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contact name *"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Company / farm"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="new">New</option>
              <option value="qualified">Qualified</option>
              <option value="proposal">Proposal</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>
          <button
            type="button"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Add lead
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {(error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
              'Could not load CRM (select a tenant company, not Master mode).'}
          </div>
        ) : null}

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, company, email, phone…"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All stages</option>
              <option value="new">New</option>
              <option value="qualified">Qualified</option>
              <option value="proposal">Proposal</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {isLoading ? (
            <div className="p-6 text-sm text-gray-500">Loading…</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Stage</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Next action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{l.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{l.company_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{l.stage}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{l.next_action || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
  )
}
