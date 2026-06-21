import type { AppLanguage } from '@/lib/i18n'
import { pick } from '@/lib/i18n'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import type { PosSaleScope } from '@/utils/rbac'

type Row = { en: string; bn: string }

const strings: Record<string, Row> = {
  loadingPos: { en: 'Loading POS', bn: 'POS লোড হচ্ছে' },
  loadingBoth: {
    en: 'Preparing forecourt, catalog, and tills…',
    bn: 'ফোরকোর্ট, ক্যাটালগ ও টিল প্রস্তুত হচ্ছে…',
  },
  loadingGeneral: {
    en: 'Preparing your retail catalog…',
    bn: 'রিটেইল ক্যাটালগ প্রস্তুত হচ্ছে…',
  },
  loadingFuel: {
    en: 'Preparing pumps, nozzles, and prices…',
    bn: 'পাম্প, নজল ও মূল্য প্রস্তুত হচ্ছে…',
  },
  scopeBoth: { en: 'Fuel & shop', bn: 'ফুয়েল ও দোকান' },
  scopeGeneral: { en: 'Shop only', bn: 'শুধু দোকান' },
  scopeFuel: { en: 'Fuel only', bn: 'শুধু ফুয়েল' },
  scopeBadgeTitle: {
    en: 'This register is configured for your login (POS scope)',
    bn: 'এই রেজিস্টার আপনার লগইনের জন্য কনফিগার (POS স্কোপ)',
  },
  localTimeTitle: {
    en: 'Local time at this workstation',
    bn: 'এই ওয়ার্কস্টেশনের স্থানীয় সময়',
  },
  checkoutRetail: { en: 'Checkout — retail', bn: 'চেকআউট — রিটেইল' },
  checkoutFuel: { en: 'Checkout — fuel', bn: 'চেকআউট — ফুয়েল' },
  checkoutBoth: { en: 'Checkout — fuel & retail', bn: 'চেকআউট — ফুয়েল ও রিটেইল' },
  descGeneral: {
    en: 'Shop and services only on this register. Credit sales post to A/R; settle later under Payments → Received.',
    bn: 'এই রেজিস্টারে শুধু দোকান ও সেবা। ক্রেডিট বিক্রি A/R-এ পোস্ট; পরে Payments → Received-এ নিষ্পত্তি।',
  },
  descFuel: {
    en: 'Pump sales only. Credit sales post to A/R; settle later under Payments → Received.',
    bn: 'শুধু পাম্প বিক্রি। ক্রেডিট বিক্রি A/R-এ পোস্ট; পরে Payments → Received-এ নিষ্পত্তি।',
  },
  descBoth: {
    en: 'One ticket for pump dispense and counter items. Credit sales post to A/R; settle later under Payments → Received.',
    bn: 'পাম্প ডিসপেন্স ও কাউন্টার আইটেম এক টিকিটে। ক্রেডিট বিক্রি A/R-এ পোস্ট; পরে Payments → Received-এ নিষ্পত্তি।',
  },
  keys: { en: 'Keys', bn: 'কী' },
  shortcuts: { en: 'Shortcuts', bn: 'শর্টকাট' },
  shortcutsAria: { en: 'Keyboard shortcuts', bn: 'কীবোর্ড শর্টকাট' },
  shortcutProductSearch: { en: 'Product search', bn: 'পণ্য খোঁজ' },
  shortcutCompleteSale: { en: 'Complete sale', bn: 'বিক্রি সম্পন্ন' },
  shortcutCloseDialogs: { en: 'Close dialogs', bn: 'ডায়ালগ বন্ধ' },
  shortcutThisPanel: { en: 'This panel', bn: 'এই প্যানেল' },
  shortcutOr: { en: 'or', bn: 'অথবা' },
  shortcutEnterHint: {
    en: 'Barcode scanners: focus search, scan code — if one match exists, press Enter to add. In checkout, Enter on cash/credit also completes when the cart is valid.',
    bn: 'বারকোড স্ক্যানার: খোঁজে ফোকাস, কোড স্ক্যান — এক মিল থাকলে Enter দিয়ে যোগ করুন। চেকআউটে কার্ট ঠিক থাকলে নগদ/ক্রেডিটে Enter-ও সম্পন্ন করতে পারে।',
  },
  print: { en: 'Print', bn: 'প্রিন্ট' },
  draftInvoice: { en: 'Draft invoice', bn: 'ড্রাফ্ট ইনভয়েস' },
  draftInvoiceSub: {
    en: 'Current cart as a printable draft',
    bn: 'বর্তমান কার্ট প্রিন্টযোগ্য ড্রাফ্ট',
  },
  posSummary: { en: 'POS summary report', bn: 'POS সারাংশ রিপোর্ট' },
  posSummarySub: {
    en: 'Today’s sales on this register',
    bn: 'এই রেজিস্টারে আজকের বিক্রি',
  },
  customerAr: { en: 'Customer A/R statement', bn: 'গ্রাহক A/R বিবৃতি' },
  customerArSub: {
    en: 'Selected customer balance & ledger',
    bn: 'নির্বাচিত গ্রাহকের ব্যালেন্স ও লেজার',
  },
  logout: { en: 'Logout', bn: 'লগআউট' },
  dismiss: { en: 'Dismiss', bn: 'বাতিল' },
  registerMode: { en: 'Register mode', bn: 'রেজিস্টার মোড' },
}

function cashierStr(key: string, lang: AppLanguage): string {
  const row = strings[key]
  return row ? pick(lang, row.en, row.bn) : key
}

export function useCashierT() {
  const { language } = useCompanyLocale()
  const lang = language

  return {
    t: (key: string) => cashierStr(key, lang),
    loadingHint: (scope: PosSaleScope) => {
      if (scope === 'both') return cashierStr('loadingBoth', lang)
      if (scope === 'general') return cashierStr('loadingGeneral', lang)
      return cashierStr('loadingFuel', lang)
    },
    checkoutTitle: (scope: PosSaleScope) => {
      if (scope === 'general') return cashierStr('checkoutRetail', lang)
      if (scope === 'fuel') return cashierStr('checkoutFuel', lang)
      return cashierStr('checkoutBoth', lang)
    },
    checkoutDescription: (scope: PosSaleScope) => {
      if (scope === 'general') return cashierStr('descGeneral', lang)
      if (scope === 'fuel') return cashierStr('descFuel', lang)
      return cashierStr('descBoth', lang)
    },
    scopeLabel: (scope: PosSaleScope) => {
      if (scope === 'both') return cashierStr('scopeBoth', lang)
      if (scope === 'general') return cashierStr('scopeGeneral', lang)
      return cashierStr('scopeFuel', lang)
    },
  }
}
