import type { AppLanguage } from '@/lib/i18n'
import { pick } from '@/lib/i18n'
import { COA_ACCOUNT_I18N } from '@/lib/coaAccountI18nData'

const SUB_TYPE_LABELS: Record<string, { en: string; bn: string }> = {
  cash_on_hand: { en: 'Cash on Hand', bn: 'হাতে নগদ' },
  checking: { en: 'Checking', bn: 'চেকিং' },
  savings: { en: 'Savings', bn: 'সঞ্চয়' },
  money_market: { en: 'Money Market', bn: 'মানি মার্কেট' },
  cash_management: { en: 'Cash Management', bn: 'ক্যাশ ম্যানেজমেন্ট' },
  other_bank_account: { en: 'Other Bank Account', bn: 'অন্যান্য ব্যাংক অ্যাকাউন্ট' },
  accounts_receivable: { en: 'Accounts Receivable', bn: 'পাওনা হিসাব' },
  inventory: { en: 'Inventory', bn: 'ইনভেন্টরি' },
  prepaid_expenses: { en: 'Prepaid Expenses', bn: 'অগ্রিম খরচ' },
  fixed_asset: { en: 'Fixed Asset', bn: 'স্থায়ী সম্পদ' },
  machinery_and_equipment: { en: 'Machinery and Equipment', bn: 'যন্ত্রপাতি ও সরঞ্জাম' },
  vehicles: { en: 'Vehicles', bn: 'যানবাহন' },
  other_current_asset: { en: 'Other Current Asset', bn: 'অন্যান্য চলতি সম্পদ' },
  other_current_assets: { en: 'Other Current Assets', bn: 'অন্যান্য চলতি সম্পদ' },
  allowance_for_bad_debts: { en: 'Allowance for bad debts (contra AR)', bn: 'খেলাপি ধারের জন্য allowance (contra AR)' },
  accumulated_depreciation: { en: 'Accumulated depreciation (contra asset)', bn: 'সঞ্চিত মূল্যহ্রাস (contra asset)' },
  accounts_payable: { en: 'Accounts Payable', bn: 'দেনা হিসাব' },
  credit_card: { en: 'Credit Card', bn: 'ক্রেডিট কার্ড' },
  sales_tax_payable: { en: 'Sales Tax Payable', bn: 'বিক্রয় কর প্রদেয়' },
  payroll_tax_payable: { en: 'Payroll Tax Payable', bn: 'পে-রোল কর প্রদেয়' },
  loan_payable: { en: 'Loan Payable', bn: 'ঋণ প্রদেয়' },
  loan_receivable: { en: 'Loan receivable (money you lent)', bn: 'ঋণ প্রাপ্য (আপনি যা ধার দিয়েছেন)' },
  other_current_liability: { en: 'Other Current Liability', bn: 'অন্যান্য চলতি দায়' },
  long_term_liability: { en: 'Long Term Liability', bn: 'দীর্ঘমেয়াদি দায়' },
  equity: { en: 'Equity', bn: 'ইকুইটি' },
  owner_equity: { en: 'Owner Equity', bn: 'মালিকের ইকুইটি' },
  retained_earnings: { en: 'Retained Earnings', bn: 'অবশিষ্ট আয়' },
  opening_balance_equity: { en: 'Opening Balance Equity', bn: 'ওপেনিং ব্যালেন্স ইকুইটি' },
  income: { en: 'Income', bn: 'আয়' },
  sales_of_product_income: { en: 'Sales of Product Income', bn: 'পণ্য বিক্রয় আয়' },
  service_fee_income: { en: 'Service Fee Income', bn: 'সেবা ফি আয়' },
  other_income: { en: 'Other Income', bn: 'অন্যান্য আয়' },
  discounts_refunds_given: { en: 'Discounts & refunds (contra revenue)', bn: 'ছাড় ও ফেরত (contra revenue)' },
  expense: { en: 'Expense', bn: 'খরচ' },
  utilities: { en: 'Utilities', bn: 'উপযোগিতা' },
  rent_or_lease_of_buildings: { en: 'Rent or Lease', bn: 'ভাড়া বা লিজ' },
  repair_maintenance: { en: 'Repair & Maintenance', bn: 'মেরামত ও রক্ষণাবেক্ষণ' },
  supplies_materials: { en: 'Supplies & Materials', bn: 'সরবরাহ ও উপকরণ' },
  office_general_administrative_expenses: { en: 'Office & Administrative', bn: 'অফিস ও প্রশাসন' },
  advertising_promotional: { en: 'Advertising & Promotional', bn: 'বিজ্ঞাপন ও প্রচার' },
  insurance: { en: 'Insurance', bn: 'বীমা' },
  payroll_expenses: { en: 'Payroll Expenses', bn: 'পে-রোল খরচ' },
  other_business_expenses: { en: 'Other Business Expenses', bn: 'অন্যান্য ব্যবসায়িক খরচ' },
  cost_of_goods_sold: { en: 'Cost of Goods Sold', bn: 'বিক্রীত পণ্যের খরচ' },
  supplies_materials_cogs: { en: 'Supplies & Materials COGS', bn: 'সরবরাহ ও উপকরণ COGS' },
  cost_of_labor_cos: { en: 'Cost of Labor COS', bn: 'শ্রম খরচ COS' },
}

function rowForCode(code: string) {
  return COA_ACCOUNT_I18N[String(code || '').trim()]
}

export function localizeCoaAccountName(
  accountCode: string,
  fallbackName: string,
  lang: AppLanguage
): string {
  const row = rowForCode(accountCode)
  if (lang === 'bn' && row?.name.bn) return row.name.bn
  return fallbackName || row?.name.en || ''
}

export function localizeCoaAccountDescription(
  accountCode: string,
  fallbackDescription: string,
  lang: AppLanguage
): string {
  const row = rowForCode(accountCode)
  if (lang === 'bn' && row?.description.bn) return row.description.bn
  return fallbackDescription || row?.description.en || ''
}

export function localizeCoaAccountSubType(subType: string, lang: AppLanguage): string {
  const key = String(subType || '').trim().toLowerCase()
  if (!key) return ''
  const row = SUB_TYPE_LABELS[key]
  if (row) return pick(lang, row.en, row.bn)
  if (lang === 'bn') {
    return key.replace(/_/g, ' ')
  }
  return key.replace(/_/g, ' ')
}

/** Match filter against stored name and built-in localized name. */
export function coaAccountNameMatchesFilter(
  accountCode: string,
  accountName: string,
  filter: string,
  lang: AppLanguage
): boolean {
  const q = filter.trim().toLowerCase()
  if (!q) return true
  if (accountName.toLowerCase().includes(q)) return true
  const localized = localizeCoaAccountName(accountCode, accountName, lang)
  return localized.toLowerCase().includes(q)
}
