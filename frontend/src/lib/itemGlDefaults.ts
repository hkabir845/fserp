/**
 * Template GL account codes for Item chart-of-accounts overrides.
 * Matches backend `api.services.gl_posting` (4100/4200/5100/5120/1200/1220/6900).
 */

export const ITEM_GL_REV_FUEL = '4100'
export const ITEM_GL_REV_SHOP = '4200'
export const ITEM_GL_REV_AQ_HARVEST = '4240'
export const ITEM_GL_REV_AQ_FINGERLING = '4241'
export const ITEM_GL_COGS_FUEL = '5100'
export const ITEM_GL_COGS_SHOP = '5120'
export const ITEM_GL_INV_FUEL = '1200'
export const ITEM_GL_INV_SHOP = '1220'
export const ITEM_GL_INV_AQ_BIO = '1581'
export const ITEM_GL_EXP_OFFICE = '6900'

export interface ItemGlSuggestContext {
  pos_category: string
  item_type: string
  category?: string
  unit?: string
  name?: string
}

export interface CoaPickForItemDefault {
  id: number
  account_code: string
  account_name?: string
}

/** Mirror `gl_posting._is_fuel_item` / `item_catalog._legacy_fuel_like_for_stock`. */
export function isFuelLikeItem(ctx: ItemGlSuggestContext): boolean {
  const unit = String(ctx.unit || '').toLowerCase()
  const posCat = String(ctx.pos_category || '').toLowerCase()
  const cat = String(ctx.category || '').toLowerCase()
  const name = String(ctx.name || '').toLowerCase()
  if (unit === 'l' || unit === 'liter' || unit === 'litre' || unit === 'gal' || unit === 'gallon') {
    return true
  }
  if (posCat.includes('fuel') || cat.includes('fuel')) return true
  const fuelNameTokens = [
    'diesel',
    'petrol',
    'gasoline',
    'gasohol',
    'octane',
    'premium',
    'mogas',
    'kerosene',
    'e85',
    'biodiesel',
    'lpg',
    'cng',
  ]
  return fuelNameTokens.some((tok) => name.includes(tok))
}

function isFishPosCategory(ctx: ItemGlSuggestContext): boolean {
  return String(ctx.pos_category || '').toLowerCase() === 'fish'
}

function isFingerlingLike(ctx: ItemGlSuggestContext): boolean {
  const hay = `${ctx.category || ''} ${ctx.name || ''}`.toLowerCase()
  return /(fingerling|fingerlings|\bfry\b|fry\s)/.test(hay)
}

export function suggestedRevenueCoaCode(ctx: ItemGlSuggestContext): string {
  if (isFuelLikeItem(ctx)) return ITEM_GL_REV_FUEL
  if (isFishPosCategory(ctx)) {
    return isFingerlingLike(ctx) ? ITEM_GL_REV_AQ_FINGERLING : ITEM_GL_REV_AQ_HARVEST
  }
  const pc = String(ctx.pos_category || '').toLowerCase()
  if (['shop', 'c-store', 'convenience', 'general', 'feed', 'other', 'service'].includes(pc)) {
    return ITEM_GL_REV_SHOP
  }
  return ITEM_GL_REV_SHOP
}

export function suggestedCogsCoaCode(ctx: ItemGlSuggestContext): string {
  if (isFuelLikeItem(ctx)) return ITEM_GL_COGS_FUEL
  return ITEM_GL_COGS_SHOP
}

export function suggestedInventoryCoaCode(ctx: ItemGlSuggestContext): string {
  if (isFuelLikeItem(ctx)) return ITEM_GL_INV_FUEL
  if (isFishPosCategory(ctx)) return ITEM_GL_INV_AQ_BIO
  return ITEM_GL_INV_SHOP
}

export function suggestedExpenseCoaCode(_ctx: ItemGlSuggestContext): string {
  return ITEM_GL_EXP_OFFICE
}

export function coaIdForCode(
  code: string,
  coaOptions: CoaPickForItemDefault[]
): string {
  const normalized = code.trim()
  const match = coaOptions.find((a) => String(a.account_code || '').trim() === normalized)
  return match && match.id > 0 ? String(match.id) : ''
}

export function suggestItemGlAccountIds(
  ctx: ItemGlSuggestContext,
  coaOptions: CoaPickForItemDefault[]
): {
  revenue_account_id: string
  cogs_account_id: string
  inventory_account_id: string
  expense_account_id: string
} {
  const it = String(ctx.item_type || 'inventory').toLowerCase()
  const revenue =
    it === 'service' ? '' : coaIdForCode(suggestedRevenueCoaCode(ctx), coaOptions)
  const cogs = it === 'inventory' ? coaIdForCode(suggestedCogsCoaCode(ctx), coaOptions) : ''
  const inventory =
    it === 'inventory' ? coaIdForCode(suggestedInventoryCoaCode(ctx), coaOptions) : ''
  const expense =
    it === 'non_inventory' || it === 'service'
      ? coaIdForCode(suggestedExpenseCoaCode(ctx), coaOptions)
      : ''
  return {
    revenue_account_id: revenue,
    cogs_account_id: cogs,
    inventory_account_id: inventory,
    expense_account_id: expense,
  }
}

export function recommendedCoaLabel(
  code: string,
  coaOptions: CoaPickForItemDefault[]
): string {
  const match = coaOptions.find((a) => String(a.account_code || '').trim() === code.trim())
  if (match) {
    const name = String(match.account_name || '').trim()
    return name ? `${code} — ${name}` : code
  }
  return code
}

export function templateDefaultOptionLabel(
  code: string,
  coaOptions: CoaPickForItemDefault[]
): string {
  const label = recommendedCoaLabel(code, coaOptions)
  return `— Recommended: ${label} —`
}
