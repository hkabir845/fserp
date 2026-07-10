'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { api } from '@/lib/api'
import { getPlatformUser } from '@/lib/platform-auth'

interface SubscriptionPlan {
  id: number
  name: string
  plan_type: string
  description: string | null
  price_monthly: number
  price_yearly: number | null
  max_users: number | null
  max_storage_gb: number | null
  is_active: boolean
}

interface CreatedTenant {
  id: number
  name: string
  domain: string
  is_active: boolean
  created_at: string
  user_count?: number
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function validateEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

function formatMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'BDT',
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${n} BDT`
  }
}

export default function PlatformNewTenantPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const [mounted, setMounted] = useState(false)

  const [orgName, setOrgName] = useState('')
  const [domain, setDomain] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [planId, setPlanId] = useState<number | null>(null)
  const [step, setStep] = useState(1)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const platformUser = getPlatformUser()

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ['platform-plans'],
    queryFn: async () => {
      const res = await api.get<SubscriptionPlan[]>('/platform/plans')
      return res.data
    },
    enabled: mounted,
  })

  useEffect(() => {
    setMounted(true)
    const token = localStorage.getItem('platform_token') || localStorage.getItem('access_token')
    if (!token) router.push('/login')
  }, [router])

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: orgName.trim(),
        domain: domain.trim().toLowerCase(),
        admin_name: adminName.trim(),
        admin_email: adminEmail.trim().toLowerCase(),
        admin_password: adminPassword,
      }
      if (planId != null) payload.plan_id = planId
      const res = await api.post<CreatedTenant>('/platform/tenants', payload)
      return res.data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['platform-tenants'] })
      qc.invalidateQueries({ queryKey: ['platform-stats'] })
      setCreated(data)
    },
  })

  const [created, setCreated] = useState<CreatedTenant | null>(null)

  const passwordStrength = useMemo(() => {
    const p = adminPassword
    if (!p) return { label: '', score: 0, color: 'bg-muted' }
    let score = 0
    if (p.length >= 8) score++
    if (p.length >= 12) score++
    if (/[A-Z]/.test(p)) score++
    if (/[0-9]/.test(p)) score++
    if (/[^A-Za-z0-9]/.test(p)) score++
    const capped = Math.min(4, Math.floor(score * 0.8))
    const labels = ['Weak', 'Fair', 'Good', 'Strong']
    const colors = ['bg-red-400', 'bg-amber-400', 'bg-emerald-500', 'bg-emerald-600']
    return { label: labels[capped] || 'Weak', score: capped + 1, color: colors[capped] || 'bg-muted' }
  }, [adminPassword])

  function validateAll(): boolean {
    const e: Record<string, string> = {}
    if (!orgName.trim()) e.orgName = 'Organization name is required.'
    const d = domain.trim().toLowerCase()
    if (!d) e.domain = 'Tenant domain is required.'
    else if (!DOMAIN_RE.test(d)) e.domain = 'Use lowercase letters, numbers, and single hyphens (DNS-style subdomain).'
    if (!adminName.trim()) e.adminName = 'Administrator full name is required.'
    if (!adminEmail.trim()) e.adminEmail = 'Email is required.'
    else if (!validateEmail(adminEmail)) e.adminEmail = 'Enter a valid email address.'
    if (!adminPassword) e.adminPassword = 'Password is required.'
    else if (adminPassword.length < 8) e.adminPassword = 'Use at least 8 characters.'
    setFieldErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validateAll()) return
    createMutation.mutate()
  }

  function openInErp(t: CreatedTenant) {
    localStorage.setItem('tenant_domain', t.domain)
    localStorage.setItem('company_mode', 'tenant')
    localStorage.setItem('is_platform_mode', 'false')
    router.push('/dashboard')
  }

  if (!mounted) return null

  if (created) {
    return (
              <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-muted/40 to-card py-10">
          <div className="mx-auto max-w-2xl px-4 sm:px-6">
            <div className="overflow-hidden rounded-2xl border border-emerald-200/80 bg-white shadow-lg shadow-emerald-900/5 ring-1 ring-slate-900/5">
              <div className="border-b border-emerald-100 bg-gradient-to-r from-emerald-600 to-teal-600 px-8 py-10 text-white">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h1 className="mt-6 text-2xl font-bold tracking-tight">Organization provisioned</h1>
                <p className="mt-2 max-w-lg text-sm text-emerald-100">
                  {created.name} is live as an isolated tenant. The administrator can sign in to the ERP with the credentials you
                  defined.
                </p>
              </div>
              <div className="space-y-6 px-8 py-8">
                <dl className="grid gap-4 rounded-xl border border-border/70 bg-muted/50 p-5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Tenant ID</dt>
                    <dd className="font-mono font-semibold text-foreground">{created.id}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Domain</dt>
                    <dd className="font-mono font-semibold text-foreground">{created.domain}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>
                      <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                        Active
                      </span>
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setCreated(null)
                      setOrgName('')
                      setDomain('')
                      setAdminName('')
                      setAdminEmail('')
                      setAdminPassword('')
                      setPlanId(null)
                      setStep(1)
                      createMutation.reset()
                    }}
                    className="inline-flex justify-center rounded-xl border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground/85 shadow-sm hover:bg-muted/40"
                  >
                    Provision another
                  </button>
                  <Link
                    href="/platform/tenants/browse"
                    className="inline-flex justify-center rounded-xl border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground/85 shadow-sm hover:bg-muted/40"
                  >
                    Tenant directory
                  </Link>
                  <button
                    type="button"
                    onClick={() => openInErp(created)}
                    className="inline-flex justify-center rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-700"
                  >
                    Open in ERP
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
    )
  }

  const apiErr =
    (createMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (createMutation.error as Error)?.message

  return (
          <div className="min-h-screen bg-gradient-to-b from-muted/40 via-white to-slate-50/80">
        <div className="border-b border-border/80 bg-white/90 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
            <nav className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Link href="/platform/dashboard" className="hover:text-purple-700">
                Platform
              </Link>
              <span aria-hidden>/</span>
              <Link href="/platform/tenants/browse" className="hover:text-purple-700">
                Tenants
              </Link>
              <span aria-hidden>/</span>
              <span className="font-medium text-foreground">New organization</span>
            </nav>
            <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Provision client organization</h1>
                <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                  Onboard a feed manufacturing or integrated nutrition operation. Each tenant receives a dedicated ERP
                  environment—segregated data, traceable production, and role-based access aligned with feed-industry
                  compliance workflows.
                </p>
              </div>
              {platformUser && (
                <p className="text-xs text-muted-foreground">
                  Operator:{' '}
                  <span className="font-medium text-foreground/85">{platformUser.email}</span>
                </p>
              )}
            </div>

            {/* Step indicator */}
            <div className="mt-8 flex max-w-xl items-center justify-between gap-2">
              {[
                { n: 1, label: 'Organization' },
                { n: 2, label: 'Administrator' },
                { n: 3, label: 'Subscription' },
              ].map((s, i) => (
                <div key={s.n} className="flex flex-1 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(s.n)}
                    className={clsx(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors',
                      step >= s.n ? 'bg-purple-600 text-white shadow-md shadow-purple-600/25' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {s.n}
                  </button>
                  <span
                    className={clsx(
                      'hidden text-xs font-semibold uppercase tracking-wide sm:inline',
                      step === s.n ? 'text-purple-800' : 'text-muted-foreground/70',
                    )}
                  >
                    {s.label}
                  </span>
                  {i < 2 && <div className="mx-1 hidden h-px flex-1 bg-muted sm:block" aria-hidden />}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <form onSubmit={handleSubmit} className="space-y-8" noValidate>
                {/* Step 1 */}
                <section
                  className={clsx(
                    'rounded-2xl border border-border/80 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:p-8',
                    step !== 1 && 'opacity-60',
                  )}
                  aria-labelledby="step-org"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 id="step-org" className="text-lg font-semibold text-foreground">
                        Organization & domain
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Legal or trade name as it should appear on documents, and a unique subdomain for API and sign-in routing.
                      </p>
                      <div className="mt-6 space-y-5">
                        <div>
                          <label htmlFor="orgName" className="block text-sm font-medium text-foreground/85">
                            Organization name <span className="text-red-500">*</span>
                          </label>
                          <input
                            id="orgName"
                            type="text"
                            autoComplete="organization"
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            placeholder="e.g. Bay Aqua Feeds Ltd."
                            className={clsx(
                              'mt-1.5 block w-full rounded-xl border px-4 py-2.5 text-foreground shadow-sm placeholder:text-muted-foreground/70 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20',
                              fieldErrors.orgName ? 'border-destructive/30' : 'border-border',
                            )}
                            aria-invalid={!!fieldErrors.orgName}
                          />
                          {fieldErrors.orgName && (
                            <p className="mt-1.5 text-sm text-destructive" role="alert">
                              {fieldErrors.orgName}
                            </p>
                          )}
                        </div>
                        <div>
                          <label htmlFor="domain" className="block text-sm font-medium text-foreground/85">
                            Tenant domain <span className="text-red-500">*</span>
                          </label>
                          <div className="mt-1.5 flex rounded-xl border border-border shadow-sm focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-500/20">
                            <span className="flex items-center border-r border-border bg-muted/40 px-3 text-sm text-muted-foreground">
                              https://
                            </span>
                            <input
                              id="domain"
                              type="text"
                              inputMode="text"
                              autoCapitalize="none"
                              autoCorrect="off"
                              spellCheck={false}
                              value={domain}
                              onChange={(e) => setDomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                              placeholder="client-slug"
                              className={clsx(
                                'block min-w-0 flex-1 rounded-r-xl border-0 bg-transparent px-4 py-2.5 text-foreground placeholder:text-muted-foreground/70 focus:ring-0',
                                fieldErrors.domain && 'text-red-900',
                              )}
                              aria-invalid={!!fieldErrors.domain}
                              aria-describedby="domain-hint"
                            />
                          </div>
                          <p id="domain-hint" className="mt-1.5 text-xs text-muted-foreground">
                            Used in <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">X-Tenant-Domain</code>{' '}
                            headers and login routing. Must be globally unique.
                          </p>
                          {fieldErrors.domain && (
                            <p className="mt-1.5 text-sm text-destructive" role="alert">
                              {fieldErrors.domain}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-6 flex justify-end sm:hidden">
                        <button
                          type="button"
                          onClick={() => setStep(2)}
                          className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Step 2 */}
                <section
                  className={clsx(
                    'rounded-2xl border border-border/80 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:p-8',
                    step !== 2 && 'opacity-60',
                  )}
                  aria-labelledby="step-admin"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 id="step-admin" className="text-lg font-semibold text-foreground">
                        Primary administrator
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        The first user with full access to configure plants, formulas, and users. Share credentials through your
                        secure channel—not by email from this console.
                      </p>
                      <div className="mt-6 grid gap-5 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label htmlFor="adminName" className="block text-sm font-medium text-foreground/85">
                            Full name <span className="text-red-500">*</span>
                          </label>
                          <input
                            id="adminName"
                            type="text"
                            autoComplete="name"
                            value={adminName}
                            onChange={(e) => setAdminName(e.target.value)}
                            placeholder="e.g. Operations Director"
                            className={clsx(
                              'mt-1.5 block w-full rounded-xl border px-4 py-2.5 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20',
                              fieldErrors.adminName ? 'border-destructive/30' : 'border-border',
                            )}
                          />
                          {fieldErrors.adminName && <p className="mt-1 text-sm text-destructive">{fieldErrors.adminName}</p>}
                        </div>
                        <div>
                          <label htmlFor="adminEmail" className="block text-sm font-medium text-foreground/85">
                            Work email <span className="text-red-500">*</span>
                          </label>
                          <input
                            id="adminEmail"
                            type="email"
                            autoComplete="email"
                            value={adminEmail}
                            onChange={(e) => setAdminEmail(e.target.value)}
                            placeholder="admin@client.com"
                            className={clsx(
                              'mt-1.5 block w-full rounded-xl border px-4 py-2.5 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20',
                              fieldErrors.adminEmail ? 'border-destructive/30' : 'border-border',
                            )}
                          />
                          {fieldErrors.adminEmail && <p className="mt-1 text-sm text-destructive">{fieldErrors.adminEmail}</p>}
                        </div>
                        <div>
                          <label htmlFor="adminPassword" className="block text-sm font-medium text-foreground/85">
                            Initial password <span className="text-red-500">*</span>
                          </label>
                          <div className="relative mt-1.5">
                            <input
                              id="adminPassword"
                              type={showPassword ? 'text' : 'password'}
                              autoComplete="new-password"
                              value={adminPassword}
                              onChange={(e) => setAdminPassword(e.target.value)}
                              placeholder="Minimum 8 characters"
                              className={clsx(
                                'block w-full rounded-xl border px-4 py-2.5 pr-12 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20',
                                fieldErrors.adminPassword ? 'border-destructive/30' : 'border-border',
                              )}
                            />
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                            >
                              {showPassword ? 'Hide' : 'Show'}
                            </button>
                          </div>
                          {adminPassword && (
                            <div className="mt-2">
                              <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={clsx('h-full transition-all', passwordStrength.color)}
                                  style={{ width: `${(passwordStrength.score / 4) * 100}%` }}
                                />
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Strength: <span className="font-medium text-foreground/85">{passwordStrength.label}</span>
                              </p>
                            </div>
                          )}
                          {fieldErrors.adminPassword && (
                            <p className="mt-1 text-sm text-destructive">{fieldErrors.adminPassword}</p>
                          )}
                        </div>
                      </div>
                      <div className="mt-6 flex justify-between sm:hidden">
                        <button type="button" onClick={() => setStep(1)} className="text-sm font-semibold text-muted-foreground">
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={() => setStep(3)}
                          className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Step 3 */}
                <section
                  className={clsx(
                    'rounded-2xl border border-border/80 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:p-8',
                    step !== 3 && 'opacity-60',
                  )}
                  aria-labelledby="step-plan"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-primary">
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 id="step-plan" className="text-lg font-semibold text-foreground">
                        Subscription plan
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Selecting a plan starts a <strong className="font-semibold text-foreground">14-day trial</strong> with the
                        chosen entitlements. You can adjust billing later in Subscriptions.
                      </p>
                      {plansLoading && <p className="mt-4 text-sm text-muted-foreground">Loading plans…</p>}
                      {!plansLoading && plans.length === 0 && (
                        <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
                          No active plans in the catalog. Provision without a plan or add plans under Platform → Plans.
                        </p>
                      )}
                      <div className="mt-6 grid gap-4 sm:grid-cols-2">
                        <label
                          className={clsx(
                            'relative flex cursor-pointer flex-col rounded-xl border-2 p-4 transition-colors',
                            planId === null ? 'border-purple-600 bg-purple-50/50 ring-1 ring-purple-600/20' : 'border-border hover:border-border',
                          )}
                        >
                          <input
                            type="radio"
                            name="plan"
                            className="sr-only"
                            checked={planId === null}
                            onChange={() => setPlanId(null)}
                          />
                          <span className="text-sm font-semibold text-foreground">No plan yet</span>
                          <span className="mt-1 text-xs text-muted-foreground">Create tenant only; attach a subscription later.</span>
                        </label>
                        {plans.map((p) => (
                          <label
                            key={p.id}
                            className={clsx(
                              'relative flex cursor-pointer flex-col rounded-xl border-2 p-4 transition-colors',
                              planId === p.id ? 'border-purple-600 bg-purple-50/50 ring-1 ring-purple-600/20' : 'border-border hover:border-border',
                            )}
                          >
                            <input
                              type="radio"
                              name="plan"
                              className="sr-only"
                              checked={planId === p.id}
                              onChange={() => setPlanId(p.id)}
                            />
                            <span className="text-sm font-semibold text-foreground">{p.name}</span>
                            <span className="mt-0.5 text-xs capitalize text-muted-foreground">{p.plan_type.replace(/_/g, ' ')}</span>
                            <span className="mt-2 text-lg font-bold text-foreground">{formatMoney(p.price_monthly)}</span>
                            <span className="text-xs text-muted-foreground">per month</span>
                            {p.description && (
                              <span className="mt-2 line-clamp-2 text-xs text-muted-foreground">{p.description}</span>
                            )}
                            {(p.max_users != null || p.max_storage_gb != null) && (
                              <span className="mt-2 text-xs text-muted-foreground">
                                {[p.max_users != null && `Up to ${p.max_users} users`, p.max_storage_gb != null && `${p.max_storage_gb} GB storage`]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {createMutation.isError && (
                  <div
                    className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                    role="alert"
                  >
                    <p className="font-semibold">Could not provision tenant</p>
                    <p className="mt-1">{typeof apiErr === 'string' ? apiErr : 'Request failed.'}</p>
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <Link
                    href="/platform/tenants/browse"
                    className="text-center text-sm font-semibold text-muted-foreground hover:text-purple-700 sm:text-left"
                  >
                    Cancel
                  </Link>
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                    <button
                      type="button"
                      onClick={() => setStep((s) => Math.max(1, s - 1))}
                      disabled={step <= 1}
                      className="rounded-xl border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground/85 shadow-sm hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Back
                    </button>
                    {step < 3 ? (
                      <button
                        type="button"
                        onClick={() => setStep((s) => Math.min(3, s + 1))}
                        className="rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-700"
                      >
                        Continue
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={createMutation.isPending}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-purple-600/25 hover:bg-purple-700 disabled:opacity-60"
                      >
                        {createMutation.isPending ? (
                          <>
                            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              />
                            </svg>
                            Provisioning…
                          </>
                        ) : (
                          'Provision tenant'
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </div>

            {/* Aside */}
            <aside className="lg:col-span-4">
              <div className="sticky top-24 space-y-6">
                <div className="rounded-2xl border border-border/80 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">What gets created</h3>
                  <ul className="mt-4 space-y-4 text-sm text-muted-foreground">
                    <li className="flex gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                      <span>
                        <strong className="text-foreground">Isolated tenant</strong> — separate master data, inventory, and
                        manufacturing records from other clients.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                      <span>
                        <strong className="text-foreground">Administrator account</strong> — first user on the tenant; should
                        configure plants, UoMs, and delegate roles.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                      <span>
                        <strong className="text-foreground">Optional trial</strong> — when a plan is selected, a trial window
                        opens per platform rules (typically 14 days).
                      </span>
                    </li>
                  </ul>
                </div>
                <div className="rounded-2xl border border-border bg-muted/50 p-5 text-xs leading-relaxed text-muted-foreground">
                  <p className="font-semibold text-foreground">Feed &amp; aqua operations</p>
                  <p className="mt-2">
                    FMERP supports multi-site feed mills, formulation versioning, and production traceability. Provision one tenant
                    per legal entity or operating company for clean audit boundaries.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
  )
}
