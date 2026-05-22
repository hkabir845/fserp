/** Shared helpers for aquaculture medicine / treatment events. */

import {
  formatStockUnit,
  productOptionLabel,
  quantityPlaceholderForUnit,
  suggestMedicineStockUnit,
} from '@/lib/aquacultureMedicineUnits'

export {
  formatStockUnit,
  productOptionLabel,
  quantityPlaceholderForUnit,
  suggestMedicineStockUnit,
}

export const TREATMENT_PURPOSES = [
  { id: 'preventive', label: 'Preventive' },
  { id: 'therapeutic', label: 'Therapeutic (disease)' },
  { id: 'water_quality', label: 'Water quality' },
  { id: 'parasite', label: 'Parasite control' },
  { id: 'bacterial', label: 'Bacterial infection' },
  { id: 'fungal', label: 'Fungal infection' },
  { id: 'vitamin', label: 'Vitamin / supplement' },
  { id: 'other', label: 'Other' },
] as const

export const APPLICATION_METHODS = [
  { id: 'bath', label: 'Water bath / pond dose' },
  { id: 'feed_mix', label: 'Mixed in feed' },
  { id: 'injection', label: 'Injection' },
  { id: 'spray', label: 'Surface spray' },
  { id: 'dip', label: 'Short dip / handling' },
  { id: 'other', label: 'Other' },
] as const

export const DOSE_UNITS = [
  { id: 'ppm', label: 'ppm (mg/L)' },
  { id: 'mg_l', label: 'mg/L' },
  { id: 'kg_m3', label: 'kg per m³ pond water' },
  { id: 'g_m3', label: 'g per m³ pond water' },
  { id: 'kg_decimal', label: 'kg per decimal (water area)' },
  { id: 'kg_pond', label: 'kg total (whole pond)' },
  { id: 'g_ton', label: 'g per ton fish biomass' },
  { id: 'g_kg_fish', label: 'g per kg fish' },
  { id: 'ml_l', label: 'mL/L' },
  { id: 'percent', label: '% solution' },
  { id: 'per_unit', label: 'per inventory unit used' },
  { id: 'other', label: 'other (see notes)' },
] as const

export type TreatmentPurposeId = (typeof TREATMENT_PURPOSES)[number]['id']
export type ApplicationMethodId = (typeof APPLICATION_METHODS)[number]['id']
export type DoseUnitId = (typeof DOSE_UNITS)[number]['id']

export interface TreatmentFormFields {
  purpose: TreatmentPurposeId | ''
  method: ApplicationMethodId | ''
  doseAmount: string
  doseUnit: DoseUnitId | ''
  waterVolume: string
  withdrawalDays: string
  appliedBy: string
  notes: string
}

export interface ParsedTreatmentMemo {
  batch: string
  purpose: string
  method: string
  dose: string
  water: string
  withdrawal: string
  staff: string
  product: string
  notes: string
}

const PURPOSE_LABEL = new Map(TREATMENT_PURPOSES.map((p) => [p.id, p.label]))
const METHOD_LABEL = new Map(APPLICATION_METHODS.map((m) => [m.id, m.label]))

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export function purposeLabel(id: TreatmentPurposeId | ''): string {
  if (!id) return ''
  return PURPOSE_LABEL.get(id) ?? id
}

export function methodLabel(id: ApplicationMethodId | ''): string {
  if (!id) return ''
  return METHOD_LABEL.get(id) ?? id
}

export function doseUnitLabel(id: DoseUnitId | ''): string {
  if (!id) return ''
  return DOSE_UNITS.find((u) => u.id === id)?.label ?? id
}

