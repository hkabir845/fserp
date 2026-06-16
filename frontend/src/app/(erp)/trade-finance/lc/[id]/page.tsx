'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'

type DocRow = { code: string; label: string; status?: string }

type Amendment = {
  id: number
  lc_id: number
  amendment_no: number
  effective_date: string
  summary: string
  detail: string | null
  amount_before: number | null
  amount_after: number | null
}

type LCDetail = {
  id: number
  lc_internal_number: string
  bank_lc_reference: string | null
  direction: string
  deal_type: string
  status: string
  applicant_name: string
  applicant_address: string | null
  beneficiary_name: string
  beneficiary_address: string | null
  beneficiary_country: string | null
  issuing_bank_name: string
  issuing_bank_branch: string | null
  issuing_bank_swift: string | null
  advising_bank_name: string | null
  advising_bank_swift: string | null
  confirming_bank_name: string | null
  currency_code: string
  amount: number
  tolerance_pct_plus: number | null
  tolerance_pct_minus: number | null
  incoterm: string | null
  partial_shipment_allowed: boolean
  transshipment_allowed: boolean
  latest_shipment_date: string | null
  expiry_date: string | null
  presentation_period_days: number | null
  goods_description: string
  goods_category: string
  hs_codes: string | null
  bin_tin: string | null
  irc_number: string | null
  erc_number: string | null
  feed_reg_license_ref: string | null
  bangladesh_bank_reporting_ref: string | null
  bank_lodgment_reference: string | null
  insurers_cover_note: string | null
  margin_pct: number | null
  charges_account_party: string | null
  supplier_id: number | null
  customer_id: number | null
  purchase_order_id: number | null
  documents_required: DocRow[] | null
  compliance_notes: string | null
  internal_notes: string | null
  amendments: Amendment[]
}

const STATUSES = [
  'draft',
  'bank_review',
  'opened',
  'advised',
  'amended',
  'docs_in_review',
  'negotiated',
  'settled',
  'closed',
  'cancelled',
]

