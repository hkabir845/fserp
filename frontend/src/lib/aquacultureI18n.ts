/**
 * Aquaculture UI strings — complements backend advice text (which follows company language).
 */
import { normalizeLang, pick, type AppLanguage } from '@/lib/i18n'

export type AdviceLanguage = AppLanguage

export function normalizeAdviceLanguage(lang: string | undefined | null): AdviceLanguage {
  return normalizeLang(lang)
}

type Dict = Record<string, { en: string; bn: string }>

const strings: Dict = {
  pondLoad: { en: 'Pond load', bn: 'পুকুরের লোড' },
  stockingLoad: { en: 'Stocking load', bn: 'স্টকিং লোড' },
  density: { en: 'Density', bn: 'ঘনত্ব' },
  kgPerDecimalWater: { en: 'kg per decimal of water', bn: 'kg/ডেসিমেল জল' },
  setWaterAreaOnPond: { en: 'Set water area on pond', bn: 'পুকুরে জলের আয়তন (ডেসিমেল) দিন' },
  suggestedPartialHarvest: { en: 'Suggested partial harvest', bn: 'পরামর্শিত আংশিক ধরা' },
  harvest: { en: 'Harvest', bn: 'ধরা' },
  removeAboutKg: { en: 'Remove about', bn: 'প্রায়' },
  removeAboutKgSuffix: { en: 'kg', bn: 'kg তুলুন' },
  fish: { en: 'fish', bn: 'মাছ' },
  noThinningNeeded: { en: 'No thinning needed at this biomass', bn: 'এই বায়োমাসে পাতলা করার দরকার নেই' },
  shouldYouThin: { en: 'Should you thin?', bn: 'পাতলা করবেন?' },
  loadPerDecimalHarvest: { en: 'Load per decimal and harvest suggestion', bn: 'ডেসিমেল লোড ও ধরার পরামর্শ' },
  setWaterAreaDecimal: { en: 'Set water area (decimal) on pond', bn: 'পুকুরে জলের আয়তন (ডেসিমেল) দিন' },
  currentSize: { en: 'Current size:', bn: 'বর্তমান আকার:' },
  liveStock: { en: 'Live stock:', bn: 'জীবিত স্টক:' },
  kgDecimalAfter: { en: 'kg/decimal after', bn: 'kg/ডেসিমেল (পরে)' },
  advisoryOnly: {
    en: 'Advisory only — you may harvest more or less based on water quality, market, and growth targets.',
    bn: 'শুধু পরামর্শ — পানির গুণমান, বাজার ও বৃদ্ধি লক্ষ্য অনুযায়ী বেশি বা কম ধরতে পারেন।',
  },
  computingLoadAdvice: { en: 'Computing load & harvest advice…', bn: 'লোড ও ধরার পরামর্শ হিসাব হচ্ছে…' },
  fieldGuideTitle: { en: 'What you do in the field', bn: 'মাঠে যা করবেন' },
  fieldGuideBody: {
    en: 'Catch a small batch in a net, weigh them together, count them, and return them alive. Enter those two numbers here — the app does the rest.',
    bn: 'জালে কিছু মাছ ধরুন, একসাথে ওজন করুন, গুনুন, জীবিত ফেরত দিন। ওজন ও সংখ্যা এখানে দিন — বাকি অ্যাপ করবে।',
  },
  stepNetSample: { en: '1 · Net sample', bn: '1 · জালের নমুনা' },
  stepPondTotal: { en: '2 · Pond total (estimate)', bn: '2 · পুকুর মোট (আনুমানিক)' },
  stepLoadHarvest: { en: '3 · Load & harvest hint', bn: '3 · লোড ও ধরার ইঙ্গিত' },
  stepLoadHarvestBody: {
    en: 'Compare estimated kg to water area (decimals) on the pond (intensive grow-out bands: moderate ~15–40 kg/dec). If load is Full or High, the table suggests how much to harvest — advisory only.',
    bn: 'আনুমানিক kg পুকুরের জলের আয়তন (ডেসিমেল) এর সাথে তুলুন (নিবিড় গ্রো-আউট: মাঝারি ~15–40 kg/ডেসিমেল)। লোড পূর্ণ বা উচ্চ হলে টেবিলে ধরার পরামর্শ — শুধু ইঙ্গিত।',
  },
  bookFiguresNote: {
    en: 'Book figures are a snapshot from Pond stock when you save — not recalculated later. Keep transfers, sales, and mortality up to date on',
    bn: 'বইয়ের সংখ্যা সংরক্ষণের সময় Pond stock থেকে — পরে আপডেট হয় না। স্থানান্তর, বিক্রি ও মৃত্যু',
  },
  pondStock: { en: 'Pond stock', bn: 'পুকুর স্টক' },
  inTheNet: { en: 'In the net', bn: 'জালে' },
  fishInBooks: { en: 'Fish in books', bn: 'বইয়ের মাছ' },
  pondEstimate: { en: 'Pond estimate', bn: 'পুকুর আনুমানিক' },
  avgPerFish: { en: 'Avg per fish', bn: 'প্রতি মাছ গড়' },
  languageLabel: { en: 'Advice language', bn: 'পরামর্শের ভাষা' },
  languageEnglish: { en: 'English', bn: 'English' },
  languageBangla: { en: 'Bangla (বাংলা)', bn: 'বাংলা' },
  languageHelp: {
    en: 'Aquaculture load, harvest, and feeding advice text for this company.',
    bn: 'এই কোম্পানির জন্য পুকুর লোড, ধরা ও খাবার পরামর্শের ভাষা।',
  },
}

export function aquacultureT(key: keyof typeof strings, lang: AdviceLanguage): string {
  const row = strings[key]
  return row ? pick(lang, row.en, row.bn) : key
}

export function aquacultureTFormat(
  key: keyof typeof strings,
  lang: AdviceLanguage,
  vars: Record<string, string | number>
): string {
  let s = aquacultureT(key, lang)
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  }
  return s
}
