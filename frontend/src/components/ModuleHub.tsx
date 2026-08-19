'use client'

import Link from 'next/link'
import { Layout } from './Layout'

export type HubLink = {
  title: string
  href: string
  icon: string
  description?: string
  /**
   * 'planned' marks a destination whose backend does not exist yet. Those pages render but every
   * request 404s, so the card is shown as unavailable instead of linking into a dead screen.
   * Omitted means live. Keep this honest: tests/test_module_registry_matches_backend.py fails if a
   * link left unmarked calls an API route the Django URLconf does not serve.
   */
  status?: 'live' | 'planned'
}

function PlannedCard({ link }: { link: HubLink }) {
  return (
    <div
      className="block cursor-not-allowed rounded-xl border border-dashed border-border bg-muted/30 p-5"
      aria-disabled="true"
      title="This module is on the roadmap and is not available yet."
    >
      <div className="mb-2 text-2xl opacity-50">{link.icon}</div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-muted-foreground">{link.title}</span>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          Not yet available
        </span>
      </div>
      {link.description ? (
        <p className="mt-1 text-sm text-muted-foreground/80">{link.description}</p>
      ) : null}
    </div>
  )
}

export function ModuleHub({
  title,
  subtitle,
  links,
  /**
   * Outer shell: ERP routes are already wrapped by `AppShell` → `Layout` (see root `layout.tsx`),
   * so a hub normally renders bare. Pass `true` for a standalone page outside `AppShell` (rare).
   */
  withLayout,
}: {
  title: string
  subtitle?: string
  links: HubLink[]
  withLayout?: boolean
}) {
  const wrapLayout = withLayout ?? false
  const live = links.filter((l) => l.status !== 'planned')
  const planned = links.filter((l) => l.status === 'planned')
  const inner = (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {live.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block rounded-xl border border-border bg-white p-5 shadow-sm transition hover:border-primary/30 hover:shadow-md"
            >
              <div className="mb-2 text-2xl">{l.icon}</div>
              <div className="font-medium text-foreground">{l.title}</div>
              {l.description ? <p className="mt-1 text-sm text-muted-foreground">{l.description}</p> : null}
            </Link>
          ))}
        </div>
      ) : null}
      {planned.length > 0 ? (
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            On the roadmap
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Designed but not built yet. These screens are not connected to the server.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {planned.map((l) => (
              <PlannedCard key={l.href} link={l} />
            ))}
          </div>
        </section>
      ) : null}
      {live.length === 0 && planned.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in this module yet.</p>
      ) : null}
    </div>
  )

  if (!wrapLayout) {
    return inner
  }
  return <Layout>{inner}</Layout>
}
