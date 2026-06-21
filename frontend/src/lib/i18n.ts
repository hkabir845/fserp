/**
 * Tenant UI language (en / bn) from company settings.
 * Use useT() in components; use pick()/t() when lang is already known.
 *
 * Convention: Bangla copy uses Bengali prose; digits stay Western (0–9), not ০–৯.
 * Numeric display uses formatNumber() / en-US formatting regardless of language.
 */
import { useCallback, useMemo } from 'react'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'

export type AppLanguage = 'en' | 'bn'

export function normalizeLang(lang: string | undefined | null): AppLanguage {
  return lang === 'bn' ? 'bn' : 'en'
}

export function pick(lang: AppLanguage, en: string, bn: string): string {
  return lang === 'bn' ? bn : en
}

type StringRow = { en: string; bn: string }

const strings = {
  // —— Common ——
  loading: { en: 'Loading…', bn: 'লোড হচ্ছে…' },
  save: { en: 'Save', bn: 'সংরক্ষণ' },
  cancel: { en: 'Cancel', bn: 'বাতিল' },
  required: { en: 'Required', bn: 'আবশ্যক' },
  optional: { en: 'Optional', bn: 'ঐচ্ছিক' },

  // —— Pond stock ledger form ——
  stockLoadingLastSample: { en: 'Loading last biomass sample…', bn: 'সর্বশেষ বায়োমাস নমুনা লোড হচ্ছে…' },
  stockLastSample: { en: 'Last sample', bn: 'সর্বশেষ নমুনা' },
  stockFish: { en: 'fish', bn: 'মাছ' },
  stockReapplySample: { en: 'Re-apply from last sample', bn: 'সর্বশেষ নমুনা থেকে পুনরায় প্রয়োগ' },
  stockNoSampleHint: {
    en: 'No biomass sample for this pond, batch, and species — enter fish count and total weight.',
    bn: 'এই পুকুর, ব্যাচ ও প্রজাতির জন্য বায়োমাস নমুনা নেই — মাছের সংখ্যা ও মোট ওজন দিন।',
  },
  stockFishCountHeads: { en: 'Fish count (heads)', bn: 'মাছের সংখ্যা (টি)' },
  stockFishCountDelta: { en: 'Δ Fish count', bn: 'Δ মাছের সংখ্যা' },
  stockHeadsLost: { en: 'Heads lost (positive)', bn: 'হারানো মাছ (ধনাত্মক)' },
  stockFishCountDeltaHint: {
    en: 'Negative = fewer, positive = more',
    bn: 'ঋণাত্মক = কম, ধনাত্মক = বেশি',
  },
  stockTotalWeightKg: { en: 'Total weight (kg)', bn: 'মোট ওজন (kg)' },
  stockWeightDeltaKg: { en: 'Δ Total weight (kg)', bn: 'Δ মোট ওজন (kg)' },
  stockTotalBiomassHint: { en: 'Total biomass for this entry', bn: 'এই এন্ট্রির মোট বায়োমাস' },
  stockWeightSignHint: { en: 'Sign follows fish count Δ', bn: 'চিহ্ন মাছের সংখ্যা Δ অনুযায়ী' },
  stockFishPerKg: { en: 'Fish per kg', bn: 'প্রতি kg-এ মাছ' },
  stockFishPerKgAutoPh: { en: 'Auto from count ÷ weight', bn: 'সংখ্যা ÷ ওজন থেকে স্বয়ংক্রিয়' },
  stockFishPerKgHint: {
    en: 'Fills automatically; editable override',
    bn: 'স্বয়ংক্রিয় পূরণ; প্রয়োজনে ম্যানুয়াল পরিবর্তন',
  },
  stockSelectPond: { en: 'Select a pond', bn: 'একটি পুকুর নির্বাচন করুন' },
  stockEnterFishRemoved: {
    en: 'Enter fish removed (heads) as a positive number',
    bn: 'অপসারিত মাছ (টি) ধনাত্মক সংখ্যায় দিন',
  },
  stockEnterWeightRemoved: {
    en: 'Enter weight removed (kg) as a number greater than zero',
    bn: 'অপসারিত ওজন (kg) শূন্যের বেশি সংখ্যায় দিন',
  },
  stockFishCountRequired: {
    en: 'Fish count change is required (use negative for fewer fish)',
    bn: 'মাছের সংখ্যা পরিবর্তন আবশ্যক (কম হলে ঋণাত্মক)',
  },
  stockFishCountNonZero: {
    en: 'Fish count adjustment must be a non-zero integer',
    bn: 'মাছের সংখ্যা সমন্বয় শূন্য নয় এমন পূর্ণসংখ্যা হতে হবে',
  },
  stockWeightRequired: {
    en: 'Weight change (kg) is required (use negative for less biomass)',
    bn: 'ওজন পরিবর্তন (kg) আবশ্যক (কম বায়োমাস হলে ঋণাত্মক)',
  },
  stockWeightNonZero: {
    en: 'Weight adjustment must be a non-zero number',
    bn: 'ওজন সমন্বয় শূন্য নয় এমন সংখ্যা হতে হবে',
  },
  stockGlOptional: { en: 'General ledger (optional)', bn: 'জেনারেল লেজার (ঐচ্ছিক)' },
  stockGlHint: {
    en: 'Post only when you need a journal entry (accounts 1581 / 6726 / 4244).',
    bn: 'জার্নাল এন্ট্রি দরকার হলে পোস্ট করুন (অ্যাকাউন্ট 1581 / 6726 / 4244)।',
  },
  stockEditMemo: { en: 'Edit memo', bn: 'মেমো সম্পাদনা' },
  stockEditEntry: { en: 'Edit stock ledger entry', bn: 'স্টক লেজার এন্ট্রি সম্পাদনা' },
  stockRecordEntry: { en: 'Record stock ledger entry', bn: 'স্টক লেজার এন্ট্রি রেকর্ড' },
  stockGlPostedHint: {
    en: 'This row is posted to the general ledger — only the memo can be changed here.',
    bn: 'এই সারি জেনারেল লেজারে পোস্ট — এখানে শুধু মেমো পরিবর্তন করা যায়।',
  },
  stockEditHint: {
    en: 'Update mortality, adjustment, or notes. Book value and GL posting are fixed after create.',
    bn: 'মৃত্যু, সমন্বয় বা নোট আপডেট করুন। বইয়ের মূল্য ও GL পোস্টিং তৈরির পর স্থির।',
  },
  stockCreateHint: {
    en: 'Record mortality, predation, theft, or a manual count/weight correction for implied stock.',
    bn: 'মৃত্যু, শিকারী, চুরি বা ম্যানুয়াল সংখ্যা/ওজন সমন্বয় রেকর্ড করুন।',
  },
  stockEntryLoss: { en: 'Loss', bn: 'ক্ষতি' },
  stockEntryAdjustment: { en: 'Adjustment', bn: 'সমন্বয়' },
  stockLossKindsHint: {
    en: 'Mortality, predators, theft, culling',
    bn: 'মৃত্যু, শিকারী, চুরি, বাছাই',
  },
  stockAdjKindsHint: {
    en: 'Opening balance, recount, correction',
    bn: 'ওপেনিং ব্যালেন্স, পুনর্গণনা, সংশোধন',
  },
  stockMemoUpdated: { en: 'Memo updated', bn: 'মেমো আপডেট হয়েছে' },
  stockEntryUpdated: { en: 'Ledger entry updated', bn: 'লেজার এন্ট্রি আপডেট হয়েছে' },
  stockEntrySaved: { en: 'Ledger entry saved', bn: 'লেজার এন্ট্রি সংরক্ষিত' },
  stockSaveFailed: { en: 'Save failed', bn: 'সংরক্ষণ ব্যর্থ' },
  stockSaveMemo: { en: 'Save memo', bn: 'মেমো সংরক্ষণ' },
  stockSaveChanges: { en: 'Save changes', bn: 'পরিবর্তন সংরক্ষণ' },
  stockSaveEntry: { en: 'Save entry', bn: 'এন্ট্রি সংরক্ষণ' },

  // —— Reports (aquaculture client hints) ——
  reportPeriodRowsFiltered: {
    en: 'Rows are filtered by transaction date within this range.',
    bn: 'এই সময়সীমার মধ্যে লেনদেনের তারিখ অনুযায়ী সারি ফিল্টার করা হয়েছে।',
  },
  reportFishStockAsOf: {
    en: 'Biological fish position computed as of the report end date.',
    bn: 'রিপোর্ট শেষ তারিখ অনুযায়ী জৈবিক মাছের অবস্থান হিসাব।',
  },
  reportMovementsFiltered: {
    en: 'Movements filtered by entry date within this range.',
    bn: 'এন্ট্রির তারিখ অনুযায়ী এই সময়সীমায় চলাচল ফিল্টার।',
  },
  reportAdjustmentsFiltered: {
    en: 'Ledger entries filtered by entry date within this range.',
    bn: 'এন্ট্রির তারিখ অনুযায়ী লেজার এন্ট্রি ফিল্টার।',
  },
  reportStockBreakdownAsOf: {
    en: 'Stock position computed as of the report end date.',
    bn: 'রিপোর্ট শেষ তারিখ অনুযায়ী স্টক অবস্থান হিসাব।',
  },
} as const satisfies Record<string, StringRow>

export type I18nKey = keyof typeof strings

export function t(key: I18nKey, lang: AppLanguage): string {
  const row = strings[key]
  return row ? row[lang] : key
}

export function tFormat(
  key: I18nKey,
  lang: AppLanguage,
  vars: Record<string, string | number>
): string {
  let s = t(key, lang)
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  }
  return s
}

export function useT() {
  const { language: lang } = useCompanyLocale()
  const translate = useCallback((key: I18nKey) => t(key, lang), [lang])
  const pickStr = useCallback((en: string, bn: string) => pick(lang, en, bn), [lang])
  return useMemo(
    () => ({ lang, t: translate, pick: pickStr }),
    [lang, translate, pickStr]
  )
}
