/**
 * Reference catalog of common aquaculture pond-care products and typical dose rates.
 * Used to list products on the medicine page and auto-fill treatment forms.
 * Always verify doses against label, local regulation, and fish species.
 */

import { pondVolumeCubicMetres, type PondVolumeFields } from '@/lib/aquaculturePondVolume'
import { suggestMedicineStockUnit } from '@/lib/aquacultureMedicineUnits'
import type {
  ApplicationMethodId,
  DoseUnitId,
  TreatmentFormFields,
  TreatmentPurposeId,
} from '@/app/aquaculture/medicine/medicineUtils'

/** 1 Bangladesh decimal = 0.01 acre; 1 acre ≈ 0.404686 ha (for converting old extension kg/ha tables). */
export const DECIMAL_TO_HECTARES = 0.01 * 0.404686

export function parsePondWaterAreaDecimal(pond: PondVolumeFields | null | undefined): number | null {
  if (pond?.water_area_decimal == null || pond.water_area_decimal === '') return null
  const n = Number(String(pond.water_area_decimal).replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Convert legacy extension kg/ha rates to kg per water-surface decimal. */
export function kgPerHaToKgPerDecimal(kgPerHa: number): number {
  return kgPerHa * DECIMAL_TO_HECTARES
}

function formatKgPerDecimalValue(kgPerDecimal: number): string {
  if (kgPerDecimal >= 10) return String(Math.round(kgPerDecimal))
  if (kgPerDecimal >= 1) return kgPerDecimal.toFixed(2)
  if (kgPerDecimal >= 0.1) return kgPerDecimal.toFixed(2)
  return kgPerDecimal.toFixed(3)
}

/** Single recommended rate in kg/decimal (from legacy kg/ha extension tables). */
export function formatKgPerDecimalRate(kgPerHa: number): string {
  return formatKgPerDecimalValue(kgPerHaToKgPerDecimal(kgPerHa))
}

/** Typical range in kg/decimal for product notes (from legacy kg/ha ranges). */
export function formatKgPerDecimalRange(lowKgPerHa: number, highKgPerHa: number): string {
  const low = kgPerHaToKgPerDecimal(lowKgPerHa)
  const high = kgPerHaToKgPerDecimal(highKgPerHa)
  return `${formatKgPerDecimalValue(low)}–${formatKgPerDecimalValue(high)} kg/decimal`
}

export type PondCareGroup =
  | 'water_quality'
  | 'parasite'
  | 'bacterial'
  | 'fungal'
  | 'vitamin'
  | 'disinfectant'
  | 'other'

export interface PondCareProductGuide {
  id: string
  name: string
  group: PondCareGroup
  /** Match inventory item names (case-insensitive substring). */
  keywords: string[]
  stockUnit: string
  purpose: TreatmentPurposeId
  method: ApplicationMethodId
  doseAmount: string
  doseUnit: DoseUnitId
  withdrawalDays: string
  notes: string
  /**
   * How to estimate quantity used from pond volume (m³).
   * - ppm: active ingredient mg/L → kg product ≈ ppm × m³ / 1000 (pure basis; adjust for % active)
   * - g_m3: grams per m³ pond water → kg = g_m3 × m³ / 1000
   * - kg_decimal: kg per Bangladesh water-surface decimal (uses water_area_decimal)
   * - kg_pond: fixed typical whole-pond dose (small ponds)
   * - liter: liquid L per m³
   */
  qtyRule?: 'ppm' | 'g_m3' | 'kg_decimal' | 'kg_pond' | 'liter' | 'bottle'
  qtyFactor?: number
  /** Optional multiplier note in line note when qty is estimated. */
  qtyHint?: string
}

export const POND_CARE_GROUP_LABELS: Record<PondCareGroup, string> = {
  water_quality: 'Water quality & liming',
  parasite: 'Parasite & external',
  bacterial: 'Bacterial (antibiotics)',
  fungal: 'Fungal & disinfectants',
  vitamin: 'Vitamins & supplements',
  disinfectant: 'Disinfectants & sanitizers',
  other: 'Other treatments',
}

/** Standard pond-care and medicine products (Bangladesh / tropical pond aquaculture). */
export const POND_CARE_PRODUCT_GUIDES: PondCareProductGuide[] = [
  {
    id: 'ag_lime',
    name: 'Agricultural lime (CaCO₃ / chuna)',
    group: 'water_quality',
    keywords: ['agricultural lime', 'ag lime', 'chuna', 'calcium carbonate', 'caco'],
    stockUnit: 'kg',
    purpose: 'water_quality',
    method: 'bath',
    doseAmount: formatKgPerDecimalRate(250),
    doseUnit: 'kg_decimal',
    withdrawalDays: '0',
    notes: `Raise alkalinity & pH. Apply on calm day; avoid during heavy rain. Typical ${formatKgPerDecimalRange(200, 500)}.`,
    qtyRule: 'kg_decimal',
    qtyFactor: kgPerHaToKgPerDecimal(250),
    qtyHint: 'Mid-range liming rate',
  },
  {
    id: 'hydrated_lime',
    name: 'Hydrated lime (Ca(OH)₂)',
    group: 'water_quality',
    keywords: ['hydrated lime', 'slaked lime', 'ca(oh)'],
    stockUnit: 'kg',
    purpose: 'water_quality',
    method: 'bath',
    doseAmount: formatKgPerDecimalRate(50),
    doseUnit: 'kg_decimal',
    withdrawalDays: '0',
    notes: 'Stronger than ag lime — use lower rate. Pre-dissolve in water before pond application.',
    qtyRule: 'kg_decimal',
    qtyFactor: kgPerHaToKgPerDecimal(50),
  },
  {
    id: 'dolomite',
    name: 'Dolomite',
    group: 'water_quality',
    keywords: ['dolomite'],
    stockUnit: 'kg',
    purpose: 'water_quality',
    method: 'bath',
    doseAmount: formatKgPerDecimalRate(200),
    doseUnit: 'kg_decimal',
    withdrawalDays: '0',
    notes: 'Supplies Ca and Mg. Similar application to agricultural lime.',
    qtyRule: 'kg_decimal',
    qtyFactor: kgPerHaToKgPerDecimal(200),
  },
  {
    id: 'zeolite',
    name: 'Zeolite',
    group: 'water_quality',
    keywords: ['zeolite'],
    stockUnit: 'kg',
    purpose: 'water_quality',
    method: 'bath',
    doseAmount: formatKgPerDecimalRate(25),
    doseUnit: 'kg_decimal',
    withdrawalDays: '0',
    notes: `Binds ammonia; often used with water exchange. Typical ${formatKgPerDecimalRange(15, 40)}.`,
    qtyRule: 'kg_decimal',
    qtyFactor: kgPerHaToKgPerDecimal(25),
  },
  {
    id: 'salt',
    name: 'Salt (NaCl)',
    group: 'parasite',
    keywords: ['salt', 'sodium chloride', 'nacl', 'common salt'],
    stockUnit: 'kg',
    purpose: 'parasite',
    method: 'bath',
    doseAmount: '3',
    doseUnit: 'ppm',
    withdrawalDays: '3',
    notes: '≈3 ppt bath for ectoparasites. Short-term stress — monitor DO. 1 ppt ≈ 1 g/L ≈ 1 kg/m³.',
    qtyRule: 'ppm',
    qtyFactor: 3,
    qtyHint: '3 ppt whole-pond bath',
  },
  {
    id: 'kmno4',
    name: 'Potassium permanganate (KMnO₄)',
    group: 'parasite',
    keywords: ['potassium permanganate', 'kmno4', 'permanganate', 'pp'],
    stockUnit: 'kg',
    purpose: 'parasite',
    method: 'bath',
    doseAmount: '2',
    doseUnit: 'ppm',
    withdrawalDays: '5',
    notes: 'Pink solution until light wine color. Organic load reduces effective dose — often 2–4 ppm.',
    qtyRule: 'ppm',
    qtyFactor: 2,
  },
  {
    id: 'formalin',
    name: 'Formalin (37–40% formaldehyde)',
    group: 'parasite',
    keywords: ['formalin', 'formaldehyde'],
    stockUnit: 'liter',
    purpose: 'parasite',
    method: 'bath',
    doseAmount: '20',
    doseUnit: 'ppm',
    withdrawalDays: '14',
    notes: 'Parasite & fungal egg control. 15–25 ppm active; aerate well. Restricted in some markets.',
    qtyRule: 'liter',
    qtyFactor: 20,
    qtyHint: '~20 mL formalin product per m³ (verify label)',
  },
  {
    id: 'copper_sulphate',
    name: 'Copper sulphate (bluestone)',
    group: 'parasite',
    keywords: ['copper sulphate', 'copper sulfate', 'bluestone', 'cuso4'],
    stockUnit: 'kg',
    purpose: 'parasite',
    method: 'bath',
    doseAmount: '0.5',
    doseUnit: 'ppm',
    withdrawalDays: '21',
    notes: 'Algae & parasite control. Check alkalinity (>50 mg/L CaCO₃). Toxic to shrimp at low pH.',
    qtyRule: 'ppm',
    qtyFactor: 0.5,
  },
  {
    id: 'malachite',
    name: 'Malachite green',
    group: 'fungal',
    keywords: ['malachite green', 'malachite'],
    stockUnit: 'liter',
    purpose: 'fungal',
    method: 'bath',
    doseAmount: '0.1',
    doseUnit: 'ppm',
    withdrawalDays: '28',
    notes: 'Fungus & external parasites. Banned or restricted in many countries — check local law.',
    qtyRule: 'ppm',
    qtyFactor: 0.1,
  },
  {
    id: 'methylene_blue',
    name: 'Methylene blue',
    group: 'fungal',
    keywords: ['methylene blue'],
    stockUnit: 'liter',
    purpose: 'fungal',
    method: 'bath',
    doseAmount: '1',
    doseUnit: 'ppm',
    withdrawalDays: '7',
    notes: 'Egg fungus & mild external infections. Stains water; reduces photosynthesis.',
    qtyRule: 'ppm',
    qtyFactor: 1,
  },
  {
    id: 'h2o2',
    name: 'Hydrogen peroxide (H₂O₂)',
    group: 'disinfectant',
    keywords: ['hydrogen peroxide', 'h2o2', 'peroxide'],
    stockUnit: 'liter',
    purpose: 'water_quality',
    method: 'bath',
    doseAmount: '5',
    doseUnit: 'ppm',
    withdrawalDays: '0',
    notes: 'Oxygen boost & organic load oxidation. 2–10 ppm; split dose if heavy algae.',
    qtyRule: 'ppm',
    qtyFactor: 5,
  },
  {
    id: 'bleach',
    name: 'Calcium hypochlorite / pond bleach',
    group: 'disinfectant',
    keywords: ['bleach', 'hypochlorite', 'chlorine'],
    stockUnit: 'kg',
    purpose: 'water_quality',
    method: 'bath',
    doseAmount: '0.5',
    doseUnit: 'ppm',
    withdrawalDays: '7',
    notes: 'Disinfection only — not for fish in pond. Use for pond prep / equipment.',
    qtyRule: 'ppm',
    qtyFactor: 0.5,
  },
  {
    id: 'oxytetracycline',
    name: 'Oxytetracycline (OTC / Terramycin)',
    group: 'bacterial',
    keywords: ['oxytetracycline', 'terramycin', 'otc', 'oxy-med', 'oxymed'],
    stockUnit: 'kg',
    purpose: 'bacterial',
    method: 'feed_mix',
    doseAmount: '75',
    doseUnit: 'g_ton',
    withdrawalDays: '21',
    notes: 'Medicated feed 50–100 g active/ton fish/day for 7–10 days. Match active % on label.',

  },
  {
    id: 'florfenicol',
    name: 'Florfenicol',
    group: 'bacterial',
    keywords: ['florfenicol'],
    stockUnit: 'kg',
    purpose: 'bacterial',
    method: 'feed_mix',
    doseAmount: '10',
    doseUnit: 'g_ton',
    withdrawalDays: '14',
    notes: 'In-feed antibiotic — prescription where required. 10–15 mg/kg fish/day typical.',
  },
  {
    id: 'cifax',
    name: 'CIFAX / ciprofloxacin (where approved)',
    group: 'bacterial',
    keywords: ['cifax', 'ciprofloxacin'],
    stockUnit: 'bottle',
    purpose: 'bacterial',
    method: 'bath',
    doseAmount: '1',
    doseUnit: 'ppm',
    withdrawalDays: '28',
    notes: 'Follow national veterinary rules. Bath or feed per label only.',
    qtyRule: 'bottle',
    qtyFactor: 1,
  },
  {
    id: 'probiotic',
    name: 'Aquaculture probiotic',
    group: 'water_quality',
    keywords: ['probiotic', 'biofloc', 'beneficial bacteria'],
    stockUnit: 'liter',
    purpose: 'water_quality',
    method: 'bath',
    doseAmount: '1',
    doseUnit: 'ml_l',
    withdrawalDays: '0',
    notes: 'Follow manufacturer mL/L or g/m³. Often weekly during grow-out.',
    qtyRule: 'liter',
    qtyFactor: 0.001,
    qtyHint: '1 mL/L ≈ 1 L per m³',
  },
  {
    id: 'vitamin_c',
    name: 'Vitamin C / ascorbic acid',
    group: 'vitamin',
    keywords: ['vitamin c', 'ascorbic', 'vitamin'],
    stockUnit: 'kg',
    purpose: 'vitamin',
    method: 'feed_mix',
    doseAmount: '500',
    doseUnit: 'g_ton',
    withdrawalDays: '0',
    notes: 'Stress & immunity support in feed. 300–1000 g/ton feed.',
  },
  {
    id: 'mineral_premix',
    name: 'Mineral / vitamin premix',
    group: 'vitamin',
    keywords: ['premix', 'mineral mix', 'vitamin premix'],
    stockUnit: 'kg',
    purpose: 'vitamin',
    method: 'feed_mix',
    doseAmount: '1',
    doseUnit: 'kg_pond',
    withdrawalDays: '0',
    notes: 'Usually mixed in feed per manufacturer % inclusion.',
    qtyRule: 'kg_pond',
    qtyFactor: 2,
  },
  {
    id: 'alum',
    name: 'Alum (aluminium sulphate)',
    group: 'water_quality',
    keywords: ['alum', 'aluminum sulphate', 'aluminium sulfate'],
    stockUnit: 'kg',
    purpose: 'water_quality',
    method: 'bath',
    doseAmount: formatKgPerDecimalRate(20),
    doseUnit: 'kg_decimal',
    withdrawalDays: '0',
    notes: `Clarifies turbid water. Use with caution — pH drop. Typical ${formatKgPerDecimalRange(10, 30)}.`,
    qtyRule: 'kg_decimal',
    qtyFactor: kgPerHaToKgPerDecimal(20),
  },
  {
    id: 'potassium_permanganate_feed',
    name: 'Potassium (KCl) / pond K supplement',
    group: 'other',
    keywords: ['potassium chloride', 'muriate of potash'],
    stockUnit: 'kg',
    purpose: 'water_quality',
    method: 'bath',
    doseAmount: formatKgPerDecimalRate(10),
    doseUnit: 'kg_decimal',
    withdrawalDays: '0',
    notes: 'Mineral supplement — not KMnO₄. Confirm product identity before dosing.',
    qtyRule: 'kg_decimal',
    qtyFactor: kgPerHaToKgPerDecimal(10),
  },
]

const GROUP_ORDER: PondCareGroup[] = [
  'water_quality',
  'parasite',
  'bacterial',
  'fungal',
  'vitamin',
  'disinfectant',
  'other',
]

export function pondCareGuidesByGroup(): { group: PondCareGroup; label: string; products: PondCareProductGuide[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    label: POND_CARE_GROUP_LABELS[group],
    products: POND_CARE_PRODUCT_GUIDES.filter((p) => p.group === group),
  })).filter((g) => g.products.length > 0)
}

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}

