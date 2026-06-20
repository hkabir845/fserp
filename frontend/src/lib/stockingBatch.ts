/** Stocking batch (production cycle) naming aligned with nursing → grow-out tilapia workflow. */

/** Tilapia: C01/C02/C03 per season. Other species: one continuous batch per pond (2nd batch is rare). */
export function usesSeasonalStockingBatches(speciesId: string): boolean {
  return (speciesId || 'tilapia').trim().toLowerCase() === 'tilapia'
}

export function suggestNursingBatchName(
  speciesLabel: string,
  pondName: string,
  code: string,
  startDateIso: string,
): string {
  const sp = (speciesLabel || 'Tilapia').trim() || 'Tilapia'
  const pond = (pondName || 'Nursing pond').trim()
  const c = (code || '').trim()
  const d = startDateIso ? new Date(`${startDateIso.slice(0, 10)}T12:00:00`) : new Date()
  const month = d.toLocaleString('en-US', { month: 'short', year: 'numeric' })
  const bits = [sp, 'fry batch']
  if (c) bits.push(c)
  return `${bits.join(' ')} — ${pond} — ${month}`
}

export function suggestContinuousBatchName(speciesLabel: string, pondName: string): string {
  const sp = (speciesLabel || 'Fish').trim() || 'Fish'
  const pond = (pondName || 'Pond').trim()
  return `${sp} — ${pond}`
}

export function suggestGrowOutBatchName(
  speciesLabel: string,
  sourceCode: string,
  pondName: string,
): string {
  const sp = (speciesLabel || 'Tilapia').trim() || 'Tilapia'
  const pond = (pondName || 'Grow-out pond').trim()
  const ref = (sourceCode || '').trim()
  return ref ? `${sp} fingerlings (${ref}) — ${pond}` : `${sp} fingerlings — ${pond}`
}

export const STOCKING_BATCH_WORKFLOW = {
  title: 'Stocking batches — tilapia vs other species',
  steps: [
    {
      phase: 'Tilapia (main crop)',
      detail:
        'Three fry purchases per season → three nursing batches (C01, C02, C03). Each new fry bill to the nursing pond opens a new batch unless you pick one manually. Transfer fingerlings with the source batch selected; grow-out ponds get linked batches.',
    },
    {
      phase: 'Other species',
      detail:
        'Usually one batch per pond that keeps growing (pangasius, carp, etc.). FSERP reuses the open batch when you post another fry or cost bill to the same pond and species. Start a 2nd batch only when you deliberately add a new cycle and close the old one.',
    },
    {
      phase: 'Nursing care',
      detail:
        'Record feeding, mortality, and biomass sampling with the batch selected so growth and FCR stay with the right cohort.',
    },
    {
      phase: 'Grow-out',
      detail:
        'Tag feed bills, medicine, and harvest sales to the batch for margin per cohort. Shared pond costs (electricity split across ponds) stay pond-level without a batch.',
    },
  ],
} as const
