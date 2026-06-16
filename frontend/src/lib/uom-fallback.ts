/**
 * Shape aligned with GET /uoms (tenant settings).
 * Used when the platform UOM table is empty so item create still shows KG, L, Piece, etc.
 */
export type TenantUomOption = {
  code: string
  name: string
  category?: string
  base_unit?: string | null
  conversion_factor?: number
  is_active?: boolean
}

/** Core industrial units — feed/flour mill, filling station, packaging */
export const UOM_LIST_FALLBACK: TenantUomOption[] = [
  { code: 'KG', name: 'Kilogram', category: 'weight', is_active: true },
  { code: 'G', name: 'Gram', category: 'weight', is_active: true },
  { code: 'MT', name: 'Metric Ton', category: 'weight', is_active: true },
  { code: 'L', name: 'Liter', category: 'volume', is_active: true },
  { code: 'ML', name: 'Milliliter', category: 'volume', is_active: true },
  { code: 'NOS', name: 'Numbers', category: 'count', is_active: true },
  { code: 'PCS', name: 'Pieces', category: 'count', is_active: true },
  { code: 'PIECE', name: 'Piece', category: 'count', is_active: true },
  { code: 'EA', name: 'Each', category: 'count', is_active: true },
  { code: 'BAG', name: 'Bag', category: 'packaging', is_active: true },
  { code: 'BOX', name: 'Box', category: 'packaging', is_active: true },
  { code: 'DRM', name: 'Drum', category: 'packaging', is_active: true },
]

export function mergeTenantUomsWithFallback(
  fromApi: TenantUomOption[],
): TenantUomOption[] {
  if (fromApi && fromApi.length > 0) return fromApi
  return UOM_LIST_FALLBACK
}
