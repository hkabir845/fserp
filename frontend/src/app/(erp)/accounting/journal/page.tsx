'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'
import { useState } from 'react'

type JournalLine = {
  account_code: string
  account_name: string
  debit: number
  credit: number
  memo: string | null
}

type JournalEntry = {
  id: number
  entry_number: string
  date: string
  memo: string | null
  ref_type: string | null
  ref_id: number | null
  is_posted: boolean
  lines: JournalLine[]
}
type JournalSummary = {
  total_entries: number
  posted_entries: number
  draft_entries: number
  unbalanced_entries: number
}
type Account = { id: number; code: string; name: string; type: string }
type DraftResponse = { id: number; entry_number: string; is_posted: boolean }

function fmtMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  } catch {
    return n.toFixed(2)
  }
}

export default function JournalEntriesPage() {
  const qc = useQueryClient()
  const [postedOnly, setPostedOnly] = useState(true)
  const [entryMemo, setEntryMemo] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16))
  const [line1, setLine1] = useState({ account_id: '', debit: '', credit: '' })
  const [line2, setLine2] = useState({ account_id: '', debit: '', credit: '' })
  const [draftIdToPost, setDraftIdToPost] = useState('')
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['journal-entries', postedOnly],
    queryFn: async () => {
      const res = await api.get<JournalEntry[]>('/accounting/journal-entries', {
        params: { limit: 200, posted_only: postedOnly },
      })
      return res.data
    },
    retry: false,
  })
  const { data: summary } = useQuery({
    queryKey: ['journal-entries-summary'],
    queryFn: async () => {
      const res = await api.get<JournalSummary>('/accounting/journal-entries/summary')
      return res.data
    },
    retry: false,
  })
  const { data: accounts = [] } = useQuery({
    queryKey: ['gl-accounts-for-journal'],
    queryFn: async () => {
      const res = await api.get<Account[]>('/accounting/accounts')
      return res.data
    },
    retry: false,
  })
  const createDraft = useMutation({
    mutationFn: async () => {
      const payload = {
        date: new Date(date).toISOString(),
        memo: entryMemo || null,
        lines: [
          {
            account_id: Number(line1.account_id),
            debit: Number(line1.debit || 0),
            credit: Number(line1.credit || 0),
          },
          {
            account_id: Number(line2.account_id),
            debit: Number(line2.debit || 0),
            credit: Number(line2.credit || 0),
          },
        ],
      }
      const res = await api.post<DraftResponse>('/accounting/journal-entries/draft', payload)
      return res.data
    },
    onSuccess: (data) => {
      setDraftIdToPost(String(data.id))
      qc.invalidateQueries({ queryKey: ['journal-entries'] })
      qc.invalidateQueries({ queryKey: ['journal-entries-summary'] })
    },
  })
  const postDraft = useMutation({
    mutationFn: async () => {
      const res = await api.post<DraftResponse>(`/accounting/journal-entries/${Number(draftIdToPost)}/post`)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] })
      qc.invalidateQueries({ queryKey: ['journal-entries-summary'] })
    },
  })

  const err = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  const mutationError =
    (createDraft.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (postDraft.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail

  return (
    <div className="max-w-5xl space-y-6">
      <ReportingHubBreadcrumb current="Journal entries" />
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Journal entries</h1>
        <p className="mt-1 text-sm text-gray-600">
          Posted journals from invoices, bills, manufacturing, sales, and fuel (read-only).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total entries</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{summary?.total_entries ?? data.length}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Posted</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-700">{summary?.posted_entries ?? 0}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Draft</div>
          <div className="mt-2 text-2xl font-semibold text-amber-700">{summary?.draft_entries ?? 0}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Unbalanced</div>
          <div className="mt-2 text-2xl font-semibold text-rose-700">{summary?.unbalanced_entries ?? 0}</div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={postedOnly} onChange={(e) => setPostedOnly(e.target.checked)} />
          Show posted entries only
        </label>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Manual journal controls</h2>
        <p className="mt-1 text-xs text-gray-500">Create balanced two-line drafts, then post them after review.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={entryMemo}
            onChange={(e) => setEntryMemo(e.target.value)}
            placeholder="Memo (optional)"
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <select value={line1.account_id} onChange={(e) => setLine1((v) => ({ ...v, account_id: e.target.value }))} className="rounded border border-gray-300 px-3 py-2 text-sm">
            <option value="">Line 1 account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <input value={line1.debit} onChange={(e) => setLine1((v) => ({ ...v, debit: e.target.value }))} placeholder="Debit" className="rounded border border-gray-300 px-3 py-2 text-sm" />
          <input value={line1.credit} onChange={(e) => setLine1((v) => ({ ...v, credit: e.target.value }))} placeholder="Credit" className="rounded border border-gray-300 px-3 py-2 text-sm" />
          <select value={line2.account_id} onChange={(e) => setLine2((v) => ({ ...v, account_id: e.target.value }))} className="rounded border border-gray-300 px-3 py-2 text-sm">
            <option value="">Line 2 account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <input value={line2.debit} onChange={(e) => setLine2((v) => ({ ...v, debit: e.target.value }))} placeholder="Debit" className="rounded border border-gray-300 px-3 py-2 text-sm" />
          <input value={line2.credit} onChange={(e) => setLine2((v) => ({ ...v, credit: e.target.value }))} placeholder="Credit" className="rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => createDraft.mutate()}
            disabled={createDraft.isPending}
            className="rounded bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {createDraft.isPending ? 'Creating…' : 'Create draft journal'}
          </button>
          <input
            value={draftIdToPost}
            onChange={(e) => setDraftIdToPost(e.target.value)}
            placeholder="Draft ID to post"
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => postDraft.mutate()}
            disabled={!draftIdToPost.trim() || postDraft.isPending}
            className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {postDraft.isPending ? 'Posting…' : 'Post draft'}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {typeof err === 'string' ? err : 'Could not load journal entries (tenant required).'}
        </div>
      )}
      {mutationError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{mutationError}</div>
      )}

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {!isLoading && !error && data.length === 0 && (
        <p className="text-sm text-gray-500">No journal entries yet for this company.</p>
      )}

      <div className="space-y-6">
        {data.map((je) => (
          <div key={je.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
              <div>
                <span className="font-mono text-sm font-semibold text-indigo-700">{je.entry_number}</span>
                <span className="ml-3 text-sm text-gray-600">
                  {formatDateOnly(je.date)}
                </span>
                {!je.is_posted && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">Draft</span>
                )}
              </div>
              {je.memo && <p className="text-sm text-gray-700">{je.memo}</p>}
            </div>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-white">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Account</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">Debit</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {je.lines.map((ln, i) => (
                  <tr key={`${je.id}-${i}`}>
                    <td className="px-4 py-2">
                      <span className="font-mono text-gray-600">{ln.account_code}</span>{' '}
                      <span className="text-gray-900">{ln.account_name}</span>
                      {ln.memo && <span className="ml-2 text-xs text-gray-400">— {ln.memo}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                      {ln.debit > 0 ? fmtMoney(ln.debit) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                      {ln.credit > 0 ? fmtMoney(ln.credit) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