/** Build memo stored on AquacultureExpense (human-readable, parseable). */
export function buildTreatmentMemo(fields: TreatmentFormFields): string {
  const parts: string[] = []
  const pl = purposeLabel(fields.purpose as TreatmentPurposeId)
  if (pl) parts.push(`Purpose: ${pl}`)
  const ml = methodLabel(fields.method as ApplicationMethodId)
  if (ml) parts.push(`Method: ${ml}`)
  const doseAmt = fields.doseAmount.trim()
  const du = doseUnitLabel(fields.doseUnit as DoseUnitId)
  if (doseAmt && du) parts.push(`Dose: ${doseAmt} ${du}`)
  else if (doseAmt) parts.push(`Dose: ${doseAmt}`)
  const wv = fields.waterVolume.trim()
  if (wv) parts.push(`Water: ${wv}`)
  const wd = fields.withdrawalDays.trim()
  if (wd) parts.push(`Withdrawal: ${wd} d`)
  const staff = fields.appliedBy.trim()
  if (staff) parts.push(`Staff: ${staff}`)

  const structured = parts.join(' | ')
  const notes = fields.notes.trim()
  if (structured && notes) return `${structured}\n${notes}`
  if (structured) return structured
  if (notes) return notes
  return 'Pond medicine treatment'
}

/** Parse structured treatment lines from expense memo. */
export function parseTreatmentMemo(memo: string): ParsedTreatmentMemo {
  const raw = (memo || '').trim()
  if (!raw) {
    return {
      batch: '',
      purpose: '',
      method: '',
      dose: '',
      water: '',
      withdrawal: '',
      staff: '',
      product: '',
      notes: '',
    }
  }
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const batchLine = lines.find((l) => l.startsWith('Batch:'))
  const batch = batchLine ? batchLine.replace(/^Batch:\s*/i, '').trim() : ''
  const pipeLine = lines.find((l) => l.includes('Purpose:') || (l.includes('|') && !l.startsWith('Product:'))) ?? ''
  const productLine = lines.find((l) => l.startsWith('Product:')) ?? ''
  const noteLines = lines.filter(
    (l) =>
      !l.startsWith('Batch:') &&
      l !== pipeLine &&
      l !== productLine &&
      !l.startsWith('Purpose:') &&
      !l.includes('|'),
  )

  const out: ParsedTreatmentMemo = {
    batch,
    purpose: '',
    method: '',
    dose: '',
    water: '',
    withdrawal: '',
    staff: '',
    product: productLine.replace(/^Product:\s*/i, '').trim(),
    notes: noteLines.join('\n').trim(),
  }

  if (!pipeLine && !productLine && !batch) {
    out.notes = raw
    return out
  }

  for (const seg of pipeLine.split('|')) {
    const s = seg.trim()
    if (s.startsWith('Purpose:')) out.purpose = s.slice('Purpose:'.length).trim()
    else if (s.startsWith('Method:')) out.method = s.slice('Method:'.length).trim()
    else if (s.startsWith('Dose:')) out.dose = s.slice('Dose:'.length).trim()
    else if (s.startsWith('Water:')) out.water = s.slice('Water:'.length).trim()
    else if (s.startsWith('Withdrawal:')) out.withdrawal = s.slice('Withdrawal:'.length).trim()
    else if (s.startsWith('Staff:')) out.staff = s.slice('Staff:'.length).trim()
  }

  return out
}

function idFromLabel<T extends { id: string; label: string }>(
  options: readonly T[],
  label: string,
): T['id'] | '' {
  const hit = options.find((o) => o.label === label.trim())
  return hit?.id ?? ''
}

const LEGACY_HA_TO_DECIMAL = 0.01 * 0.404686

function parseDoseToFields(dose: string): { doseAmount: string; doseUnit: DoseUnitId | '' } {
  const d = dose.trim()
  if (!d) return { doseAmount: '', doseUnit: '' }
  const legacyHa = d.match(/^([\d.,]+)\s*(?:kg\s*\/?\s*ha|kg per hectare)\b/i)
  if (legacyHa) {
    const haRate = Number.parseFloat(legacyHa[1].replace(/,/g, ''))
    if (Number.isFinite(haRate) && haRate > 0) {
      const perDec = haRate * LEGACY_HA_TO_DECIMAL
      const doseAmount =
        perDec >= 10
          ? String(Math.round(perDec))
          : perDec >= 1
            ? perDec.toFixed(2)
            : perDec.toFixed(3)
      return { doseAmount, doseUnit: 'kg_decimal' }
    }
  }
  for (const u of [...DOSE_UNITS].sort((a, b) => b.label.length - a.label.length)) {
    const lbl = u.label
    if (d.endsWith(lbl)) {
      const amt = d.slice(0, d.length - lbl.length).trim()
      return { doseAmount: amt, doseUnit: u.id }
    }
  }
  return { doseAmount: d, doseUnit: '' }
}

