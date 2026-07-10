'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import clsx from 'clsx'

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
  plan_id: number
  status: string
}

const PLANS_QUERY_KEY = ['platform-plans', 'manage'] as const

const PLAN_TYPES = ['free', 'basic', 'professional', 'enterprise', 'custom'] as const

const PLAN_THEME: Record<
  string,
  { gradient: string; ring: string; badge: string; accent: string }
> = {
  free: {
    gradient: 'from-slate-100 via-white to-slate-50',
    ring: 'ring-border/80',
    badge: 'bg-muted text-foreground/85 border-border',
    accent: 'text-muted-foreground',
  },
  basic: {
    gradient: 'from-sky-50 via-white to-cyan-50',
    ring: 'ring-sky-200/90',
    badge: 'bg-sky-100 text-sky-800 border-sky-200',
    accent: 'text-sky-700',
  },
  professional: {
    gradient: 'from-violet-50 via-white to-fuchsia-50',
    ring: 'ring-violet-400/70',
    badge: 'bg-violet-100 text-violet-900 border-violet-200',
    accent: 'text-violet-700',
  },
  enterprise: {
    gradient: 'from-accent via-white to-accent',
    ring: 'ring-indigo-300/80',
    badge: 'bg-accent text-foreground/85 border-primary/25',
    accent: 'text-primary',
  },
  custom: {
    gradient: 'from-amber-50 via-white to-orange-50',
    ring: 'ring-amber-300/70',
    badge: 'bg-amber-100 text-warning-foreground border-warning/30',
    accent: 'text-warning-foreground',
  },
}

function themeFor(planType: string) {
  const key = planType.toLowerCase()
  return PLAN_THEME[key] ?? PLAN_THEME.professional
}

