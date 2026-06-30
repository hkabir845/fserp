'use client'

import { Layout } from './Layout'
import { PlatformLayout } from './PlatformLayout'

/**
 * Placeholder “coming soon” panel.
 * – Default: no outer chrome — `AppShell` already wraps ERP routes with `Layout`; doubling it caused duplicate header/sidebar.
 * – `layout="platform"`: use under `/platform/*` where AppShell does not apply `Layout`.
 * – `layout="erp"`: only if this page is ever rendered outside `AppShell` (rare).
 */
export function ModuleStub({
  title,
  description,
  layout = 'bare',
}: {
  title: string
  description?: string
  layout?: 'bare' | 'platform' | 'erp'
}) {
  const inner = (
    <div className="rounded-xl border border-warning/30 bg-warning/10/60 p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-foreground/85">
        {description ??
          'This screen is reserved for upcoming functionality. The route is stable so you can build and deep-link while developing.'}
      </p>
    </div>
  )
  if (layout === 'platform') {
    return <PlatformLayout>{inner}</PlatformLayout>
  }
  if (layout === 'erp') {
    return <Layout>{inner}</Layout>
  }
  return inner
}