export const MEDICINE_CATALOG_ITEM_PREFIX = 'AQ-MED-'

export function guideIdFromItemNumber(itemNumber: string | undefined | null): string | null {
  const raw = (itemNumber || '').trim()
  if (!raw.toUpperCase().startsWith(MEDICINE_CATALOG_ITEM_PREFIX)) return null
  const gid = raw.slice(MEDICINE_CATALOG_ITEM_PREFIX.length).trim()
  return gid || null
}

export function isBuiltinMedicineCatalogItem(itemNumber: string | undefined | null): boolean {
  return guideIdFromItemNumber(itemNumber) != null
}

/** Find best-matching reference guide for an inventory item name or built-in SKU number. */
export function matchPondCareGuide(
  productName: string,
  reportingCategory?: string,
  itemNumber?: string | null,
): PondCareProductGuide | null {
  const gid = guideIdFromItemNumber(itemNumber)
  if (gid) {
    const bySku = POND_CARE_PRODUCT_GUIDES.find((g) => g.id === gid)
    if (bySku) return bySku
  }

  const n = norm(productName)
  if (!n.trim()) return null

  let best: { guide: PondCareProductGuide; score: number } | null = null

  for (const guide of POND_CARE_PRODUCT_GUIDES) {
    for (const kw of guide.keywords) {
      const k = norm(kw)
      if (!k) continue
      if (n.includes(k) || k.includes(n)) {
        const score = k.length + (n === k ? 100 : 0)
        if (!best || score > best.score) best = { guide, score }
      }
    }
  }

  if (!best && reportingCategory) {
    const rc = norm(reportingCategory)
    if (rc.includes('pond care')) {
      return POND_CARE_PRODUCT_GUIDES.find((g) => g.id === 'probiotic') ?? null
    }
  }

  return best?.guide ?? null
}

