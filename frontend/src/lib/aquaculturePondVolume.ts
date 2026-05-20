/**
 * Pond water volume from aquaculture setup (Bangladesh decimal × depth in ft → cu ft).
 * Matches backend compute_water_volume_cu_ft in aquaculture_units.py.
 */

const CU_FT_PER_CUBIC_M = 35.31466672148948

export interface PondVolumeFields {
  water_area_decimal?: string | null
  pond_depth_ft?: string | null
  water_volume_cu_ft?: string | null
  water_surface_sq_ft?: string | null
}

function parseNum(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(String(raw).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function pondHasCalculableVolume(pond: PondVolumeFields | null | undefined): boolean {
  if (!pond) return false
  const cu = parseNum(pond.water_volume_cu_ft)
  return cu != null && cu > 0
}

/** Cubic metres from stored cu ft (for display / dose hints). */
export function pondVolumeCubicMetres(pond: PondVolumeFields): number | null {
  const cu = parseNum(pond.water_volume_cu_ft)
  if (cu == null || cu <= 0) return null
  return cu / CU_FT_PER_CUBIC_M
}

/**
 * Value written into “Water / pond volume treated” — full pond by default.
 */
export function formatTreatmentWaterVolume(pond: PondVolumeFields): string | null {
  const m3 = pondVolumeCubicMetres(pond)
  if (m3 == null) return null
  const label = m3 >= 100 ? Math.round(m3).toLocaleString() : m3.toFixed(1)
  return `~${label} m³ (full pond)`
}

/** Short line under pond selector or the volume field. */
export function pondVolumeSummaryLine(pond: PondVolumeFields): string | null {
  const wa = parseNum(pond.water_area_decimal)
  const d = parseNum(pond.pond_depth_ft)
  const cu = parseNum(pond.water_volume_cu_ft)
  const m3 = pondVolumeCubicMetres(pond)

  if (m3 != null && cu != null) {
    const m3Label = m3 >= 100 ? Math.round(m3).toLocaleString() : m3.toFixed(1)
    const parts: string[] = [`~${m3Label} m³`]
    if (wa != null && wa > 0 && d != null && d > 0) {
      parts.push(`${wa} dec × ${d} ft`)
    }
    parts.push(`${Math.round(cu).toLocaleString()} cu ft`)
    return parts.join(' · ')
  }

  if (wa != null && wa > 0 && (d == null || d <= 0)) {
    return `${wa} dec water area — add depth on pond setup to calculate volume`
  }

  return null
}

export function pondVolumeSetupHint(pond: PondVolumeFields | null | undefined): string {
  if (!pond) return ''
  if (pondHasCalculableVolume(pond)) {
    return pondVolumeSummaryLine(pond) ?? ''
  }
  const wa = parseNum(pond.water_area_decimal)
  if (wa != null && wa > 0) {
    return 'Add average depth (ft) on the pond page to calculate water volume.'
  }
  return 'Set water area (decimal) and depth (ft) on the pond page to auto-fill volume.'
}
