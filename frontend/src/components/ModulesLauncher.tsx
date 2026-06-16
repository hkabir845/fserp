'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  groupErpModulesByCategory,
  moduleProfessionalProfiles,
  moduleCategoryLabels,
  platformApps,
  type ErpModuleApp,
  type ModuleCategoryId,
  type ModuleReadiness,
} from '@/config/module-apps'

type Props = {
  erpModuleCount: number
}

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function readinessMeta(readiness: ModuleReadiness) {
  if (readiness === 'production') {
    return { label: 'Production-ready', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
  }
  if (readiness === 'beta') {
    return { label: 'Beta', className: 'bg-amber-100 text-amber-800 border-amber-200' }
  }
  return { label: 'Planned', className: 'bg-slate-100 text-slate-700 border-slate-200' }
}

function ModuleCard({
  app,
  emphasis,
}: {
  app: ErpModuleApp & { category: ModuleCategoryId }
  emphasis?: boolean
}) {
  const hubPath = `/modules/${app.hubSlug}`
  const profile = moduleProfessionalProfiles[app.id]
  const readiness = readinessMeta(profile?.readiness ?? 'planned')
  return (
    <article
      className={`group flex flex-col rounded-2xl border p-5 shadow-sm transition ${
        emphasis
          ? 'border-indigo-200 bg-gradient-to-br from-white to-indigo-50/80 hover:border-indigo-300 hover:shadow-md'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none" aria-hidden>
          {app.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900">{app.title}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${readiness.className}`}>
              {readiness.label}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">{app.tagline}</p>
          {profile?.domains?.length ? (
            <p className="mt-2 text-xs text-gray-500">Domain coverage: {profile.domains.slice(0, 2).join(' • ')}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
        <Link
          href={app.entryHref}
          className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
        >
          Open app
        </Link>
        <Link
          href={hubPath}
          className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-800 transition hover:border-indigo-200 hover:bg-indigo-50/80"
        >
          Screens &amp; hub
        </Link>
      </div>
    </article>
  )
}

export function ModulesLauncher({ erpModuleCount }: Props) {
  const [query, setQuery] = useState('')
  const sections = useMemo(() => groupErpModulesByCategory(), [])
  const q = normalize(query)

  const filteredSections = useMemo(() => {
    if (!q) return sections
    return sections
      .map(({ category, apps }) => ({
        category,
        apps: apps.filter((app) => {
          const profile = moduleProfessionalProfiles[app.id]
          const domainText = profile ? `${profile.domains.join(' ')} ${profile.capabilities.join(' ')} ${profile.readiness}` : ''
          const hay = normalize(`${app.title} ${app.tagline} ${domainText}`)
          return hay.includes(q)
        }),
      }))
      .filter((s) => s.apps.length > 0)
  }, [q, sections])

  const flatMatchCount = useMemo(
    () => filteredSections.reduce((n, s) => n + s.apps.length, 0),
    [filteredSections]
  )

  return (
    <div className="space-y-12">
      <header className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-600 via-indigo-700 to-slate-900 px-6 py-10 text-white shadow-lg sm:px-10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="relative max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-200/90">FMERP suite</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Your ERP, one launchpad</h1>
          <p className="mt-3 text-base leading-relaxed text-indigo-100">
            Each area works as its own app—master data, procurement, manufacturing, finance, and more—with shared data
            and one sign-in. Use <strong className="font-semibold text-white">Open app</strong> for the main screen, or{' '}
            <strong className="font-semibold text-white">Screens &amp; hub</strong> for every route in that module.
          </p>
          <p className="mt-2 text-sm text-indigo-100/90">
            Built for agri operations including feed mill, flour mill, transport, accounting, CRM, HR, payroll, and platform control.
          </p>
          <p className="mt-4 text-sm text-indigo-200/90">
            {erpModuleCount} tenant modules · same navigation as the sidebar
          </p>
        </div>
      </header>

      <div className="max-w-xl">
        <label htmlFor="module-search" className="sr-only">
          Search modules
        </label>
        <input
          id="module-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or description…"
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none ring-0 placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          autoComplete="off"
        />
        {query && (
          <p className="mt-2 text-sm text-gray-600">
            {flatMatchCount === 0 ? 'No modules match.' : `${flatMatchCount} module${flatMatchCount === 1 ? '' : 's'} match.`}
          </p>
        )}
      </div>

      {filteredSections.map(({ category, apps }) => {
        const meta = moduleCategoryLabels[category]
        return (
          <section key={category} className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{meta.title}</h2>
              <p className="text-sm text-gray-500">{meta.subtitle}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {apps.map((app) => (
                <ModuleCard key={app.id} app={app} emphasis={category === 'overview'} />
              ))}
            </div>
          </section>
        )
      })}

      <section className="space-y-4 border-t border-gray-200 pt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Platform (operator console)</h2>
            <p className="text-sm text-gray-500">
              Multi-tenant administration — separate from your company ERP and only for platform roles.
            </p>
          </div>
          <Link
            href="/platform/dashboard"
            className="text-sm font-medium text-purple-700 hover:text-purple-900 hover:underline"
          >
            Open platform hub →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {platformApps.map((p) => (
            <article
              key={p.id}
              className="flex flex-col rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50/80 to-white p-5 shadow-sm transition hover:border-purple-200 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden>
                  {p.icon}
                </span>
                <div>
                  <h3 className="font-semibold text-purple-950">{p.title}</h3>
                  <p className="mt-1 text-sm text-purple-900/70">{p.tagline}</p>
                </div>
              </div>
              <Link
                href={p.entryHref}
                className="mt-4 inline-flex w-fit items-center rounded-lg bg-purple-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-purple-800"
              >
                Open
              </Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