export function guideDoseLabel(guide: PondCareProductGuide): string {
  const unitLabels: Record<string, string> = {
    ppm: 'ppm',
    mg_l: 'mg/L',
    kg_m3: 'kg/m³',
    g_m3: 'g/m³',
    kg_decimal: 'kg/decimal',
    kg_pond: 'kg (pond)',
    g_ton: 'g/ton fish',
    g_kg_fish: 'g/kg fish',
    ml_l: 'mL/L',
    percent: '%',
    per_unit: 'per unit',
    other: '',
  }
  const u = unitLabels[guide.doseUnit] || guide.doseUnit
  return u ? `${guide.doseAmount} ${u}` : guide.doseAmount
}

/** Total kg from a kg/decimal rate and pond water area (decimals). */
export function totalKgForKgPerDecimalRate(
  rateKgPerDecimal: number,
  waterAreaDecimal: number,
): number {
  return rateKgPerDecimal * waterAreaDecimal
}

/** Hint under dose rate when unit is kg/decimal and pond area is known. */
export function buildKgPerDecimalDoseHint(
  pond: PondVolumeFields | null | undefined,
  doseAmount: string,
): string | null {
  const dec = parsePondWaterAreaDecimal(pond)
  const rate = Number.parseFloat(String(doseAmount).replace(/,/g, ''))
  if (!Number.isFinite(rate) || rate <= 0) return null
  if (dec == null) {
    return 'Set water area (decimal) on the pond page to estimate total kg from this rate.'
  }
  const total = totalKgForKgPerDecimalRate(rate, dec)
  return `Pond ${dec} dec × ${rate} kg/decimal ≈ ${formatMedicineQuantity(total)} kg product for this pond`
}

