/**
 * Stock units and dose labels for aquaculture medicine / pond treatments.
 * Stock quantity always uses the item's inventory unit (kg, bag, L, bottle, …).
 */

export interface MedicineUnitOption {
  value: string
  label: string
  hint: string
}

/** Recommended units when creating medicine / treatment SKUs. */
export const AQUACULTURE_MEDICINE_STOCK_UNITS: MedicineUnitOption[] = [
  { value: 'kg', label: 'Kilogram (kg)', hint: 'Lime, agricultural lime, salt, zeolite, bulk powder' },
  { value: 'bag', label: 'Bag', hint: 'Pre-packed lime, salt, dolomite (weight on bag label)' },
  { value: 'sack', label: 'Sack', hint: 'Large sacks — use kg per sack on item if you track weight' },
  { value: 'gram', label: 'Gram (g)', hint: 'Very small powder amounts' },
  { value: 'liter', label: 'Liter (L)', hint: 'Liquid treatments, formalin, probiotics' },
  { value: 'bottle', label: 'Bottle', hint: 'Bottled concentrate (often used as 1 bottle per dose)' },
  { value: 'vial', label: 'Vial', hint: 'Injectables or small ampoules' },
  { value: 'pack', label: 'Pack', hint: 'Blister packs, multi-dose packs' },
  { value: 'piece', label: 'Piece / each', hint: 'Tablets, single units' },
  { value: 'box', label: 'Box', hint: 'Boxed supply (check label for kg or L inside)' },
  { value: 'can', label: 'Can', hint: 'Canned liquid or powder' },
]

const UNIT_DISPLAY: Record<string, string> = {
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  g: 'g',
  gram: 'g',
  grams: 'g',
  l: 'L',
  liter: 'L',
  litre: 'L',
  liters: 'L',
  litres: 'L',
  ml: 'mL',
  sack: 'sack',
  bag: 'bag',
  bottle: 'bottle',
  vial: 'vial',
  pack: 'pack',
  piece: 'pc',
  each: 'each',
  box: 'box',
  can: 'can',
  carton: 'carton',
  gallon: 'gal',
}

/** Short label shown beside quantities (history, on-hand, form). */
export function formatStockUnit(unit: string | null | undefined): string {
  const raw = (unit || '').trim().toLowerCase()
  if (!raw) return 'unit'
  return UNIT_DISPLAY[raw] ?? raw
}

/** Longer label for item dropdowns and setup hints. */
export function formatStockUnitLong(unit: string | null | undefined): string {
  const short = formatStockUnit(unit)
  const hit = AQUACULTURE_MEDICINE_STOCK_UNITS.find((u) => u.value === short || u.value === (unit || '').toLowerCase())
  return hit?.label ?? short
}

/** Suggest inventory UOM from product name (lime → kg, etc.). */
export function suggestMedicineStockUnit(productName: string, reportingCategory?: string): string {
  const n = (productName || '').toLowerCase()
  const cat = (reportingCategory || '').toLowerCase()

  if (/lime|chuna|calcium|dolomite|zeolite|agricultural lime|hydrated/.test(n)) return 'kg'
  if (/salt|sodium|potassium|bicarbonate|alum|copper sulphate|copper sulfate|bleach/.test(n)) return 'kg'
  if (/formalin|formaldehyde|permanganate|potassium|malachite|methylene|probiotic|enzyme/.test(n)) {
    return /liquid|solution|suspension/.test(n) ? 'liter' : 'bottle'
  }
  if (/oxy|oxygen|peroxide|disinfect|sanit/.test(n)) return /tablet/.test(n) ? 'pack' : 'liter'
  if (/vitamin|mineral|premix|supplement/.test(n)) return /feed/.test(n) ? 'kg' : 'pack'
  if (/antibiotic|medicine|treatment|thera/.test(cat)) return 'bottle'
  if (/powder|granular|granule/.test(n)) return 'kg'
  if (/tablet|capsule/.test(n)) return 'piece'
  if (/injection|injectable/.test(n)) return 'vial'

  return 'kg'
}

export function quantityPlaceholderForUnit(unit: string | null | undefined): string {
  const u = formatStockUnit(unit)
  switch (u) {
    case 'kg':
      return 'e.g. 25'
    case 'g':
      return 'e.g. 500'
    case 'L':
      return 'e.g. 2.5'
    case 'mL':
      return 'e.g. 100'
    case 'sack':
    case 'bag':
      return 'e.g. 2'
    case 'bottle':
    case 'vial':
      return 'e.g. 1'
    case 'pack':
    case 'pc':
      return 'e.g. 3'
    default:
      return 'e.g. 1'
  }
}

export function productOptionLabel(name: string, unit?: string | null): string {
  const u = formatStockUnit(unit)
  return u && u !== 'unit' ? `${name} (${u})` : name
}
