'use client'

import Link from 'next/link'
import { Layout } from './Layout'
import { PlatformLayout } from './PlatformLayout'

export type HubLink = {
  title: string
  href: string
  icon: string
  description?: string
}

export function ModuleHub({
  title,
  subtitle,
  links,
  layout = 'erp',
  /**
   * Outer shell: ERP routes are already wrapped by `AppShell` → `Layout` (see root `layout.tsx`).
   * Platform routes skip that shell, so we wrap `layout="platform"` hubs in `PlatformLayout` by default.
   * Pass `true` only for a standalone page that is not under `AppShell` (rare).
   */
  withLayout,
}: {
  title: string
  subtitle?: string
  links: HubLink[]
  layout?: 'erp' | 'platform'
  withLayout?: boolean
}) {
  const wrapLayout = withLayout ?? layout === 'platform'
  const inner = (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
          >
            <div className="mb-2 text-2xl">{l.icon}</div>
            <div className="font-medium text-gray-900">{l.title}</div>
            {l.description ? <p className="mt-1 text-sm text-gray-500">{l.description}</p> : null}
          </Link>
        ))}
      </div>
    </div>
  )

  if (!wrapLayout) {
    return inner
  }
  if (layout === 'platform') {
    return <PlatformLayout>{inner}</PlatformLayout>
  }
  return <Layout>{inner}</Layout>
}
