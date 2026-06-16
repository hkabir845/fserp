'use client'

import Link from 'next/link'
import { NURSING_WORKFLOW_STEPS, type PondSitePhaseFields, isNursingRole, isGrowOutRole } from '@/lib/aquaculturePondSite'

export function PondPhaseWorkflowPanel(props: {
  pond: PondSitePhaseFields & {
    id?: number
    name?: string
    same_site_nursing_pond_id?: number | null
    same_site_grow_out_pond_id?: number | null
  }
  compact?: boolean
}) {
  const { pond, compact } = props
  const summary = (pond.phase_workflow_summary || '').trim()
  if (!summary && !isNursingRole(pond) && !isGrowOutRole(pond)) return null

  const partnerId = isNursingRole(pond)
    ? pond.same_site_grow_out_pond_id ?? pond.linked_grow_out_pond_id
    : pond.same_site_nursing_pond_id
  const partnerLabel = isNursingRole(pond)
    ? pond.same_site_grow_out_display_name || pond.linked_grow_out_pond_name
    : pond.same_site_nursing_display_name

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950">
      <p className="font-semibold text-sky-900">
        {isNursingRole(pond) ? 'Nursing phase (fry → fingerling)' : 'Grow-out phase'}
        {pond.physical_site_name ? (
          <span className="ml-2 font-normal text-sky-800">· Site: {pond.physical_site_name}</span>
        ) : null}
      </p>
      {summary ? <p className="mt-1 text-sky-900/90">{summary}</p> : null}
      {!compact ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-sky-900/85">
          {NURSING_WORKFLOW_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {partnerId ? (
          <Link
            href={`/aquaculture/ponds/${partnerId}`}
            className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100"
          >
            Paired pond: {partnerLabel || `#${partnerId}`}
          </Link>
        ) : null}
        {isNursingRole(pond) && pond.id ? (
          <>
            <Link
              href={`/bills?new=1&pond_id=${pond.id}`}
              className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100"
            >
              Stock fry (bill)
            </Link>
            <Link
              href="/aquaculture/transfers"
              className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100"
            >
              Transfer fingerlings
            </Link>
            <Link
              href="/aquaculture/sampling"
              className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100"
            >
              Biomass sampling
            </Link>
          </>
        ) : null}
      </div>
    </div>
  )
}
