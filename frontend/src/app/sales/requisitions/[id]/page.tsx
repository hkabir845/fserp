'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'

type SRDetail = {
  id: number
  doc_number: string
  customer_id: number
  status: string
  purpose?: string | null
  converted_invoice_id: number | null
  created_by: number | null
  lines: { id: number; item_id: number; qty: number; unit_price: number }[]
}

type LogRow = { id: number; action: string; notes: string | null; actor_user_id: number; created_at: string }

export default function SalesRequisitionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const qc = useQueryClient()
  const id = Number(params.id)
  const [notes, setNotes] = useState('')

  const qDetail = useQuery({
    queryKey: ['sales-requisition', id],
    queryFn: async () => (await api.get(`/requisitions/sales/${id}`)).data as SRDetail,
    enabled: Number.isFinite(id),
  })

  const qLog = useQuery({
    queryKey: ['sales-requisition-log', id],
    queryFn: async () => (await api.get(`/requisitions/sales/${id}/approval-log`)).data as LogRow[],
    enabled: Number.isFinite(id),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['sales-requisition', id] })
    qc.invalidateQueries({ queryKey: ['sales-requisition-log', id] })
    qc.invalidateQueries({ queryKey: ['sales-requisitions'] })
    qc.invalidateQueries({ queryKey: ['requisitions-inbox'] })
  }

  const submitMut = useMutation({
    mutationFn: () => api.post(`/requisitions/sales/${id}/submit`, { notes: notes || null }),
    onSuccess: () => {
      setNotes('')
      invalidate()
    },
  })

  const approveMut = useMutation({
    mutationFn: () => api.post(`/requisitions/sales/${id}/approve`, { notes: notes || null }),
    onSuccess: () => {
      setNotes('')
      invalidate()
    },
  })

  const rejectMut = useMutation({
    mutationFn: () => api.post(`/requisitions/sales/${id}/reject`, { notes: notes || null }),
    onSuccess: () => {
      setNotes('')
      invalidate()
    },
  })

  const convertMut = useMutation({
    mutationFn: () =>
      api.post(`/requisitions/sales/${id}/convert-invoice`, {
        invoice_date: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      invalidate()
      router.push('/sales/invoices')
    },
  })

  if (!Number.isFinite(id) || qDetail.isError) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Requisition not found.{' '}
        <Link href="/sales/requisitions" className="text-primary">
          Back
        </Link>
      </div>
    )
  }

  if (qDetail.isLoading || !qDetail.data) {
    return <div className="p-8 text-center text-muted-foreground">Loading…</div>
  }

  const r = qDetail.data
  const err =
    (submitMut.error as any)?.response?.data?.detail ||
    (approveMut.error as any)?.response?.data?.detail ||
    (rejectMut.error as any)?.response?.data?.detail ||
    (convertMut.error as any)?.response?.data?.detail

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl">
      <Link href="/sales/requisitions" className="text-sm font-medium text-primary hover:text-primary">
        ← All sales requisitions
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-foreground">{r.doc_number}</h1>
      <p className="text-sm text-muted-foreground">Customer #{r.customer_id} · {r.status.replace(/_/g, ' ')}</p>

      {r.purpose && <p className="mt-3 text-sm text-foreground/85">{r.purpose}</p>}

      <div className="mt-6 rounded-lg border border-border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Lines</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {r.lines.map((l) => (
            <li key={l.id} className="flex justify-between text-foreground/85">
              <span>Item #{l.item_id}</span>
              <span>
                {l.qty} @ {l.unit_price}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </div>

      {err && <p className="mt-2 text-sm text-destructive">{typeof err === 'string' ? err : JSON.stringify(err)}</p>}

      <div className="mt-6 flex flex-wrap gap-2">
        {r.status === 'draft' && (
          <button
            type="button"
            disabled={submitMut.isPending}
            onClick={() => submitMut.mutate()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-accent0 disabled:opacity-50"
          >
            Submit for approval
          </button>
        )}
        {(r.status === 'pending_dept_head' || r.status === 'pending_executive') && (
          <>
            <button
              type="button"
              disabled={approveMut.isPending}
              onClick={() => approveMut.mutate()}
              className="rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
            >
              Approve step
            </button>
            <button
              type="button"
              disabled={rejectMut.isPending}
              onClick={() => rejectMut.mutate()}
              className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}
        {r.status === 'approved' && !r.converted_invoice_id && (
          <button
            type="button"
            disabled={convertMut.isPending}
            onClick={() => convertMut.mutate()}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white hover:bg-foreground disabled:opacity-50"
          >
            Create draft sales invoice
          </button>
        )}
        {r.converted_invoice_id && (
          <span className="text-sm text-muted-foreground">Linked invoice #{r.converted_invoice_id} — see Sales invoices list.</span>
        )}
      </div>

      <div className="mt-10">
        <h2 className="text-sm font-semibold text-foreground">Approval log</h2>
        <ul className="mt-2 space-y-2 text-sm text-foreground/85">
          {(qLog.data || []).map((row) => (
            <li key={row.id} className="rounded border border-border/70 bg-muted/40/80 px-3 py-2">
              <span className="font-medium">{row.action.replace(/_/g, ' ')}</span>
              <span className="text-muted-foreground"> · user #{row.actor_user_id}</span>
              {row.notes && <p className="mt-1 text-muted-foreground">{row.notes}</p>}
            </li>
          ))}
          {qLog.data?.length === 0 && <li className="text-muted-foreground">No events yet.</li>}
        </ul>
      </div>
    </div>
  )
}