/** Hydrate edit form fields from a stored expense memo. */
export function treatmentFieldsFromMemo(memo: string): TreatmentFormFields {
  const p = parseTreatmentMemo(memo)
  const { doseAmount, doseUnit } = parseDoseToFields(p.dose)
  let withdrawalDays = ''
  const wd = p.withdrawal.trim()
  if (wd) {
    const m = wd.match(/^([\d.]+)/)
    withdrawalDays = m?.[1] ?? wd.replace(/\s*d$/i, '').trim()
  }
  return {
    purpose: idFromLabel(TREATMENT_PURPOSES, p.purpose) as TreatmentPurposeId | '',
    method: idFromLabel(APPLICATION_METHODS, p.method) as ApplicationMethodId | '',
    doseAmount,
    doseUnit,
    waterVolume: p.water.startsWith('Water:') ? p.water.slice(6).trim() : p.water,
    withdrawalDays,
    appliedBy: p.staff.startsWith('Staff:') ? p.staff.slice(6).trim() : p.staff,
    notes: p.notes,
  }
}

/** Rebuild memo when editing an existing ledger row (keeps batch + product line). */
export function rebuildMemoForLedgerRow(
  existingMemo: string,
  fields: TreatmentFormFields,
  row: { item_name?: string; quantity?: string | null; unit?: string },
): string {
  const parsed = parseTreatmentMemo(existingMemo)
  const batchMatch = existingMemo.match(/^Batch:\s*([^\n]+)/im)
  const batchRef = batchMatch ? batchMatch[1].trim().split('(')[0].trim() : null
  const batchPart = parsed.batch || batchMatch?.[1]?.trim() || ''
  const batchTotalMatch = batchPart.match(/\((\d+)\s+of\s+(\d+)\)/i)
  const lineIndex = batchTotalMatch ? Number.parseInt(batchTotalMatch[1], 10) : 1
  const total = batchTotalMatch ? Number.parseInt(batchTotalMatch[2], 10) : 1
  const productName = (row.item_name || parsed.product.split('—')[0] || '').trim()
  const qty = row.quantity != null ? String(row.quantity) : ''
  const unit = row.unit || 'unit'
  const extraLines = existingMemo
    .split('\n')
    .filter(
      (l) =>
        l.trim() &&
        !l.startsWith('Batch:') &&
        !l.includes('Purpose:') &&
        !l.startsWith('Product:') &&
        !l.includes('|'),
    )
  const lineNote = extraLines.find((l) => !fields.notes.includes(l)) ?? ''

  return buildTreatmentMemoForLine(fields, {
    batchRef: batchRef && total > 1 ? batchRef : total > 1 ? batchRef : null,
    lineIndex: Number.isFinite(lineIndex) ? lineIndex : 1,
    total: Number.isFinite(total) ? total : 1,
    productName,
    quantity: qty,
    unit,
    lineNote: lineNote && lineNote !== fields.notes.trim() ? lineNote : undefined,
  })
}

export function isBuiltinMedicineSku(itemNumber: string | undefined | null): boolean {
  return /^AQ-MED-/i.test((itemNumber || '').trim())
}

export function isMedicineItem(row: {
  pos_category?: string
  category?: string
  name?: string
  item_number?: string
}): boolean {
  if (isBuiltinMedicineSku(row.item_number)) return true
  const cat = (row.pos_category || '').toLowerCase()
  if (cat === 'medicine') return true
  const rc = (row.category || '').toLowerCase()
  if (rc.includes('medicine') || rc.includes('treatment') || rc.includes('pond care')) return true
  const name = (row.name || '').toLowerCase()
  if (
    /lime|chuna|formalin|permanganate|copper sulphate|copper sulfate|oxytetracycline|terramycin|probiotic|zeolite|dolomite|malachite|methylene/.test(
      name,
    )
  ) {
    return true
  }
  return false
}

export function monthStartIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** One medicine SKU + quantity in a multi-product treatment. */
export interface MedicineProductLine {
  id: string
  itemId: string
  quantity: string
  /** Optional per-product dose or note (e.g. different ppm per chemical). */
  lineNote: string
}

let _lineSeq = 0

