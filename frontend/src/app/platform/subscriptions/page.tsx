'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly, formatDateTime } from '@/utils/date'

type BillingCycle = 'monthly' | 'yearly'

type SubscriptionStatus = 'trial' | 'active' | 'suspended' | 'cancelled' | 'expired'

interface Plan {
  id: number
  name: string
  plan_type: string
  description?: string | null
  price_monthly: number
  price_yearly?: number | null
  max_users?: number | null
  max_storage_gb?: number | null
  is_active: boolean
}

interface TenantSubscription {
  id: number
  tenant_id: number
  tenant_name?: string | null
  tenant_domain?: string | null
  plan_id: number
  plan_name?: string | null
  status: SubscriptionStatus
  start_date: string
  end_date?: string | null
  trial_end_date?: string | null
  auto_renew: boolean
  billing_cycle: BillingCycle
  created_at: string
  updated_at: string
}

const STATUS_META: Record<SubscriptionStatus, { label: string; cls: string }> = {
  trial: { label: 'Trial', cls: 'bg-blue-100 text-primary border-primary/25' },
  active: { label: 'Active', cls: 'bg-success/15 text-success border-success/25' },
  suspended: { label: 'Suspended', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-destructive/10 text-destructive border-destructive/25' },
  expired: { label: 'Expired', cls: 'bg-muted text-foreground border-border' },
}

/** Top accent bar on card view (no shadow — color only) */
const STATUS_STRIPE: Record<SubscriptionStatus, string> = {
  trial: 'bg-blue-500',
  active: 'bg-emerald-500',
  suspended: 'bg-warning/100',
  cancelled: 'bg-destructive/50',
  expired: 'bg-muted-foreground/50',
}

export default function PlatformSubscriptionsPage() {
  const qc = useQueryClient()

  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | SubscriptionStatus>('all')
  const [planId, setPlanId] = useState<'all' | number>('all')
  const [cycle, setCycle] = useState<'all' | BillingCycle>('all')

  const [editing, setEditing] = useState<TenantSubscription | null>(null)
  const [subsView, setSubsView] = useState<'list' | 'cards'>('list')

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['platform-plans'],
    queryFn: async () => {
      const res = await api.get('/platform/plans')
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const {
    data: subs = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<TenantSubscription[]>({
    queryKey: ['platform-subscriptions', q, status, planId, cycle],
    queryFn: async () => {
      const params: any = { limit: 200 }
      if (q.trim()) params.q = q.trim()
      if (status !== 'all') params.status = status
      if (planId !== 'all') params.plan_id = planId
      if (cycle !== 'all') params.billing_cycle = cycle
      const res = await api.get('/platform/subscriptions', { params })
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const stats = useMemo(() => {
    const total = subs.length
    const active = subs.filter((s) => s.status === 'active').length
    const trial = subs.filter((s) => s.status === 'trial').length
    const suspended = subs.filter((s) => s.status === 'suspended').length
    const overdueHint = subs.filter((s) => s.status === 'cancelled' || s.status === 'expired').length
    return { total, active, trial, suspended, overdueHint }
  }, [subs])

  const updateMutation = useMutation({
    mutationFn: async (payload: Partial<TenantSubscription> & { id: number }) => {
      const { id, ...body } = payload
      const res = await api.patch(`/platform/subscriptions/${id}`, {
        plan_id: body.plan_id,
        status: body.status,
        start_date: body.start_date,
        end_date: body.end_date,
        trial_end_date: body.trial_end_date,
        auto_renew: body.auto_renew,
        billing_cycle: body.billing_cycle,
      })
      return res.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['platform-subscriptions'] })
      setEditing(null)
    },
  })

  const errorMsg = useMemo(() => {
    const e: any = error
    return e?.response?.data?.detail || e?.message || 'Failed to load subscriptions.'
  }, [error])

  return (
          <div className="py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Subscriptions</h1>
              <p className="mt-2 text-muted-foreground">Manage tenant billing status, plan assignment, and renewal settings.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => refetch()}
                className="inline-flex items-center rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <StatCard title="Total" value={stats.total} accent="border-purple-500" />
            <StatCard title="Active" value={stats.active} accent="border-green-500" />
            <StatCard title="Trial" value={stats.trial} accent="border-blue-500" />
            <StatCard title="Suspended" value={stats.suspended} accent="border-yellow-500" />
            <StatCard title="Cancelled/Expired" value={stats.overdueHint} accent="border-border/500" />
          </div>

          <div className="mb-6 overflow-hidden rounded-xl border border-border bg-white">
            <div className="border-b border-border bg-muted/40/90 px-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Search</label>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Tenant name, domain, plan..."
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-purple-500 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-purple-500 focus:ring-purple-500"
                  >
                    <option value="all">All</option>
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Plan</label>
                  <select
                    value={planId}
                    onChange={(e) => setPlanId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-purple-500 focus:ring-purple-500"
                  >
                    <option value="all">All</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Billing cycle</label>
                  <select
                    value={cycle}
                    onChange={(e) => setCycle(e.target.value as any)}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-purple-500 focus:ring-purple-500"
                  >
                    <option value="all">All</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="p-10 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
                <div className="mt-3 text-sm text-muted-foreground">Loading subscriptions…</div>
              </div>
            ) : isError ? (
              <div className="p-8">
                <div className="rounded-md border border-destructive/25 bg-destructive/5 p-4">
                  <div className="text-sm font-semibold text-destructive">Could not load subscriptions</div>
                  <div className="mt-1 text-sm text-destructive">{errorMsg}</div>
                  <button
                    onClick={() => refetch()}
                    className="mt-3 inline-flex items-center rounded-md border border-destructive/30 bg-white px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/5"
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : subs.length === 0 ? (
              <div className="p-10 text-center">
                <div className="text-lg font-semibold text-foreground">No subscriptions found</div>
                <div className="mt-2 text-sm text-muted-foreground">Seed demo data or adjust your filters.</div>
              </div>
            ) : (
              <>
                <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border bg-white px-4 py-2.5">
                  <span className="text-sm font-medium text-foreground">
                    {subs.length} subscription{subs.length === 1 ? '' : 's'}
                  </span>
                  <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
                    <button
                      type="button"
                      onClick={() => setSubsView('list')}
                      className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                        subsView === 'list' ? 'bg-purple-600 text-white' : 'text-muted-foreground hover:bg-white'
                      }`}
                    >
                      List
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubsView('cards')}
                      className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                        subsView === 'cards' ? 'bg-purple-600 text-white' : 'text-muted-foreground hover:bg-white'
                      }`}
                    >
                      Cards
                    </button>
                  </div>
                </div>
                {subsView === 'list' ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-border">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tenant</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plan</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Billing</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Renewal</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Updated</th>
                          <th className="px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-white">
                        {subs.map((s) => (
                          <tr key={s.id} className="hover:bg-muted/40">
                            <td className="px-6 py-4">
                              <div className="text-sm font-semibold text-foreground">{s.tenant_name || `Tenant #${s.tenant_id}`}</div>
                              <div className="text-xs text-muted-foreground">{s.tenant_domain || '-'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-foreground">{s.plan_name || `Plan #${s.plan_id}`}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_META[s.status]?.cls || 'bg-muted text-foreground border-border'}`}
                              >
                                {STATUS_META[s.status]?.label || s.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm capitalize text-foreground">{s.billing_cycle}</div>
                              <div className="text-xs text-muted-foreground">Start: {fmtDate(s.start_date)}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-foreground">{s.auto_renew ? 'Auto-renew' : 'Manual'}</div>
                              <div className="text-xs text-muted-foreground">End: {s.end_date ? fmtDate(s.end_date) : '—'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">{fmtDateTime(s.updated_at)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <button
                                type="button"
                                onClick={() => setEditing(s)}
                                className="font-semibold text-purple-700 hover:text-purple-900"
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="bg-muted/40/50 p-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {subs.map((s) => (
                        <div
                          key={s.id}
                          className="flex flex-col overflow-hidden rounded-xl border border-border bg-white"
                        >
                          <div className={`h-1.5 w-full ${STATUS_STRIPE[s.status] || 'bg-muted-foreground/50'}`} aria-hidden />
                          <div className="flex flex-1 flex-col p-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-base font-semibold text-foreground">
                                  {s.tenant_name || `Tenant #${s.tenant_id}`}
                                </div>
                                <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{s.tenant_domain || '—'}</div>
                              </div>
                              <span
                                className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_META[s.status]?.cls || 'bg-muted text-foreground border-border'}`}
                              >
                                {STATUS_META[s.status]?.label || s.status}
                              </span>
                            </div>
                            <div className="mt-3">
                              <span className="inline-flex max-w-full items-center rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-900">
                                {s.plan_name || `Plan #${s.plan_id}`}
                              </span>
                            </div>
                            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border/70 pt-3 text-xs">
                              <div>
                                <dt className="font-medium text-muted-foreground">Billing</dt>
                                <dd className="mt-0.5 font-semibold capitalize text-foreground">{s.billing_cycle}</dd>
                              </div>
                              <div>
                                <dt className="font-medium text-muted-foreground">Renewal</dt>
                                <dd className="mt-0.5 font-semibold text-foreground">{s.auto_renew ? 'Auto' : 'Manual'}</dd>
                              </div>
                              <div className="col-span-2">
                                <dt className="font-medium text-muted-foreground">Period</dt>
                                <dd className="mt-0.5 text-foreground">
                                  {fmtDate(s.start_date)}
                                  {s.end_date ? ` → ${fmtDate(s.end_date)}` : ' → open'}
                                </dd>
                              </div>
                              {s.trial_end_date && (
                                <div className="col-span-2">
                                  <dt className="font-medium text-muted-foreground">Trial ends</dt>
                                  <dd className="mt-0.5 text-foreground">{fmtDate(s.trial_end_date)}</dd>
                                </div>
                              )}
                              <div className="col-span-2 text-muted-foreground">
                                Updated {fmtDateTime(s.updated_at)}
                              </div>
                            </dl>
                            <button
                              type="button"
                              onClick={() => setEditing(s)}
                              className="mt-4 w-full rounded-lg border border-purple-200 bg-purple-50 py-2 text-sm font-semibold text-purple-800 hover:bg-purple-100"
                            >
                              Manage subscription
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {editing && (
            <EditSubscriptionModal
              sub={editing}
              plans={plans}
              isSaving={updateMutation.isPending}
              errorMsg={(updateMutation.error as any)?.response?.data?.detail || (updateMutation.error as any)?.message}
              onClose={() => setEditing(null)}
              onSave={(patch) => updateMutation.mutate({ id: editing.id, ...patch })}
            />
          )}
        </div>
      </div>
  )
}

function StatCard({ title, value, accent }: { title: string; value: number; accent: string }) {
  return (
    <div className={`rounded-lg border border-border bg-white p-6 border-l-4 ${accent}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
        </div>
        <div className="rounded-full bg-purple-100 p-3 ring-1 ring-purple-200/60">
          <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
            />
          </svg>
        </div>
      </div>
    </div>
  )
}

function EditSubscriptionModal({
  sub,
  plans,
  onClose,
  onSave,
  isSaving,
  errorMsg,
}: {
  sub: TenantSubscription
  plans: Plan[]
  onClose: () => void
  onSave: (patch: Partial<TenantSubscription>) => void
  isSaving: boolean
  errorMsg?: string
}) {
  const [status, setStatus] = useState<SubscriptionStatus>(sub.status)
  const [planId, setPlanId] = useState<number>(sub.plan_id)
  const [billing, setBilling] = useState<BillingCycle>(sub.billing_cycle)
  const [autoRenew, setAutoRenew] = useState<boolean>(sub.auto_renew)

  const [start, setStart] = useState<string>(toLocalInput(sub.start_date))
  const [trialEnd, setTrialEnd] = useState<string>(sub.trial_end_date ? toLocalInput(sub.trial_end_date) : '')
  const [end, setEnd] = useState<string>(sub.end_date ? toLocalInput(sub.end_date) : '')

  const canSave = planId && status && billing

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-white">
        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
          <div>
            <div className="text-lg font-bold text-foreground">Manage subscription</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {sub.tenant_name || `Tenant #${sub.tenant_id}`} · {sub.tenant_domain || '-'}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground/85">
            ✕
          </button>
        </div>

        <div className="px-6 py-5">
          {errorMsg && (
            <div className="mb-4 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{errorMsg}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground">Plan</label>
              <select
                value={planId}
                onChange={(e) => setPlanId(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              >
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="cancelled">Cancelled</option>
                <option value="expired">Expired</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground">Billing cycle</label>
              <select
                value={billing}
                onChange={(e) => setBilling(e.target.value as BillingCycle)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <input
                id="auto_renew"
                type="checkbox"
                checked={autoRenew}
                onChange={(e) => setAutoRenew(e.target.checked)}
                className="h-4 w-4 rounded border-border text-purple-600"
              />
              <label htmlFor="auto_renew" className="text-sm font-semibold text-foreground/85">
                Auto-renew
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground">Start date</label>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground">Trial end date (optional)</label>
              <input
                type="datetime-local"
                value={trialEnd}
                onChange={(e) => setTrialEnd(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground">End date (optional)</label>
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-6 rounded-md border border-border bg-muted/40 p-4 text-sm text-foreground/85">
            <div className="font-semibold text-foreground mb-2">Audit</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>Created: {fmtDateTime(sub.created_at)}</div>
              <div>Updated: {fmtDateTime(sub.updated_at)}</div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
          >
            Cancel
          </button>
          <button
            disabled={!canSave || isSaving}
            onClick={() =>
              onSave({
                plan_id: planId,
                status,
                billing_cycle: billing,
                auto_renew: autoRenew,
                start_date: fromLocalInput(start),
                trial_end_date: trialEnd ? fromLocalInput(trialEnd) : null,
                end_date: end ? fromLocalInput(end) : null,
              })
            }
            className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function fmtDate(iso: string) {
  return formatDateOnly(iso)
}

function fmtDateTime(iso: string) {
  return formatDateTime(iso)
}

function toLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const mi = pad(d.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

function fromLocalInput(local: string) {
  // interpret as local time, send as ISO
  const d = new Date(local)
  return d.toISOString()
}
