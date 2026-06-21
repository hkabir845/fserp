import type { AppLanguage } from '@/lib/i18n'
import { pick } from '@/lib/i18n'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'

type Row = { en: string; bn: string }

const strings: Record<string, Row> = {
  loading: { en: 'Loading chart of accounts…', bn: 'অ্যাকাউন্ট চার্ট লোড হচ্ছে…' },
  errorTitle: { en: 'Error Loading Chart of Accounts', bn: 'অ্যাকাউন্ট চার্ট লোড করতে ত্রুটি' },
  retry: { en: 'Retry', bn: 'পুনরায় চেষ্টা' },
  newAccount: { en: 'New Account', bn: 'নতুন অ্যাকাউন্ট' },
  manageFallback: {
    en: 'Manage your accounting chart of accounts',
    bn: 'আপনার অ্যাকাউন্টিং চার্ট পরিচালনা করুন',
  },

  posMoneyTitle: {
    en: 'Where is my cashier / POS sale money?',
    bn: 'ক্যাশিয়ার / POS বিক্রির টাকা কোথায়?',
  },
  posMoneyP1a: { en: 'It is', bn: 'এটা' },
  posMoneyNot: { en: 'not', bn: 'হারিয়ে যায়নি' },
  posMoneyP1b: {
    en: 'missing — it is booked as a',
    bn: '— এটি এই চার্টে একটি',
  },
  posMoneyDebit: { en: 'debit', bn: 'ডেবিট' },
  posMoneyP1c: { en: 'on a', bn: 'হিসেবে' },
  posMoneyCashAsset: { en: 'cash asset', bn: 'নগদ সম্পদ' },
  posMoneyP1d: {
    en: 'in this chart (after you seed the fuel template, usually code',
    bn: 'বুক করা হয় (ফুয়েল টেমপ্লেট ইম্পোর্টের পর, সাধারণত কোড',
  },
  posMoneyP1e: { en: 'Petty cash or', bn: 'পেটি ক্যাশ অথবা' },
  posMoneyP1f: { en: 'Cash clearing / undeposited).', bn: 'ক্যাশ ক্লিয়ারিং / জমা হয়নি)।' },
  posMoneyCard: { en: 'Card', bn: 'কার্ড' },
  posMoneyP2a: { en: 'sales use', bn: 'বিক্রি' },
  posMoneyP2b: { en: 'card clearing. There is no separate “Undeposited funds” menu: open the account here and use', bn: 'কার্ড ক্লিয়ারিং ব্যবহার করে। আলাদা “Undeposited funds” মেনু নেই: এখানে অ্যাকাউন্ট খুলে' },
  posMoneyViewStatement: { en: 'View statement', bn: 'স্টেটমেন্ট দেখুন' },
  posMoneyP3a: {
    en: 'to see each sale. On',
    bn: 'ব্যবহার করে প্রতিটি বিক্রি দেখুন।',
  },
  posMoneyTrialBalance: { en: 'Reports → Trial balance', bn: 'রিপোর্ট → ট্রায়াল ব্যালেন্স' },
  posMoneyP3b: {
    en: ', widen the date range to include the sale dates and scroll for codes',
    bn: 'এ গিয়ে তারিখের পরিসর বাড়িয়ে বিক্রির তারিখ অন্তর্ভুক্ত করুন এবং কোড',
  },
  posMoneyP3c: { en: 'or', bn: 'অথবা' },
  posMoneyP3d: {
    en: 'To hit a specific bank line instead, use the optional',
    bn: 'নির্দিষ্ট ব্যাংক লাইনে রেকর্ড করতে, ক্যাশিয়ার স্ক্রিনে ঐচ্ছিক',
  },
  posMoneyCashPicker: {
    en: "Where to record this sale's cash",
    bn: 'এই বিক্রির নগদ কোথায় রেকর্ড করবেন',
  },
  posMoneyP3e: { en: 'picker on the Cashier screen.', bn: 'পিকার ব্যবহার করুন।' },

  quickFilter: { en: 'Quick filter:', bn: 'দ্রুত ফিল্টার:' },
  filter1020: { en: '1020 Undeposited', bn: '1020 জমা হয়নি' },
  filter1120: { en: '1120 Card', bn: '1120 কার্ড' },
  filterNameUndeposited: { en: 'Name contains “undeposited”', bn: 'নামে “undeposited” আছে' },
  clearFilters: { en: 'Clear filters', bn: 'ফিল্টার সাফ করুন' },

  unlinkedBanksTitle: {
    en: 'Bank registers are not on this list yet',
    bn: 'ব্যাংক রেজিস্টার এখনো এই তালিকায় নেই',
  },
  unlinkedBanksBody: {
    en: 'Only chart accounts appear in the table below. You still have {count} bank/cash register{plural} that were never given a chart line (for example from the old Bank Accounts flow). Use the button to create matching chart lines with automatic codes.',
    bn: 'নিচের টেবিলে শুধু চার্ট অ্যাকাউন্ট দেখায়। আপনার {count}টি ব্যাংক/নগদ রেজিস্টার{plural} এখনো চার্ট লাইন পায়নি (যেমন পুরনো Bank Accounts ফ্লো থেকে)। স্বয়ংক্রিয় কোডে মিলিয়ে চার্ট লাইন তৈরি করতে বোতাম ব্যবহার করুন।',
  },
  unlinkedBanksMore: { en: '…and {n} more', bn: '…আর {n}টি' },
  syncingBanks: { en: 'Syncing…', bn: 'সিঙ্ক হচ্ছে…' },
  syncBanksToChart: {
    en: 'Sync banks to chart (auto codes)',
    bn: 'ব্যাংক চার্টে সিঙ্ক করুন (অটো কোড)',
  },
  syncBanksHint: {
    en: 'Creates one asset line per register; then they show in the table with institution and account number.',
    bn: 'প্রতি রেজিস্টারে একটি সম্পদ লাইন তৈরি করে; তারপর প্রতিষ্ঠান ও অ্যাকাউন্ট নম্বরসহ টেবিলে দেখায়।',
  },
  superAdminHint: {
    en: 'Super admin: bank data is scoped to the selected company. If you see no banks here, open the company selector and choose the tenant where Adib / United Commercial accounts were created, then refresh this page.',
    bn: 'সুপার অ্যাডমিন: ব্যাংক ডাটা নির্বাচিত কোম্পানিতে সীমাবদ্ধ। এখানে ব্যাংক না দেখলে কোম্পানি সিলেক্টর খুলে সেই টেন্যান্ট বেছে নিন যেখানে Adib / United Commercial অ্যাকাউন্ট তৈরি হয়েছিল, তারপর পৃষ্ঠা রিফ্রেশ করুন।',
  },
  superAdminLabel: { en: 'Super admin:', bn: 'সুপার অ্যাডমিন:' },
  selectedCompany: { en: 'selected company', bn: 'নির্বাচিত কোম্পানি' },
  chartWord: { en: 'chart', bn: 'চার্ট' },

  fuelTemplateName: {
    en: 'FSERP — Fuel Station (International Retail Petroleum)',
    bn: 'FSERP — ফুয়েল স্টেশন (আন্তর্জাতিক রিটেইল পেট্রোলিয়াম)',
  },
  fuelTemplateSummary: {
    en: 'Industry-style COA for retail fuel: cash & banking, card clearing, tank inventory, fuel and non-fuel revenue, COGS, merchant fees, shrinkage, and statutory payables. Use as a starting point — rename tax accounts for your country and add accounts as needed.',
    bn: 'রিটেইল জ্বালানির জন্য ইন্ডাস্ট্রি-স্টাইল COA: নগদ ও ব্যাংকিং, কার্ড ক্লিয়ারিং, ট্যাঙ্ক ইনভেন্টরি, জ্বালানি ও নন-ফুয়েল আয়, COGS, মার্চেন্ট ফি, শ্রিঙ্কেজ ও আইনগত দেনা। শুরুর পয়েন্ট হিসেবে ব্যবহার করুন — আপনার দেশের জন্য ট্যাক্স অ্যাকাউন্টের নাম বদলান ও প্রয়োজনে অ্যাকাউন্ট যোগ করুন।',
  },
  fuelTemplateFallbackName: {
    en: 'Fuel station chart of accounts',
    bn: 'ফুয়েল স্টেশন অ্যাকাউন্ট চার্ট',
  },
  importFullTemplate: { en: 'Import full template', bn: 'সম্পূর্ণ টেমপ্লেট ইম্পোর্ট' },
  importFuelFirst: { en: 'Import fuel-first (retail)', bn: 'ফুয়েল-ফার্স্ট ইম্পোর্ট (রিটেইল)' },
  replaceAllTemplate: { en: 'Replace all with full template', bn: 'সব পূর্ণ টেমপ্লেট দিয়ে প্রতিস্থাপন' },
  fillMissingDescriptions: { en: 'Fill missing descriptions', bn: 'অনুপস্থিত বিবরণ পূরণ' },
  fillMissingDescriptionsTitle: {
    en: 'Fill only accounts that still have an empty description',
    bn: 'শুধু যেসব অ্যাকাউন্টের বিবরণ খালি আছে সেগুলো পূরণ করুন',
  },

  accountSingular: { en: 'account', bn: 'অ্যাকাউন্ট' },
  accountPlural: { en: 'accounts', bn: 'অ্যাকাউন্ট' },
  searchAndFilter: { en: 'Search & Filter', bn: 'খোঁজ ও ফিল্টার' },
  clearAll: { en: 'Clear All', bn: 'সব সাফ করুন' },
  accountCode: { en: 'Account Code', bn: 'অ্যাকাউন্ট কোড' },
  searchByCode: { en: 'Search by code…', bn: 'কোড দিয়ে খুঁজুন…' },
  searchByName: { en: 'Search by name…', bn: 'নাম দিয়ে খুঁজুন…' },
  accountType: { en: 'Account Type', bn: 'অ্যাকাউন্ট ধরন' },
  allTypesOption: { en: 'All Types', bn: 'সব ধরন' },
  code: { en: 'Code', bn: 'কোড' },
  accountName: { en: 'Account Name', bn: 'অ্যাকাউন্টের নাম' },
  type: { en: 'Type', bn: 'ধরন' },
  subType: { en: 'Sub-Type', bn: 'সাব-টাইপ' },
  balance: { en: 'Balance', bn: 'ব্যালেন্স' },
  status: { en: 'Status', bn: 'স্ট্যাটাস' },
  actions: { en: 'Actions', bn: 'কর্ম' },
  active: { en: 'Active', bn: 'সক্রিয়' },
  inactive: { en: 'Inactive', bn: 'নিষ্ক্রিয়' },
  noAccountsFound: { en: 'No Accounts Found', bn: 'কোনো অ্যাকাউন্ট পাওয়া যায়নি' },
  noMatchingAccounts: { en: 'No Matching Accounts', bn: 'মিলে এমন অ্যাকাউন্ট নেই' },
  emptyChartHint: {
    en: 'Use Import full template above for the complete fuel-station chart with descriptions, or add a single custom account.',
    bn: 'বিবরণসহ সম্পূর্ণ ফুয়েল-স্টেশন চার্টের জন্য উপরে সম্পূর্ণ টেমপ্লেট ইম্পোর্ট করুন, অথবা একটি কাস্টম অ্যাকাউন্ট যোগ করুন।',
  },
  noFilterMatch: {
    en: 'No accounts match your current filters. Try adjusting your search criteria.',
    bn: 'বর্তমান ফিল্টারে কোনো অ্যাকাউন্ট মিলছে না। খোঁজের শর্ত বদলিয়ে দেখুন।',
  },
  createOneAccount: { en: 'Create one account', bn: 'একটি অ্যাকাউন্ট তৈরি' },
  unnamedAccount: { en: 'Unnamed Account', bn: 'নামহীন অ্যাকাউন্ট' },
  viewStatement: { en: 'View statement', bn: 'স্টেটমেন্ট দেখুন' },
  editAccount: { en: 'Edit / update account', bn: 'অ্যাকাউন্ট সম্পাদনা / আপডেট' },
  bankDepositDetails: { en: 'Bank / deposit details', bn: 'ব্যাংক / জমা বিবরণ' },
  unknown: { en: 'Unknown', bn: 'অজানা' },

  accountType_asset: { en: 'Asset', bn: 'সম্পদ' },
  accountType_bank_account: { en: 'Bank Account', bn: 'ব্যাংক অ্যাকাউন্ট' },
  accountType_liability: { en: 'Liability', bn: 'দায়' },
  accountType_loan: { en: 'Loan', bn: 'ঋণ' },
  accountType_equity: { en: 'Equity', bn: 'ইকুইটি' },
  accountType_income: { en: 'Income', bn: 'আয়' },
  accountType_expense: { en: 'Expense', bn: 'খরচ' },
  accountType_cost_of_goods_sold: { en: 'Cost of Goods Sold', bn: 'বিক্রীত পণ্যের খরচ' },

  replaceConfirm: {
    en: 'Replace all chart of accounts for this company? Existing accounts will be deleted. Linked journal entries may become invalid. This cannot be undone.',
    bn: 'এই কোম্পানির সব অ্যাকাউন্ট চার্ট প্রতিস্থাপন করবেন? বিদ্যমান অ্যাকাউন্ট মুছে যাবে। সংযুক্ত জার্নাল এন্ট্রি অবৈধ হতে পারে। এটি পূর্বাবস্থায় ফেরানো যাবে না।',
  },
  toastChartReplaced: {
    en: 'Chart replaced: {added} account(s) imported.',
    bn: 'চার্ট প্রতিস্থাপিত: {added}টি অ্যাকাউন্ট ইম্পোর্ট।',
  },
  toastTemplateApplied: {
    en: 'Template applied: {added} new account(s), {skipped} already existed (skipped).',
    bn: 'টেমপ্লেট প্রয়োগ: {added}টি নতুন অ্যাকাউন্ট, {skipped}টি ইতিমধ্যে ছিল (এড়ানো)।',
  },
  toastImportFailed: {
    en: 'Could not import chart template.',
    bn: 'চার্ট টেমপ্লেট ইম্পোর্ট করা যায়নি।',
  },
  toastDescriptionsUpdated: {
    en: 'Updated {u} account description(s) from the built-in guide.',
    bn: 'বিল্ট-ইন গাইড থেকে {u}টি অ্যাকাউন্টের বিবরণ আপডেট।',
  },
  toastNoDescriptions: {
    en: 'No empty descriptions to fill (or no matching template codes).',
    bn: 'পূরণ করার খালি বিবরণ নেই (অথবা মিলে এমন টেমপ্লেট কোড নেই)।',
  },
  toastBackfillFailed: {
    en: 'Could not backfill descriptions.',
    bn: 'বিবরণ পূরণ করা যায়নি।',
  },
}

export function chartOfAccountsT(
  key: string,
  lang: AppLanguage,
  vars?: Record<string, string | number>
): string {
  const row = strings[key]
  if (!row) return key
  let s = pick(lang, row.en, row.bn)
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}

export function useChartOfAccountsT() {
  const { language } = useCompanyLocale()
  return (key: string, vars?: Record<string, string | number>) =>
    chartOfAccountsT(key, language, vars)
}

export function coaAccountTypeLabel(value: string, lang: AppLanguage): string {
  const key = `accountType_${value}`
  const row = strings[key]
  return row ? pick(lang, row.en, row.bn) : value
}
