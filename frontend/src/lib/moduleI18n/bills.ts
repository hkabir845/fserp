import type { AppLanguage } from '@/lib/i18n'
import { pick } from '@/lib/i18n'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'

type Row = { en: string; bn: string }

const strings: Record<string, Row> = {
  bill: { en: 'bill', bn: 'বিল' },
  bills: { en: 'bills', bn: 'বিল' },
  Bill: { en: 'Bill', bn: 'বিল' },
  Bills: { en: 'Bills', bn: 'বিল' },
  howToRecordExpenses: { en: 'How to record expenses on a bill', bn: 'বিলে ব্যয় কীভাবে রেকর্ড করবেন' },
  howToRecordHint: {
    en: 'Choose what this bill is mainly for on the form, then add lines. The form shows only the fields that match.',
    bn: 'ফর্মে এই বিল প্রধানত কিসের জন্য বেছে নিন, তারপর লাইন যোগ করুন। ফর্ম শুধু মিলে যায় এমন ক্ষেত্র দেখায়।',
  },
  tipStationShop: {
    en: 'Station / shop: fuel + tank; shop items + header station; site costs with Station cost type — split across sites with Shared on a line.',
    bn: 'স্টেশন / দোকান: জ্বালানি + ট্যাঙ্ক; দোকান আইটেম + হেডার স্টেশন; সাইট খরচ Station cost type-এ — লাইনে Shared দিয়ে সাইটে ভাগ।',
  },
  tipPonds: {
    en: 'Ponds: Pond cost allocation (one pond or shared split), category, fish kg/heads. Record new pond vendor costs here (not Pond costs).',
    bn: 'পুকুর: Pond cost allocation (এক পুকুর বা ভাগ), ক্যাটাগরি, মাছ kg/heads। নতুন পুকুর ভেন্ডর খরচ এখানে রেকর্ড (Pond costs-এ নয়)।',
  },
  tipHeadOffice: { en: 'Head office: expense accounts only.', bn: 'হেড অফিস: শুধু ব্যয় অ্যাকাউন্ট।' },
  reportingCategoriesHint: {
    en: 'Custom labels for aquaculture and fuel-station categories are set under Reporting categories (company admin). Built-in categories appear in the line pickers when you tag a pond or leave the pond unset.',
    bn: 'অ্যাকোয়াকালচার ও ফুয়েল-স্টেশন ক্যাটাগরির কাস্টম লেবেল Reporting categories-এ (কোম্পানি অ্যাডমিন)। পুকুর ট্যাগ করলে বা পুকুর unset রাখলে বিল্ট-ইন ক্যাটাগরি লাইন পিকারে দেখায়।',
  },
  reportingCategories: { en: 'Reporting categories', bn: 'রিপোর্টিং ক্যাটাগরি' },
  stationShop: { en: 'Station / shop:', bn: 'স্টেশন / দোকান:' },
  ponds: { en: 'Ponds:', bn: 'পুকুর:' },
  headOffice: { en: 'Head office:', bn: 'হেড অফিস:' },
  tank: { en: 'tank', bn: 'ট্যাঙ্ক' },
  items: { en: 'items', bn: 'আইটেম' },
  stationCostType: { en: 'Station cost type', bn: 'স্টেশন খরচ ধরন' },
  shared: { en: 'Shared', bn: 'ভাগ করা' },
  pondCostAllocation: { en: 'Pond cost allocation', bn: 'পুকুর খরচ বরাদ্দ' },
  addLineTooltip: {
    en: 'Adds a new line of the same type (Item or Expense) as the last line. Switch a line\'s type any time with its Item/Expense toggle.',
    bn: 'শেষ লাইনের একই ধরন (আইটেম বা ব্যয়) নতুন লাইন যোগ। Item/Expense টগলে যেকোনো সময় লাইন ধরন বদলান।',
  },
  vendorLineTotalTitle: {
    en: 'Vendor line total (BDT) — enter with total fish (heads)',
    bn: 'ভেন্ডর লাইন মোট (BDT) — মোট মাছ (টি) সহ দিন',
  },
  fishSpeciesTitle: { en: 'Fish species stocked on this line (fry/fingerling)', bn: 'এই লাইনে স্টক করা মাছের প্রজাতি (ফ্রাই/ফিঙ্গারলিং)' },
  linePiecesTitle: { en: 'From item catalog — Line (pieces per 1 kg)', bn: 'আইটেম ক্যাটালগ থেকে — লাইন (প্রতি 1 kg-এ টুকরা)' },
  costPerFishTitle: {
    en: 'Auto: line Amount ÷ total fish (heads) — cost per fry/fingerling',
    bn: 'স্বয়ংক্রিয়: লাইন পরিমাণ ÷ মোট মাছ (টি) — প্রতি ফ্রাই/ফিঙ্গারলিং খরচ',
  },
  speciesOtherValidation: {
    en: 'Line {n} ({item}): enter the species name for "Other".',
    bn: 'লাইন {n} ({item}): "Other"-এর জন্য প্রজাতির নাম দিন।',
  },
  fishItem: { en: 'Fish item', bn: 'মাছ আইটেম' },
  partialStatus: { en: 'Partial', bn: 'আংশিক' },
}

export function billsT(
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

export function useBillsT() {
  const { language } = useCompanyLocale()
  return (key: string, vars?: Record<string, string | number>) => billsT(key, language, vars)
}
