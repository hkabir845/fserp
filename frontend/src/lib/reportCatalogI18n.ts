/**
 * Localized titles/descriptions for report cards (company language en | bn).
 */
import type { AppLanguage } from '@/lib/i18n'

type Loc = { title: { en: string; bn: string }; description: { en: string; bn: string } }

export const AQUACULTURE_REPORT_LABELS: Record<string, Loc> = {
  'aquaculture-sampling': {
    title: {
      en: 'Aquaculture — Biomass sampling register',
      bn: 'অ্যাকোয়াকালচার — বায়োমাস নমুনা রেজিস্টার',
    },
    description: {
      en: 'Net samples by pond: fish count, weight, pcs/kg, extrapolated pond biomass, book reference, and market valuation',
      bn: 'পুকুরভিত্তিক জালের নমুনা: মাছের সংখ্যা, ওজন, pcs/kg, অনুমানিত বায়োমাস, বইয়ের তথ্য ও বাজার মূল্য',
    },
  },
  'aquaculture-fish-stock-position': {
    title: {
      en: 'Aquaculture — Fish stock by pond',
      bn: 'অ্যাকোয়াকালচার — পুকুর অনুযায়ী মাছের স্টক',
    },
    description: {
      en: 'Present biological fish per pond: stocked, sold, mortality, adjustments, latest sample, load, and harvest hints',
      bn: 'প্রতি পুকুরে বর্তমান জৈবিক মাছ: স্টকড, বিক্রি, মৃত্যু, সমন্বয়, সর্বশেষ নমুনা, লোড ও ধরার ইঙ্গিত',
    },
  },
  'aquaculture-fish-stock-breakdown': {
    title: {
      en: 'Aquaculture — Fish stock by batch & species',
      bn: 'অ্যাকোয়াকালচার — ব্যাচ ও প্রজাতি অনুযায়ী স্টক',
    },
    description: {
      en: 'Stock position split by production cycle and species — stocked minus outflows equals present (kg and head count)',
      bn: 'উৎপাদন চক্র ও প্রজাতি অনুযায়ী স্টক — স্টকড − বের = বর্তমান (kg ও মাথা)',
    },
  },
  'aquaculture-fish-biomass-movements': {
    title: {
      en: 'Aquaculture — Fish biomass movements',
      bn: 'অ্যাকোয়াকালচার — মাছের বায়োমাস চলাচল',
    },
    description: {
      en: 'All fish biomass transactions in the period: stocking bills, transfers, sales, mortality, and manual adjustments',
      bn: 'সময়সীমার সব বায়োমাস লেনদেন: স্টকিং বিল, স্থানান্তর, বিক্রি, মৃত্যু ও ম্যানুয়াল সমন্বয়',
    },
  },
  'aquaculture-fish-stock-adjustments': {
    title: {
      en: 'Aquaculture — Mortality & stock adjustments',
      bn: 'অ্যাকোয়াকালচার — মৃত্যু ও স্টক সমন্বয়',
    },
    description: {
      en: 'Stock ledger entries for mortality losses and manual count/weight corrections, grouped by pond with GL reference',
      bn: 'মৃত্যু ও ম্যানুয়াল সংখ্যা/ওজন সমন্বয়ের স্টক লেজার এন্ট্রি, পুকুরভিত্তিক',
    },
  },
}

export function localizeReportCard<T extends { id: string; title: string; description: string }>(
  card: T,
  lang: AppLanguage,
): T {
  const loc = AQUACULTURE_REPORT_LABELS[card.id]
  if (!loc) return card
  return {
    ...card,
    title: loc.title[lang],
    description: loc.description[lang],
  }
}