/** Estimate stock quantity (kg, L, etc.) from pond dimensions and guide rule. */
export function suggestQuantityFromGuide(
  guide: PondCareProductGuide,
  pond: PondVolumeFields | null | undefined,
): { quantity: string; note: string } | null {
  const m3 = pond ? pondVolumeCubicMetres(pond) : null
  const dec = parsePondWaterAreaDecimal(pond)
  const factor = guide.qtyFactor ?? Number.parseFloat(guide.doseAmount)
  if (!Number.isFinite(factor)) return null

  switch (guide.qtyRule) {
    case 'ppm': {
      if (m3 == null || m3 <= 0) return null
      // 1 ppm × m³ ≈ 1 kg active (for salts/chemicals approximating 1 g/L)
      let kg = (factor * m3) / 1000
      if (guide.stockUnit === 'liter') {
        const liters = guide.id === 'formalin' ? factor * 0.02 * m3 * 1000 : factor * m3
        return {
          quantity: formatMedicineQuantity(Math.max(0.1, liters)),
          note: guide.qtyHint || `Estimated from ~${Math.round(m3)} m³ at ${factor} ppm`,
        }
      }
      if (guide.doseUnit === 'ppm' && guide.stockUnit === 'kg') {
        kg = factor * m3
      }
      return {
        quantity: formatMedicineQuantity(Math.max(0.01, kg)),
        note: guide.qtyHint || `Estimated ${factor} ppm × ~${Math.round(m3)} m³ pond`,
      }
    }
    case 'g_m3': {
      if (m3 == null || m3 <= 0) return null
      const kg = (factor * m3) / 1000
      return {
        quantity: formatMedicineQuantity(Math.max(0.01, kg)),
        note: `Estimated ${factor} g/m³ × ~${Math.round(m3)} m³`,
      }
    }
    case 'kg_decimal': {
      if (dec == null || dec <= 0) return null
      const kg = factor * dec
      return {
        quantity: formatMedicineQuantity(Math.max(0.1, kg)),
        note:
          guide.qtyHint ||
          `Estimated ${factor} kg/decimal × ${dec} dec water area (from pond setup)`,
      }
    }
    case 'kg_pond': {
      return {
        quantity: formatMedicineQuantity(factor),
        note: 'Typical small-pond dose — adjust for your pond size',
      }
    }
    case 'liter': {
      if (m3 == null || m3 <= 0) return null
      // qtyFactor = mL product per m³ pond (e.g. formalin 15–25 mL/m³)
      const mlPerM3 = guide.qtyFactor ?? 20
      const liters = (mlPerM3 * m3) / 1000
      return {
        quantity: formatMedicineQuantity(Math.max(0.1, liters)),
        note: guide.qtyHint || `~${mlPerM3} mL/m³ × ~${Math.round(m3)} m³ pond`,
      }
    }
    case 'bottle':
      return { quantity: '1', note: 'Use per bottle label' }
    default:
      return null
  }
}