export default function LCDetailPage() {
  const params = useParams()
  const id = Number(params.id)
  const qc = useQueryClient()

  const { data: lc, isLoading, isError, error } = useQuery<LCDetail>({
    queryKey: ['lc', id],
    queryFn: async () => (await api.get(`/lc/${id}`)).data,
    enabled: !!id,
    retry: false,
  })

  const statusMut = useMutation({
    mutationFn: async (newStatus: string) => (await api.post(`/lc/${id}/status/${newStatus}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lc', id] }),
  })

  const amendMut = useMutation({
    mutationFn: async (body: { effective_date: string; summary: string; detail?: string; amount_before?: number; amount_after?: number }) =>
      (await api.post(`/lc/${id}/amendments`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lc', id] })
      setShowAmend(false)
    },
  })

  const docMut = useMutation({
    mutationFn: async (docs: DocRow[]) => (await api.patch(`/lc/${id}`, { documents_required: docs })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lc', id] }),
  })

  const [showAmend, setShowAmend] = useState(false)
  const [amendForm, setAmendForm] = useState({
    effective_date: new Date().toISOString().slice(0, 10),
    summary: '',
    detail: '',
    amount_before: '',
    amount_after: '',
  })

  const cycleDoc = (code: string) => {
    if (!lc?.documents_required) return
    const next = lc.documents_required.map((d) => {
      if (d.code !== code) return d
      const order = ['pending', 'presented', 'accepted', 'discrepant']
      const i = order.indexOf(d.status || 'pending')
      const ns = order[(i + 1) % order.length]
      return { ...d, status: ns }
    })
    docMut.mutate(next)
  }

  if (isLoading) {
    return (
              <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray-500">Loading LC…</div>
    )
  }

  if (isError || !lc) {
    return (
              <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          {(error as Error)?.message || 'Not found'}
          <div className="mt-3">
            <Link href="/trade-finance/lc" className="font-medium text-indigo-600">
              ← Back
            </Link>
          </div>
        </div>
    )
  }

  return (
          <div className="mx-auto max-w-5xl space-y-6 pb-16">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/trade-finance/lc" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
              ← LC register
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900 font-mono">{lc.lc_internal_number}</h1>
              <span
                className={
                  lc.direction === 'import'
                    ? 'rounded-md bg-blue-100 px-2 py-0.5 text-xs font-bold uppercase text-blue-800'
                    : 'rounded-md bg-teal-100 px-2 py-0.5 text-xs font-bold uppercase text-teal-800'
                }
              >
                {lc.direction}
              </span>
              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">{lc.deal_type}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {lc.beneficiary_name}
              {lc.bank_lc_reference ? <span className="ml-2 font-mono text-gray-500">· Bank ref {lc.bank_lc_reference}</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800"
              value={lc.status}
              onChange={(e) => statusMut.mutate(e.target.value)}
              disabled={statusMut.isPending}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowAmend((v) => !v)}
              className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100"
            >
              + Amendment
            </button>
          </div>
        </div>

        {showAmend && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
            <h3 className="text-sm font-semibold text-indigo-900">Record amendment (bank advice)</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-gray-600">Effective date</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  value={amendForm.effective_date}
                  onChange={(e) => setAmendForm({ ...amendForm, effective_date: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-600">Summary *</label>
                <input
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  placeholder="e.g. Extension of shipment date; +10% tolerance"
                  value={amendForm.summary}
                  onChange={(e) => setAmendForm({ ...amendForm, summary: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-600">Detail</label>
                <textarea className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" rows={2} value={amendForm.detail} onChange={(e) => setAmendForm({ ...amendForm, detail: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Amount before</label>
                <input className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" value={amendForm.amount_before} onChange={(e) => setAmendForm({ ...amendForm, amount_before: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Amount after</label>
                <input className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" value={amendForm.amount_after} onChange={(e) => setAmendForm({ ...amendForm, amount_after: e.target.value })} />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={!amendForm.summary.trim() || amendMut.isPending}
                onClick={() =>
                  amendMut.mutate({
                    effective_date: new Date(amendForm.effective_date + 'T12:00:00').toISOString(),
                    summary: amendForm.summary.trim(),
                    detail: amendForm.detail.trim() || undefined,
                    amount_before: amendForm.amount_before ? Number(amendForm.amount_before) : undefined,
                    amount_after: amendForm.amount_after ? Number(amendForm.amount_after) : undefined,
                  })
                }
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Save amendment
              </button>
              <button type="button" onClick={() => setShowAmend(false)} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Commercial</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-500">Amount</dt>
                <dd className="font-mono text-lg font-bold text-gray-900">
                  {lc.currency_code} {lc.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Incoterm</dt>
                <dd className="font-semibold text-gray-900">{lc.incoterm || '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Expiry</dt>
                <dd className="text-gray-900">{lc.expiry_date ? formatDateOnly(lc.expiry_date) : '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Latest shipment</dt>
                <dd className="text-gray-900">{lc.latest_shipment_date ? formatDateOnly(lc.latest_shipment_date) : '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Goods</dt>
                <dd className="whitespace-pre-wrap text-gray-900">{lc.goods_description}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-amber-900">Bangladesh refs</h2>
            <ul className="mt-3 space-y-2 text-xs text-amber-950">
              <li>
                <span className="font-semibold">BB / reporting:</span> {lc.bangladesh_bank_reporting_ref || '—'}
              </li>
              <li>
                <span className="font-semibold">Lodgment:</span> {lc.bank_lodgment_reference || '—'}
              </li>
              <li>
                <span className="font-semibold">IRC:</span> {lc.irc_number || '—'}
              </li>
              <li>
                <span className="font-semibold">ERC:</span> {lc.erc_number || '—'}
              </li>
              <li>
                <span className="font-semibold">BIN/TIN:</span> {lc.bin_tin || '—'}
              </li>
            </ul>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Banks</h2>
          <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <div className="font-semibold text-gray-900">{lc.issuing_bank_name}</div>
              <div className="text-gray-600">{lc.issuing_bank_branch}</div>
              <div className="font-mono text-xs text-gray-500">{lc.issuing_bank_swift}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Advising</div>
              <div className="font-semibold text-gray-900">{lc.advising_bank_name || '—'}</div>
              <div className="font-mono text-xs text-gray-500">{lc.advising_bank_swift}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Document checklist</h2>
            <span className="text-xs text-gray-500">Tap status to cycle: pending → presented → accepted</span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                  <th className="py-2 pr-4">Code</th>
                  <th className="py-2 pr-4">Document</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(lc.documents_required || []).map((d) => (
                  <tr key={d.code} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-mono text-xs">{d.code}</td>
                    <td className="py-2 pr-4">{d.label}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => cycleDoc(d.code)}
                        disabled={docMut.isPending}
                        className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-200 disabled:opacity-50"
                      >
                        {d.status || 'pending'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {lc.amendments?.length ? (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Amendments</h2>
            <ul className="mt-3 space-y-3">
              {lc.amendments.map((a) => (
                <li key={a.id} className="rounded-lg border border-gray-100 bg-gray-50/80 p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold text-gray-900">#{a.amendment_no}</span>
                    <span className="text-xs text-gray-500">{formatDateOnly(a.effective_date)}</span>
                  </div>
                  <div className="mt-1 text-gray-800">{a.summary}</div>
                  {a.detail ? <div className="mt-1 text-xs text-gray-600">{a.detail}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {(lc.compliance_notes || lc.internal_notes) && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm shadow-sm">
            {lc.compliance_notes ? (
              <div className="mb-3">
                <div className="text-xs font-bold uppercase text-gray-500">Compliance</div>
                <p className="mt-1 whitespace-pre-wrap text-gray-800">{lc.compliance_notes}</p>
              </div>
            ) : null}
            {lc.internal_notes ? (
              <div>
                <div className="text-xs font-bold uppercase text-gray-500">Internal</div>
                <p className="mt-1 whitespace-pre-wrap text-gray-800">{lc.internal_notes}</p>
              </div>
            ) : null}
          </div>
        )}
      </div>
  )
}