/** BDT — default locale for stable SSR/browsers (same as rest of app). */
function formatBdt(n: number) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function IconPencil(props: { className?: string }) {
  return (
    <svg className={props.className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function IconTrash(props: { className?: string }) {
  return (
    <svg className={props.className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

export default function PlatformPlansPage() {
  const qc = useQueryClient()
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [hideArchived, setHideArchived] = useState(false)
  const [editing, setEditing] = useState<Plan | null>(null)
  const [archiving, setArchiving] = useState<Plan | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    data: plansRaw = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Plan[]>({
    queryKey: PLANS_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get('/platform/plans', { params: { include_inactive: true } })
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const plans = useMemo(
    () => (hideArchived ? plansRaw.filter((p) => p.is_active) : plansRaw),
    [plansRaw, hideArchived]
  )

  const { data: subs = [] } = useQuery<TenantSubscription[]>({
    queryKey: ['platform-subscriptions', 'plans-page'],
    queryFn: async () => {
      const res = await api.get('/platform/subscriptions', { params: { limit: 500 } })
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const countsByPlan = useMemo(() => {
    const map = new Map<number, { total: number; active: number }>()
    for (const s of subs) {
      const cur = map.get(s.plan_id) ?? { total: 0, active: 0 }
      cur.total += 1
      if (s.status === 'active' || s.status === 'trial') cur.active += 1
      map.set(s.plan_id, cur)
    }
    return map
  }, [subs])

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, unknown> }) => {
      const res = await api.patch(`/platform/plans/${id}`, body)
      return res.data as Plan
    },
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: PLANS_QUERY_KEY })
      const previous = qc.getQueryData<Plan[]>(PLANS_QUERY_KEY)
      qc.setQueryData<Plan[]>(PLANS_QUERY_KEY, (old) => {
        if (!old) return old
        return old.map((p) => (p.id === id ? { ...p, ...body } as Plan : p))
      })
      return { previous }
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(PLANS_QUERY_KEY, ctx.previous)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['platform-plans'] })
      qc.invalidateQueries({ queryKey: PLANS_QUERY_KEY })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: async (planId: number) => {
      const res = await api.delete(`/platform/plans/${planId}`)
      return res.data as { subscription_count?: number; message?: string }
    },
    onMutate: async (planId) => {
      await qc.cancelQueries({ queryKey: PLANS_QUERY_KEY })
      const previous = qc.getQueryData<Plan[]>(PLANS_QUERY_KEY)
      qc.setQueryData<Plan[]>(PLANS_QUERY_KEY, (old) => {
        if (!old) return old
        return old.map((p) => (p.id === planId ? { ...p, is_active: false } : p))
      })
      return { previous }
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(PLANS_QUERY_KEY, ctx.previous)
    },
    onSuccess: () => setArchiving(null),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['platform-plans'] })
      qc.invalidateQueries({ queryKey: PLANS_QUERY_KEY })
    },
  })

  const featuredId = useMemo(() => {
    const prof = plans.find((p) => p.plan_type.toLowerCase() === 'professional' && p.is_active)
    if (prof) return prof.id
    const mid = plans.filter((p) => p.is_active)[Math.floor(plans.filter((p) => p.is_active).length / 2)]
    return mid?.id
  }, [plans])

  const errDetail =
    (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ??
    (error as Error)?.message ??
    'Could not load plans.'

  const handleSaveEdit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editing) return
    setFormError(null)
    const fd = new FormData(e.currentTarget)
    const name = String(fd.get('name') || '').trim()
    const plan_type = String(fd.get('plan_type') || '')
    const description = String(fd.get('description') || '').trim() || null
    const price_monthly = Number(fd.get('price_monthly'))
    const price_yearlyRaw = fd.get('price_yearly')
    const price_yearly =
      price_yearlyRaw === '' || price_yearlyRaw === null ? null : Number(price_yearlyRaw)
    const max_usersRaw = fd.get('max_users')
    const max_users = max_usersRaw === '' || max_usersRaw === null ? null : Number(max_usersRaw)
    const max_storage_gbRaw = fd.get('max_storage_gb')
    const max_storage_gb =
      max_storage_gbRaw === '' || max_storage_gbRaw === null ? null : Number(max_storage_gbRaw)
    const is_active = fd.get('is_active') === 'on'

    if (!name) {
      setFormError('Name is required.')
      return
    }
    if (Number.isNaN(price_monthly) || price_monthly < 0) {
      setFormError('Monthly price must be a valid non-negative number.')
      return
    }

    updateMutation.mutate(
      {
        id: editing.id,
        body: {
          name,
          plan_type,
          description,
          price_monthly,
          price_yearly,
          max_users,
          max_storage_gb,
          is_active,
        },
      },
      {
        onSuccess: () => setEditing(null),
        onError: (err: unknown) => {
          const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          setFormError(typeof d === 'string' ? d : 'Update failed.')
        },
      }
    )
  }

  const subCountForArchive = archiving ? countsByPlan.get(archiving.id)?.total ?? 0 : 0

  return (
    <>
          <div className="app-scroll-pad min-h-0 bg-gradient-to-b from-muted/40 via-white to-violet-50/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-12">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-wider text-violet-600 mb-2">
                Subscription catalog
              </p>
              <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
                Plans that scale with every tenant
              </h1>
              <p className="mt-3 text-lg text-muted-foreground leading-relaxed">
                Edit pricing and limits, or archive plans you no longer sell. Archiving does not move existing tenants—
                reassign them under{' '}
                <Link href="/platform/subscriptions" className="font-semibold text-violet-700 hover:text-violet-900 underline underline-offset-2">
                  Subscriptions
                </Link>
                .
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0 flex-wrap">
              <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-white/90 px-3 py-2 text-sm text-foreground/85">
                <input
                  type="checkbox"
                  checked={hideArchived}
                  onChange={(e) => setHideArchived(e.target.checked)}
                />
                Hide archived
              </label>
              <div
                className="inline-flex rounded-xl border border-border/80 bg-white/90 p-1 shadow-sm backdrop-blur"
                role="group"
                aria-label="Billing period"
              >
                <button
                  type="button"
                  onClick={() => setCycle('monthly')}
                  className={clsx(
                    'px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                    cycle === 'monthly' ? 'bg-violet-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setCycle('yearly')}
                  className={clsx(
                    'px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                    cycle === 'yearly' ? 'bg-violet-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Yearly
                </button>
              </div>
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex justify-center items-center rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-foreground/85 hover:bg-muted/40 transition-colors"
              >
                Refresh data
              </button>
            </div>
          </div>

          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl border border-border/80 bg-white p-8 animate-pulse">
                  <div className="h-6 bg-muted rounded w-1/3 mb-4" />
                  <div className="h-10 bg-muted rounded w-2/3 mb-6" />
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded" />
                    <div className="h-4 bg-muted rounded w-5/6" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {isError && (
            <div className="rounded-2xl border border-destructive/25 bg-destructive/5/90 px-6 py-5 text-red-900">
              <p className="font-semibold">Unable to load plans</p>
              <p className="text-sm mt-1 opacity-90">{String(errDetail)}</p>
              <button type="button" onClick={() => refetch()} className="mt-4 text-sm font-semibold text-destructive underline">
                Try again
              </button>
            </div>
          )}

          {!isLoading && !isError && plansRaw.length === 0 && (
            <div className="text-center rounded-2xl border border-dashed border-border bg-white/60 px-8 py-16">
              <div className="text-4xl mb-4" aria-hidden>
                📦
              </div>
              <h2 className="text-xl font-semibold text-foreground">No plans yet</h2>
              <p className="mt-2 text-muted-foreground max-w-md mx-auto">
                Seed subscription plans in your database, then refresh this page.
              </p>
            </div>
          )}

          {!isLoading && !isError && plansRaw.length > 0 && plans.length === 0 && (
            <div className="rounded-2xl border border-warning/30 bg-warning/10/90 px-6 py-4 text-warning-foreground text-sm">
              All plans are archived. Uncheck <strong>Hide archived</strong> to see them, or restore a plan via Edit →
              &quot;Plan is active&quot;.
            </div>
          )}

          {!isLoading && !isError && plans.length > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 lg:gap-8">
                {plans.map((plan) => {
                  const t = themeFor(plan.plan_type)
                  const isFeatured = plan.id === featuredId && plan.is_active
                  const monthly = Number(plan.price_monthly) || 0
                  const yearly = plan.price_yearly != null ? Number(plan.price_yearly) : null
                  const yearlyPerMonth = yearly != null ? yearly / 12 : null
                  const displayAmount = cycle === 'monthly' ? monthly : yearlyPerMonth ?? monthly
                  const showYearlySavings =
                    cycle === 'yearly' && yearly != null && monthly > 0 && yearlyPerMonth != null
                  const annualVsMonthly = monthly * 12
                  const savingsPct =
                    showYearlySavings && annualVsMonthly > 0
                      ? Math.round((1 - yearly! / annualVsMonthly) * 100)
                      : null

                  const counts = countsByPlan.get(plan.id) ?? { total: 0, active: 0 }

                  return (
                    <article
                      key={plan.id}
                      className={clsx(
                        'relative flex flex-col rounded-2xl border bg-gradient-to-br p-8 shadow-sm transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-lg',
                        t.gradient,
                        t.ring,
                        isFeatured && 'ring-2 md:scale-[1.02] z-10',
                        !plan.is_active && 'opacity-75'
                      )}
                    >
                      <div className="absolute top-4 right-4 flex items-center gap-1">
                        <button
                          type="button"
                          title="Edit plan"
                          onClick={() => {
                            setFormError(null)
                            setEditing(plan)
                          }}
                          className="rounded-lg p-2 text-muted-foreground hover:bg-card/80 hover:text-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
                        >
                          <IconPencil className="block" />
                          <span className="sr-only">Edit</span>
                        </button>
                        {plan.is_active && (
                          <button
                            type="button"
                            title="Archive plan"
                            onClick={() => setArchiving(plan)}
                            className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/5 hover:text-destructive focus:outline-none focus:ring-2 focus:ring-red-400"
                          >
                            <IconTrash className="block" />
                            <span className="sr-only">Archive</span>
                          </button>
                        )}
                      </div>

                      {isFeatured && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-0.5 text-xs font-bold uppercase tracking-wide text-white shadow-md">
                          Most popular
                        </span>
                      )}
                      {!plan.is_active && (
                        <span className="absolute -top-3 left-4 rounded-full bg-muted-foreground px-2 py-0.5 text-xs font-bold uppercase text-white">
                          Archived
                        </span>
                      )}

                      <div className="flex items-start justify-between gap-3 mb-6 pr-16">
                        <div>
                          <span
                            className={clsx(
                              'inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize',
                              t.badge
                            )}
                          >
                            {plan.plan_type.replace('_', ' ')}
                          </span>
                          <h2 className="mt-3 text-2xl font-bold text-foreground">{plan.name}</h2>
                        </div>
                      </div>

                      <div className="mb-6">
                        <div className="flex items-baseline gap-1">
                          <span className="text-4xl font-bold tabular-nums text-foreground">{formatBdt(displayAmount)}</span>
                          <span className="text-muted-foreground font-medium">/ mo</span>
                        </div>
                        {cycle === 'yearly' && yearly != null && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {formatBdt(yearly)} billed annually
                            {savingsPct != null && savingsPct > 0 && (
                              <span className="ml-2 text-emerald-600 font-semibold">Save ~{savingsPct}%</span>
                            )}
                          </p>
                        )}
                      </div>

                      {plan.description && (
                        <p className="text-sm text-muted-foreground leading-relaxed mb-6 flex-1">{plan.description}</p>
                      )}

                      <ul className="space-y-3 mb-8 text-sm text-foreground/85">
                        <li className="flex gap-2">
                          <span className="text-emerald-500 font-bold" aria-hidden>
                            ✓
                          </span>
                          <span>
                            <strong className="text-foreground">Users:</strong>{' '}
                            {plan.max_users != null ? `Up to ${plan.max_users}` : 'Custom'}
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <span className="text-emerald-500 font-bold" aria-hidden>
                            ✓
                          </span>
                          <span>
                            <strong className="text-foreground">Storage:</strong>{' '}
                            {plan.max_storage_gb != null ? `${plan.max_storage_gb} GB` : 'Custom'}
                          </span>
                        </li>
                      </ul>

                      <div
                        className={clsx(
                          'mt-auto rounded-xl border px-4 py-3 text-sm',
                          'border-border/80 bg-white/70 backdrop-blur-sm'
                        )}
                      >
                        <p className={clsx('font-semibold', t.accent)}>Live usage</p>
                        <p className="text-foreground/85 mt-1">
                          <span className="font-bold text-foreground">{counts.total}</span> subscriptions
                          <span className="text-muted-foreground/70 mx-1">·</span>
                          <span className="font-bold text-emerald-700">{counts.active}</span> active or trial
                        </p>
                      </div>
                    </article>
                  )
                })}
              </div>

              <div className="mt-16 hidden lg:block">
                <h3 className="text-lg font-bold text-foreground mb-4">At a glance</h3>
                <div className="overflow-x-auto rounded-2xl border border-border/80 bg-white/90 shadow-sm">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-left">
                        <th className="px-4 py-4 font-semibold text-foreground/85 w-24">Actions</th>
                        <th className="px-4 py-4 font-semibold text-foreground/85">Plan</th>
                        <th className="px-4 py-4 font-semibold text-foreground/85">Type</th>
                        <th className="px-4 py-4 font-semibold text-foreground/85">Monthly</th>
                        <th className="px-4 py-4 font-semibold text-foreground/85">Yearly (total)</th>
                        <th className="px-4 py-4 font-semibold text-foreground/85">Users</th>
                        <th className="px-4 py-4 font-semibold text-foreground/85">Storage</th>
                        <th className="px-4 py-4 font-semibold text-foreground/85">Tenants</th>
                        <th className="px-4 py-4 font-semibold text-foreground/85">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((plan) => {
                        const c = countsByPlan.get(plan.id) ?? { total: 0, active: 0 }
                        const yr = plan.price_yearly != null ? Number(plan.price_yearly) : null
                        return (
                          <tr key={plan.id} className="border-b border-border/70 hover:bg-violet-50/40">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  title="Edit"
                                  onClick={() => {
                                    setFormError(null)
                                    setEditing(plan)
                                  }}
                                  className="rounded-md p-1.5 text-muted-foreground hover:bg-violet-100 hover:text-violet-800"
                                >
                                  <IconPencil />
                                  <span className="sr-only">Edit {plan.name}</span>
                                </button>
                                {plan.is_active && (
                                  <button
                                    type="button"
                                    title="Archive"
                                    onClick={() => setArchiving(plan)}
                                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <IconTrash />
                                    <span className="sr-only">Archive {plan.name}</span>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-medium text-foreground">{plan.name}</td>
                            <td className="px-4 py-3 capitalize text-muted-foreground">{plan.plan_type}</td>
                            <td className="px-4 py-3 tabular-nums">{formatBdt(Number(plan.price_monthly) || 0)}</td>
                            <td className="px-4 py-3 tabular-nums text-muted-foreground">{yr != null ? formatBdt(yr) : '—'}</td>
                            <td className="px-4 py-3">{plan.max_users ?? '—'}</td>
                            <td className="px-4 py-3">
                              {plan.max_storage_gb != null ? `${plan.max_storage_gb} GB` : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-semibold text-foreground">{c.total}</span>
                              <span className="text-muted-foreground/70"> / </span>
                              <span className="text-emerald-700 font-medium">{c.active} active</span>
                            </td>
                            <td className="px-4 py-3">
                              {plan.is_active ? (
                                <span className="text-emerald-700 font-medium">Active</span>
                              ) : (
                                <span className="text-muted-foreground">Archived</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="mt-10 text-center text-sm text-muted-foreground">
                Changes sync to the API; failed saves roll back the list automatically. Archive hides the plan from new
                sign-ups only.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editing && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-foreground/50"
          role="dialog"
          aria-modal
          onClick={() => {
            setEditing(null)
            setFormError(null)
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-foreground">Edit plan</h3>
            <p className="text-sm text-muted-foreground mt-1">Updates apply immediately for operators; tenants keep current billing until you change subscriptions.</p>
            <form onSubmit={handleSaveEdit} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Name</label>
                <input name="name" required defaultValue={editing.name} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Plan type</label>
                <select name="plan_type" defaultValue={editing.plan_type} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm capitalize">
                  {PLAN_TYPES.map((pt) => (
                    <option key={pt} value={pt}>
                      {pt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Description</label>
                <textarea name="description" rows={2} defaultValue={editing.description ?? ''} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Price (monthly) BDT</label>
                  <input
                    name="price_monthly"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    defaultValue={editing.price_monthly}
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Price (yearly total) BDT</label>
                  <input
                    name="price_yearly"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={editing.price_yearly ?? ''}
                    placeholder="Optional"
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Max users</label>
                  <input
                    name="max_users"
                    type="number"
                    min="0"
                    defaultValue={editing.max_users ?? ''}
                    placeholder="Unlimited"
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Max storage (GB)</label>
                  <input
                    name="max_storage_gb"
                    type="number"
                    min="0"
                    defaultValue={editing.max_storage_gb ?? ''}
                    placeholder="Unlimited"
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" name="is_active" defaultChecked={editing.is_active} />
                Plan is active (visible for new subscriptions)
              </label>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null)
                    setFormError(null)
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive confirm */}
      {archiving && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-foreground/50"
          role="dialog"
          aria-modal
          onClick={() => setArchiving(null)}
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-foreground">Archive this plan?</h3>
            <p className="text-sm text-muted-foreground mt-2">
              <strong className="text-foreground">{archiving.name}</strong> will be hidden from new subscriptions.
              {subCountForArchive > 0 ? (
                <>
                  {' '}
                  <strong>{subCountForArchive}</strong> subscription(s) still reference this plan—they are not changed. Reassign them
                  under Subscriptions if needed.
                </>
              ) : (
                <> No tenants are currently on this plan.</>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              You can turn edits back on later by editing the plan and checking &quot;Plan is active&quot; (rollback in the UI
              restores the previous row if the request fails).
            </p>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setArchiving(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => archiveMutation.mutate(archiving.id)}
                disabled={archiveMutation.isPending}
                className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white hover:bg-destructive/90 disabled:opacity-50"
              >
                {archiveMutation.isPending ? 'Archiving…' : 'Archive plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