export function formatMedicineQuantity(n: number): string {
  if (n >= 100) return String(Math.round(n))
  if (n >= 10) return n.toFixed(1)
  if (n >= 1) return n.toFixed(2)
  return n.toFixed(3)
}

export interface MedicineDoseSuggestion {
  guide: PondCareProductGuide
  treatment: Partial<TreatmentFormFields>
  quantity: string | null
  quantityNote: string | null
  lineNote: string | null
}

/** Build auto-fill payload when user picks a product or catalog row. */
export function buildMedicineDoseSuggestion(
  productName: string,
  reportingCategory: string | undefined,
  pond: PondVolumeFields | null | undefined,
  itemNumber?: string | null,
): MedicineDoseSuggestion | null {
  const guide = matchPondCareGuide(productName, reportingCategory, itemNumber)
  if (!guide) return null

  const qty = suggestQuantityFromGuide(guide, pond)
  const treatment: Partial<TreatmentFormFields> = {
    purpose: guide.purpose,
    method: guide.method,
    doseAmount: guide.doseAmount,
    doseUnit: guide.doseUnit,
    withdrawalDays: guide.withdrawalDays,
    notes: guide.notes,
  }

  const lineParts = [guideDoseLabel(guide)]
  if (qty?.note) lineParts.push(qty.note)

  return {
    guide,
    treatment,
    quantity: qty?.quantity ?? null,
    quantityNote: qty?.note ?? null,
    lineNote: lineParts.join(' — '),
  }
}

/** Link catalog rows to company inventory items by name. */
export function linkGuidesToCatalog<
  T extends { id: number; name: string; category?: string; item_number?: string },
>(
  guides: PondCareProductGuide[],
  catalog: T[],
): Map<string, T | null> {
  const m = new Map<string, T | null>()
  for (const guide of guides) {
    const sku = `${MEDICINE_CATALOG_ITEM_PREFIX}${guide.id}`
    m.set(
      guide.id,
      catalog.find(
        (item) =>
          (item.item_number || '').trim().toUpperCase() === sku.toUpperCase() ||
          matchPondCareGuide(item.name, item.category, item.item_number)?.id === guide.id,
      ) ?? null,
    )
  }
  return m
}

export function defaultStockUnitForGuide(guide: PondCareProductGuide): string {
  return guide.stockUnit || suggestMedicineStockUnit(guide.name)
}