export function newMedicineProductLine(defaultItemId = ''): MedicineProductLine {
  _lineSeq += 1
  return {
    id: `med-line-${Date.now()}-${_lineSeq}`,
    itemId: defaultItemId,
    quantity: '',
    lineNote: '',
  }
}

/** Short ref linking several consumption rows from one submit. */
export function makeBatchRef(expenseDate: string): string {
  const d = expenseDate.replace(/-/g, '')
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `BT-${d}-${tail}`
}

export function buildTreatmentMemoForLine(
  fields: TreatmentFormFields,
  opts: {
    batchRef: string | null
    lineIndex: number
    total: number
    productName: string
    quantity: string
    unit: string
    lineNote?: string
  },
): string {
  const lines: string[] = []
  if (opts.total > 1 && opts.batchRef) {
    lines.push(`Batch: ${opts.batchRef} (${opts.lineIndex} of ${opts.total})`)
  }
  const structured = buildTreatmentMemo(fields)
  const structuredFirst = structured.split('\n')[0]?.trim() ?? ''
  if (structuredFirst) lines.push(structuredFirst)
  const qtyLabel = opts.quantity.trim()
  const unit = opts.unit.trim() || 'unit'
  lines.push(`Product: ${opts.productName} — ${qtyLabel} ${unit}`.trim())
  const perLine = (opts.lineNote || '').trim()
  if (perLine) lines.push(perLine)
  const sharedNotes = fields.notes.trim()
  if (sharedNotes && opts.lineIndex === 1) lines.push(sharedNotes)
  return lines.join('\n')
}

export interface ValidatedMedicineLine {
  itemId: number
  quantity: number
  productName: string
  unit: string
  lineNote: string
}

export function validateMedicineProductLines(
  lines: MedicineProductLine[],
  catalog: { id: number; name: string; unit?: string }[],
  stockByItemId: Map<number, { quantity: string; unit: string }>,
): { ok: true; validated: ValidatedMedicineLine[] } | { ok: false; message: string } {
  const active = lines.filter((l) => l.itemId.trim() !== '' || l.quantity.trim() !== '')
  if (active.length === 0) {
    return { ok: false, message: 'Add at least one medicine product and quantity' }
  }

  const validated: ValidatedMedicineLine[] = []
  const qtyByItem = new Map<number, number>()

  for (let i = 0; i < lines.length; i++) {
    const row = lines[i]
    const hasItem = row.itemId.trim() !== ''
    const hasQty = row.quantity.trim() !== ''
    if (!hasItem && !hasQty) continue
    if (!hasItem) {
      return { ok: false, message: `Line ${i + 1}: select a product` }
    }
    if (!hasQty) {
      return { ok: false, message: `Line ${i + 1}: enter quantity used` }
    }
    const iid = Number.parseInt(row.itemId, 10)
    if (!Number.isFinite(iid) || iid <= 0) {
      return { ok: false, message: `Line ${i + 1}: invalid product` }
    }
    const q = Number(row.quantity.replace(/,/g, ''))
    if (!Number.isFinite(q) || q <= 0) {
      return { ok: false, message: `Line ${i + 1}: quantity must be greater than zero` }
    }
    const product = catalog.find((c) => c.id === iid)
    if (!product) {
      return { ok: false, message: `Line ${i + 1}: product not found` }
    }
    qtyByItem.set(iid, (qtyByItem.get(iid) ?? 0) + q)
    validated.push({
      itemId: iid,
      quantity: q,
      productName: product.name,
      unit: formatStockUnit(
        (product.unit || '').trim() || stockByItemId.get(iid)?.unit || 'unit',
      ),
      lineNote: row.lineNote.trim(),
    })
  }

  for (const [iid, totalQty] of qtyByItem) {
    const stock = stockByItemId.get(iid)
    if (!stock) continue
    const onHand = Number.parseFloat(stock.quantity)
    if (Number.isFinite(onHand) && totalQty > onHand) {
      const name = catalog.find((c) => c.id === iid)?.name ?? `Item #${iid}`
      return {
        ok: false,
        message: `${name}: only ${stock.quantity} ${stock.unit} on hand (requested ${totalQty})`,
      }
    }
  }

  return { ok: true, validated }
}
