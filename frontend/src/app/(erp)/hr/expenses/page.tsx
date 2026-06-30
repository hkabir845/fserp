'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Line = { category: string; amount: number; description?: string }
type Claim = {
  id: number
  claim_number: string
  status: string
  purpose: string | null
  lines: { amount: number; category: string }[]
}

const CATS = [
  { v: 'transport', l: 'Transport' },
  { v: 'fuel', l: 'Fuel' },
  { v: 'meals_breakfast', l: 'Breakfast' },
  { v: 'meals_lunch', l: 'Lunch' },
  { v: 'meals_dinner', l: 'Dinner' },
  { v: 'lodging', l: 'Lodging' },
  { v: 'toll', l: 'Toll / road' },
  { v: 'parking', l: 'Parking' },
  { v: 'other', l: 'Other' },
]

export default function ExpenseClaimsPage() {
  const qc = useQueryClient()
  const [purpose, setPurpose] = useState('')
  const [line, setLine] = useState<Line>({ category: 'transport', amount: 0, description: '' })

  const { data: claims = [], error } = useQuery({
    queryKey: ['expense-claims'],
    queryFn: async () => {
      const res = await api.get<Claim[]>('/expenses/claims?mine_only=true')
      return res.data
    },
    retry: false,
  })

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post('/expenses/claims', {
        purpose: purpose || null,
        lines: [{ category: line.category, amount: line.amount, description: line.description }],
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-claims'] })
      setPurpose('')
    },
  })

  const submit = useMutation({
    mutationFn: async (id: number) => {
      await api.post(`/expenses/claims/${id}/submit`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-claims'] }),
  })

  return (
          <div className="max-w-4xl space-y-6">
        <ReportingHubBreadcrumb current="Expense claims" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Expense claims</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Submit costs incurred for customers: travel, meals, fuel, tolls. Attach receipt references in descriptions (file upload can be wired to storage).
          </p>
        </div>

        {error ? (
          <div className="erp-alert-warning">
            {(error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
              'Select a tenant company to use expense claims.'}
          </div>
        ) : null}

        <div className="erp-panel">
          <h2 className="text-sm font-semibold text-foreground">New draft claim</h2>
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Purpose (e.g. client visit — Farm ABC)"
            className="mt-3 w-full rounded-md border border-border px-3 py-2 text-sm"
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <select
              value={line.category}
              onChange={(e) => setLine((l) => ({ ...l, category: e.target.value }))}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              {CATS.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.l}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={line.amount || ''}
              onChange={(e) => setLine((l) => ({ ...l, amount: Number(e.target.value) }))}
              placeholder="Amount"
              className="rounded-md border border-border px-3 py-2 text-sm"
            />
            <input
              value={line.description}
              onChange={(e) => setLine((l) => ({ ...l, description: e.target.value }))}
              placeholder="Receipt / notes"
              className="rounded-md border border-border px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={line.amount <= 0 || create.isPending}
            onClick={() => create.mutate()}
            className="erp-btn-primary mt-3 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Save draft
          </button>
        </div>

        <div className="space-y-3">
          {claims.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white p-4">
              <div>
                <div className="font-mono text-sm font-semibold text-foreground">{c.claim_number}</div>
                <div className="text-xs text-muted-foreground">{c.purpose || '—'}</div>
                <div className="text-sm text-foreground/85">
                  {c.lines?.map((l) => l.category).join(', ')} ·{' '}
                  {c.lines?.reduce((s, l) => s + l.amount, 0).toFixed(2)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">{c.status}</span>
                {c.status === 'draft' ? (
                  <button
                    type="button"
                    onClick={() => submit.mutate(c.id)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/40"
                  >
                    Submit
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
  )
}
