/** Same physical site: nursing-phase ↔ grow-out-phase profit centers. */

export interface PondSitePhaseFields {
  physical_site_name?: string
  site_base_name?: string
  pond_role?: string
  nursing_display_name?: string
  grow_out_display_name?: string
  operational_display_name?: string
  same_site_grow_out_pond_id?: number | null
  same_site_grow_out_pond_name?: string
  same_site_grow_out_display_name?: string
  same_site_nursing_pond_id?: number | null
  same_site_nursing_pond_name?: string
  same_site_nursing_display_name?: string
  linked_grow_out_pond_id?: number | null
  linked_grow_out_pond_name?: string
  phase_workflow_summary?: string
  same_site_peers?: {
    id: number
    name: string
    pond_role: string
    operational_display_name: string
  }[]
}

export function isNursingRole(pond: { pond_role?: string }): boolean {
  return (pond.pond_role || '').toLowerCase() === 'nursing'
}

export function isGrowOutRole(pond: { pond_role?: string }): boolean {
  return (pond.pond_role || '').toLowerCase() === 'grow_out'
}

export function pondPlBillLabel(pond: PondSitePhaseFields & { name?: string }): string {
  return (
    (pond.operational_display_name || '').trim() ||
    (pond as { name?: string }).name ||
    'Pond'
  )
}

export function pondFishBillLabel(pond: PondSitePhaseFields): string {
  return (
    (pond.nursing_display_name || '').trim() ||
    (pond.operational_display_name || '').trim() ||
    (pond as { name?: string }).name ||
    'Nursing pond'
  )
}

export function preferNursingPondId<T extends { id: number; pond_role?: string }>(ponds: T[]): number | null {
  const nursing = ponds.filter((p) => isNursingRole(p))
  return nursing[0]?.id ?? null
}

export function sameSiteGrowOutPond<T extends PondSitePhaseFields & { id: number; name?: string }>(
  nursingPond: T,
  allPonds: T[],
): T | undefined {
  const linkedId = nursingPond.same_site_grow_out_pond_id ?? nursingPond.linked_grow_out_pond_id
  if (linkedId) {
    const hit = allPonds.find((p) => p.id === linkedId)
    if (hit) return hit
  }
  const site = (nursingPond.physical_site_name || '').trim().toLowerCase()
  if (!site) return undefined
  return allPonds.find(
    (p) =>
      p.id !== nursingPond.id &&
      isGrowOutRole(p) &&
      (p.physical_site_name || '').trim().toLowerCase() === site,
  )
}

export function growOutPondsForTransfers<T extends PondSitePhaseFields & { id: number; name?: string }>(
  fromNursing: T | undefined,
  allPonds: T[],
): { sameSite?: T; others: T[] } {
  if (!fromNursing) {
    return { others: allPonds.filter((p) => isGrowOutRole(p)) }
  }
  const sameSite = sameSiteGrowOutPond(fromNursing, allPonds)
  const others = allPonds.filter(
    (p) => isGrowOutRole(p) && p.id !== fromNursing.id && p.id !== sameSite?.id,
  )
  return { sameSite, others }
}

export const NURSING_WORKFLOW_STEPS = [
  'Stock fry on a vendor bill to the nursing-phase pond (e.g. 500,000 fry @ 3,000 pcs/kg).',
  'Record mortality and feeding while nursing on that pond.',
  'Sample biomass until fingerling size (record measured pcs/kg — varies by batch).',
  'Transfer fingerlings to production ponds — and transfer remainder to the grow-out pond on the same site.',
] as const
