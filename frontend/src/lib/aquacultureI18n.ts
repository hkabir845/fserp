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

  // —— Biomass sampling page ——
  biomassSampling: { en: 'Biomass sampling', bn: 'বায়োমাস নমুনা' },
  samplingIntro: {
    en: 'Record a net sample: catch a batch, weigh them together, count them, and return them to the pond. The app combines your sample mean weight with head count from Fish stock to estimate total pond biomass and growth since the last book mean.',
    bn: 'জালের নমুনা রেকর্ড করুন: মাছ ধরুন, একসাথে ওজন করুন, গুনুন, পুকুরে ফেরত দিন। অ্যাপ আপনার নমুনার গড় ওজন Fish stock-এর মাছের সংখ্যার সাথে মিলিয়ে পুকুরের মোট বায়োমাস ও বইয়ের গড় থেকে বৃদ্ধি অনুমান করবে।',
  },
  pondFilter: { en: 'Pond', bn: 'পুকুর' },
  allPonds: { en: 'All', bn: 'সব' },
  refresh: { en: 'Refresh', bn: 'রিফ্রেশ' },
  logSample: { en: 'Log sample', bn: 'নমুনা রেকর্ড' },
  editNetSample: { en: 'Edit net sample', bn: 'জালের নমুনা সম্পাদনা' },
  stepNetSampleExample: {
    en: 'e.g. 12 fish weighing 4 kg → average 0.33 kg per fish in the sample.',
    bn: 'যেমন 12 মাছ 4 kg → নমুনায় গড় 0.33 kg প্রতি মাছ।',
  },
  stepPondTotalExample: {
    en: 'Multiply that average by the fish head count in your books (from Pond stock). If books show 109,400 fish → about 36,100 kg in the pond.',
    bn: 'গড় ওজন বইয়ের মাছের সংখ্যায় (Pond stock) গুণ করুন। বইয়ে 109,400 মাছ → পুকুরে প্রায় 36,100 kg।',
  },
  colWhen: { en: 'When', bn: 'কখন' },
  colWhenSub: { en: 'Sample date', bn: 'নমুনার তারিখ' },
  colWhere: { en: 'Where', bn: 'কোথায়' },
  colWhereSub: { en: 'Pond, species, batch', bn: 'পুকুর, প্রজাতি, ব্যাচ' },
  colMeasured: { en: 'What you measured', bn: 'যা পরিমাপ করেছেন' },
  colMeasuredSub: { en: 'Fish caught in the net and their weight', bn: 'জালে ধরা মাছ ও ওজন' },
  colSizeGrowth: { en: 'Size & growth', bn: 'আকার ও বৃদ্ধি' },
  colSizeGrowthSub: { en: 'Pcs/kg and ADG since last sample', bn: 'pcs/kg ও শেষ নমুনার পর ADG' },
  colBooks: { en: 'Books at save', bn: 'সংরক্ষণের সময় বই' },
  colBooksSub: { en: 'Head count and avg weight from Pond stock', bn: 'Pond stock থেকে সংখ্যা ও গড় ওজন' },
  colPondEst: { en: 'Pond estimate', bn: 'পুকুর অনুমান' },
  colPondEstSub: { en: 'Total kg if sample average applies to all fish', bn: 'নমুনার গড় সব মাছে প্রয়োগ হলে মোট kg' },
  colMarket: { en: 'Market (optional)', bn: 'বাজার (ঐচ্ছিক)' },
  colMarketSub: { en: 'Price, value, profit vs books', bn: 'দাম, মূল্য, বইয়ের তুলনায় লাভ' },
  fromHarvestSale: { en: 'From harvest sale', bn: 'ধরা বিক্রি থেকে' },
  notePrefix: { en: 'Note:', bn: 'নোট:' },
  inTheNetLabel: { en: 'In the net', bn: 'জালে' },
  fishUnit: { en: 'fish', bn: 'মাছ' },
  avgPerFishLabel: { en: 'Average per fish', bn: 'প্রতি মাছ গড়' },
  kgEach: { en: 'kg each', bn: 'kg প্রতি' },
  pcsPerKgLabel: { en: 'Pcs/kg', bn: 'pcs/kg' },
  fishPerKg: { en: 'fish per kg', bn: 'প্রতি kg-এ মাছ' },
  adgLabel: { en: 'ADG', bn: 'ADG' },
  adgUnit: { en: 'g/fish/day', bn: 'g/মাছ/দিন' },
  daysShort: { en: 'd', bn: 'দিন' },
  firstSampleInBatch: { en: 'First sample in batch', bn: 'ব্যাচে প্রথম নমুনা' },
  adgNeedsBothSamples: { en: '— (needs net count + kg on both samples)', bn: '— (উভয় নমুনায় জালের সংখ্যা + kg দরকার)' },
  sinceLabel: { en: 'Since', bn: 'শুরু' },
  bookAvgWeight: { en: 'Book avg weight', bn: 'বইয়ের গড় ওজন' },
  fishInBooksLabel: { en: 'Fish in books', bn: 'বইয়ের মাছ' },
  headUnit: { en: 'head', bn: 'টি' },
  estimatedInPond: { en: 'Estimated in pond', bn: 'পুকুরে অনুমান' },
  kgTotal: { en: 'kg total', bn: 'kg মোট' },
  changeVsBooks: { en: 'Change vs books', bn: 'বইয়ের তুলনায় পরিবর্তন' },
  grewOrShrunk: { en: 'fish grew or shrank', bn: 'মাছ বড় বা ছোট হয়েছে' },
  marketPrice: { en: 'Market price', bn: 'বাজার দর' },
  valueAtMarket: { en: 'Value at market', bn: 'বাজার মূল্য' },
  profitVsBio: { en: 'Profit vs bio-asset books', bn: 'জৈবিক সম্পদ বইয়ের তুলনায় লাভ' },
  profitVsFullCost: { en: 'Profit vs full pond cost', bn: 'পূর্ণ পুকুর খরচের তুলনায় লাভ' },
  noMarketPrice: { en: 'No market price entered', bn: 'বাজার দর দেওয়া নেই' },
  editSample: { en: 'Edit sample', bn: 'নমুনা সম্পাদনা' },
  deleteSample: { en: 'Delete sample', bn: 'নমুনা মুছুন' },
  noSamplesYet: { en: 'No sampling records yet. After a net catch, click', bn: 'এখনো নমুনা রেকর্ড নেই। জালে ধরার পর ক্লিক করুন' },
  harvestSaleEditNote: {
    en: 'This row was created from a pond fish harvest sale. Editing here only changes this sampling record; the sale screen remains the source of truth for that harvest.',
    bn: 'এই সারি পুকুরের মাছ ধরা বিক্রি থেকে তৈরি। এখানে সম্পাদনা শুধু এই নমুনা রেকর্ড বদলায়; বিক্রি স্ক্রিন ধরার মূল উৎস।',
  },
  modalStep1: { en: 'Choose pond, optional stocking batch, and species.', bn: 'পুকুর, ঐচ্ছিক স্টকিং ব্যাচ ও প্রজাতি নির্বাচন করুন।' },
  modalStep2: { en: 'Enter how many fish were in the net and their combined weight (kg).', bn: 'জালে কত মাছ ও মোট ওজন (kg) দিন।' },
  modalStep3: {
    en: 'Review live extrapolation vs current Fish stock, then save (values are snapshotted).',
    bn: 'বর্তমান Fish stock-এর তুলনায় লাইভ অনুমান দেখুন, তারপর সংরক্ষণ করুন (মান স্ন্যাপশট হবে)।',
  },
  stockingBatchOptional: { en: 'Stocking batch (optional)', bn: 'স্টকিং ব্যাচ (ঐচ্ছিক)' },
  allMovementsPond: { en: 'All movements for this pond', bn: 'এই পুকুরের সব চলাচল' },
  sampleDate: { en: 'Sample date', bn: 'নমুনার তারিখ' },
  fishSpecies: { en: 'Fish species', bn: 'মাছের প্রজাতি' },
  otherSpeciesName: { en: 'Other species name', bn: 'অন্য প্রজাতির নাম' },
  fishStockRefLive: { en: 'Fish stock reference (live)', bn: 'Fish stock রেফারেন্স (লাইভ)' },
  impliedHead: { en: 'Implied head', bn: 'অনুমানিত সংখ্যা' },
  impliedNetKg: { en: 'Implied net kg', bn: 'অনুমানিত net kg' },
  couldNotLoadPosition: {
    en: 'Could not load position for this pond and species.',
    bn: 'এই পুকুর ও প্রজাতির অবস্থান লোড করা যায়নি।',
  },
  stockRefHint: {
    en: 'Matches the Fish stock page for this pond, optional cycle filter, and species. Saving stores these as book head / mean for extrapolation.',
    bn: 'Fish stock পৃষ্ঠার মতো — পুকুর, ঐচ্ছিক ব্যাচ ও প্রজাতি। সংরক্ষণে বইয়ের সংখ্যা/গড় স্ন্যাপশট হয়।',
  },
  fishInNetCount: { en: 'Fish in net sample (count)', bn: 'জালের নমুনায় মাছ (সংখ্যা)' },
  combinedWeightKg: { en: 'Combined weight of net sample (kg)', bn: 'জালের নমুনার মোট ওজন (kg)' },
  sampleMeanWeight: { en: 'Sample mean weight (kg/fish)', bn: 'নমুনার গড় ওজন (kg/মাছ)' },
  pcsPerKgFromNet: { en: 'Pcs/kg (from net sample)', bn: 'pcs/kg (জালের নমুনা থেকে)' },
  growthVsLastSample: { en: 'Growth vs last sample', bn: 'শেষ নমুনার তুলনায় বৃদ্ধি' },
  adgUnavailable: { en: 'ADG unavailable — needs net count + kg on sample from', bn: 'ADG নেই — নমুনায় জালের সংখ্যা + kg দরকার, তারিখ' },
  firstSampleAdgHint: {
    en: 'First sample for this pond and batch — ADG will appear on the next sample.',
    bn: 'এই পুকুর ও ব্যাচের প্রথম নমুনা — পরের নমুনায় ADG দেখাবে।',
  },
  previewBeforeSave: { en: 'Preview (before save)', bn: 'প্রিভিউ (সংরক্ষণের আগে)' },
  bookMeanKgFish: { en: 'Book mean kg/fish', bn: 'বইয়ের গড় kg/মাছ' },
  estPondBiomass: { en: 'Est. pond biomass', bn: 'আনুমানিক পুকুর বায়োমাস' },
  estBiomassVsBook: { en: 'Est. biomass vs book mean', bn: 'বইয়ের গড়ের তুলনায় বায়োমাস' },
  noHeadForExtrap: {
    en: 'No positive head count in Fish stock for this filter — extrapolation will be blank until stock is recorded.',
    bn: 'এই ফিল্টারে Fish stock-এ ধনাত্মক সংখ্যা নেই — স্টক রেকর্ড হলে অনুমান হবে।',
  },
  marketPriceOptional: { en: 'Market price (optional, BDT/kg)', bn: 'বাজার দর (ঐচ্ছিক, BDT/kg)' },
  notes: { en: 'Notes', bn: 'নোট' },
  goToPonds: { en: 'Go to Ponds', bn: 'পুকুরে যান' },
  noPondsActive: {
    en: 'No active ponds. Add a pond first, then record biomass samples.',
    bn: 'সক্রিয় পুকুর নেই। প্রথমে পুকুর যোগ করুন, তারপর বায়োমাস নমুনা রেকর্ড করুন।',
  },
  addPondFirstTitle: { en: 'Add at least one pond first', bn: 'প্রথমে কমপক্ষে একটি পুকুর যোগ করুন' },
  addPondFirstBody: { en: 'Sampling is recorded per pond.', bn: 'নমুনা পুকুরভিত্তিক রেকর্ড হয়।' },
  loadingPosition: { en: 'Loading position…', bn: 'অবস্থান লোড হচ্ছে…' },
  errPondDateRequired: { en: 'Pond and sample date are required', bn: 'পুকুর ও নমুনার তারিখ আবশ্যক' },
  errFishCountPositive: {
    en: 'Number of fish in the net sample must be a positive integer',
    bn: 'জালের নমুনায় মাছের সংখ্যা ধনাত্মক পূর্ণসংখ্যা হতে হবে',
  },
  errWeightRequired: {
    en: 'Total weight of the net sample (kg) is required and must be greater than zero',
    bn: 'জালের নমুনার মোট ওজন (kg) আবশ্যক ও শূন্যের বেশি হতে হবে',
  },
  updated: { en: 'Updated', bn: 'আপডেট হয়েছে' },
  saved: { en: 'Saved', bn: 'সংরক্ষিত' },
  saveFailed: { en: 'Save failed', bn: 'সংরক্ষণ ব্যর্থ' },
  confirmDeleteSample: { en: 'Delete this sample?', bn: 'এই নমুনা মুছবেন?' },
  deleted: { en: 'Deleted', bn: 'মুছে ফেলা হয়েছে' },
  deleteFailed: { en: 'Delete failed', bn: 'মুছতে ব্যর্থ' },
  couldNotLoadPonds: { en: 'Could not load ponds', bn: 'পুকুর লোড করা যায়নি' },
  couldNotLoadSamples: { en: 'Could not load samples', bn: 'নমুনা লোড করা যায়নি' },

  warehouseStockHint: {
    en: 'Feed, medicine, and supplies stored at each pond — separate from live fish in the water.',
    bn: 'প্রতি পুকুরে সংরক্ষিত খাদ্য, ঔষধ ও সরঞ্জাম — জলের জীবিত মাছের থেকে আলাদা।',
  },
  pondStockSections: { en: 'Pond stock sections', bn: 'পুকুর স্টক বিভাগ' },
  fishStockViews: { en: 'Fish stock views', bn: 'মাছের স্টক ভিউ' },
  pondWarehouseViews: { en: 'Pond warehouse views', bn: 'পুকুর গুদাম ভিউ' },
  stockOptions: { en: 'Stock options', bn: 'স্টক অপশন' },

  // —— Aquaculture layout gates ——
  aqNotActiveTitle: { en: 'Aquaculture is not active', bn: 'অ্যাকোয়াকালচার সক্রিয় নয়' },
  aqNotActiveBody: {
    en: 'A platform administrator must license Aquaculture for this tenant, then the company Admin turns it on under Company settings. Until both steps are done, Aquaculture stays hidden in the menu.',
    bn: 'প্ল্যাটফর্ম অ্যাডমিন অ্যাকোয়াকালচার লাইসেন্স দেবেন, তারপর কোম্পানি অ্যাডমিন Company settings-এ চালু করবেন। উভয় পদক্ষেপের পর মেনুতে দেখাবে।',
  },
  companySettings: { en: 'Company settings', bn: 'কোম্পানি সেটিংস' },
  users: { en: 'Users', bn: 'ব্যবহারকারী' },
  apps: { en: 'Apps', bn: 'অ্যাপস' },
  appsLoading: { en: 'Loading apps…', bn: 'অ্যাপ লোড হচ্ছে…' },
  appsAllSections: { en: 'All', bn: 'সব' },
  appsTotalApps: { en: 'Total apps', bn: 'মোট অ্যাপ' },
  appsSections: { en: 'Sections', bn: 'বিভাগ' },
  appsInView: { en: 'In view', bn: 'দেখাচ্ছে' },
  appsSearchPlaceholder: { en: 'Search apps…', bn: 'অ্যাপ খুঁজুন…' },
  appsNoMatch: { en: 'No apps match your search.', bn: 'আপনার অনুসন্ধানের সাথে কোনো অ্যাপ মিলছে না।' },

  dashboardLoading: { en: 'Loading your dashboard…', bn: 'ড্যাশবোর্ড লোড হচ্ছে…' },
  dashboardWelcome: { en: 'Welcome, {name}', bn: 'স্বাগতম, {name}' },
  dashboardOpenPos: { en: 'Open POS / Cashier', bn: 'POS / ক্যাশিয়ার খুলুন' },
  dashboardOpenPosSub: { en: 'Start a new sale or donation', bn: 'নতুন বিক্রি বা দান শুরু করুন' },
  dashboardQuickAccess: { en: 'Quick access', bn: 'দ্রুত অ্যাক্সেস' },
  dashboardQuickAccessSub: { en: 'Shortcuts matched to your role', bn: 'আপনার রোলের সাথে মিলে শর্টকাট' },
  dashboardAllApps: { en: 'All apps', bn: 'সব অ্যাপ' },
  dashboardNoApps: {
    en: 'No applications available for your account. Contact your administrator.',
    bn: 'আপনার অ্যাকাউন্টে কোনো অ্যাপ্লিকেশন নেই। প্রশাসকের সাথে যোগাযোগ করুন।',
  },
  dashStatTodaySales: { en: 'Sales today', bn: 'আজকের বিক্রি' },
  dashStatCustomers: { en: 'Customers', bn: 'গ্রাহক' },
  dashStatInvoices: { en: 'Invoices', bn: 'ইনভয়েস' },
  dashStatRevenue: { en: 'Revenue (all time)', bn: 'মোট আয়' },
  dashStatTransactions: { en: '{n} transactions', bn: '{n} টি লেনদেন' },
  dashStatOneTransaction: { en: '1 transaction', bn: '১ টি লেনদেন' },

  dashboardFocusDefault: {
    en: 'Open an app below or review today’s numbers.',
    bn: 'নিচে একটি অ্যাপ খুলুন অথবা আজকের সংখ্যা দেখুন।',
  },
  dashboardFocusAdmin: {
    en: 'Sales, finance, operations, and settings — all in one place.',
    bn: 'বিক্রি, অর্থ, অপারেশন ও সেটিংস — সব এক জায়গায়।',
  },
  dashboardFocusManager: {
    en: 'Fuel, shop, aquaculture, and daily operations.',
    bn: 'ফুয়েল, দোকান, অ্যাকোয়াকালচার ও দৈনিক অপারেশন।',
  },
  dashboardFocusAccountant: {
    en: 'Invoices, payments, ledger, and financial reports.',
    bn: 'ইনভয়েস, পেমেন্ট, লেজার ও আর্থিক রিপোর্ট।',
  },
  dashboardFocusSupervisor: {
    en: 'Aquaculture operations, sampling, feeding, and site reports.',
    bn: 'অ্যাকোয়াকালচার অপারেশন, নমুনা, খাদ্য ও সাইট রিপোর্ট।',
  },
  dashboardFocusCashier: {
    en: 'Start a sale, look up customers, or check today’s totals.',
    bn: 'বিক্রি শুরু করুন, গ্রাহক খুঁজুন অথবা আজকের মোট দেখুন।',
  },
  dashboardFocusOperator: {
    en: 'Quick access to the POS register.',
    bn: 'POS রেজিস্টারে দ্রুত প্রবেশ।',
  },
  dashboardFocusPumpAttendant: {
    en: 'Fuel sales and donations at your assigned site.',
    bn: 'আপনার নির্ধারিত সাইটে ফুয়েল বিক্রি ও দান।',
  },
  dashboardFocusShopkeeper: {
    en: 'Shop POS, customers, and product catalog.',
    bn: 'দোকান POS, গ্রাহক ও পণ্য ক্যাটালগ।',
  },
  dashboardFocusInventoryClerk: {
    en: 'SKU catalog, transfers, and inventory reports.',
    bn: 'SKU ক্যাটালগ, স্থানান্তর ও ইনভেন্টরি রিপোর্ট।',
  },
  dashboardFocusSalesClerk: {
    en: 'Customers, invoices, bills, and payments.',
    bn: 'গ্রাহক, ইনভয়েস, বিল ও পেমেন্ট।',
  },
  dashboardFocusForecourtSupervisor: {
    en: 'Stations, shifts, dips, and operational reports.',
    bn: 'স্টেশন, শিফট, ডিপ ও অপারেশন রিপোর্ট।',
  },
  dashboardFocusHrOfficer: {
    en: 'Employee records and payroll runs.',
    bn: 'কর্মচারী রেকর্ড ও পে-রোল রান।',
  },
  dashboardFocusAuditor: {
    en: 'Ledger, AR/AP, and financial reports (read-only access).',
    bn: 'লেজার, AR/AP ও আর্থিক রিপোর্ট (শুধু পড়ার অ্যাক্সেস)।',
  },
  accessRestricted: { en: 'Access restricted', bn: 'অ্যাক্সেস সীমিত' },
  aqAccessRestrictedBody: {
    en: 'Your account does not have Aquaculture access. Ask a company Admin to enable the module and assign Aquaculture permissions on Roles & access, or sign in with an Admin account.',
    bn: 'আপনার অ্যাকাউন্টে অ্যাকোয়াকালচার অ্যাক্সেস নেই। কোম্পানি অ্যাডমিনকে মডিউল চালু ও Roles & access-এ অনুমতি দিতে বলুন, অথবা অ্যাডমিন অ্যাকাউন্টে লগইন করুন।',
  },

  // —— Shared aquaculture chrome ——
  aquaculture: { en: 'Aquaculture', bn: 'অ্যাকোয়াকালচার' },
  headsUnit: { en: 'heads', bn: 'টি' },
  species: { en: 'Species', bn: 'প্রজাতি' },
  cycle: { en: 'Cycle', bn: 'ব্যাচ' },
  batch: { en: 'Batch', bn: 'ব্যাচ' },
  sortOrder: { en: 'Sort order', bn: 'সাজানোর ক্রম' },
  recordCreated: { en: 'Record created', bn: 'রেকর্ড তৈরি' },
  fromNursing: { en: 'From nursing', bn: 'নার্সিং থেকে' },
  nursingRole: { en: 'nursing', bn: 'নার্সিং' },
  listView: { en: 'List', bn: 'তালিকা' },
  cardsView: { en: 'Cards', bn: 'কার্ড' },
  displayLayout: { en: 'Display layout', bn: 'লেআউট' },
  allPondsFilter: { en: 'All ponds', bn: 'সব পুকুর' },
  createPondFirst: { en: 'Create a pond first', bn: 'প্রথমে একটি পুকুর তৈরি করুন' },
  addPondsFirst: { en: 'Add ponds first', bn: 'প্রথমে পুকুর যোগ করুন' },
  addAtLeastOnePond: { en: 'Add at least one pond first', bn: 'প্রথমে কমপক্ষে একটি পুকুর যোগ করুন' },
  salesNeedPond: {
    en: 'Sales are tied to a pond. Create ponds, then enter sales here.',
    bn: 'বিক্রি পুকুরের সাথে যুক্ত। পুকুর তৈরি করুন, তারপর এখানে বিক্রি দিন।',
  },
  created: { en: 'Created', bn: 'তৈরি হয়েছে' },
  createdWithCode: { en: 'Created ({code})', bn: 'তৈরি ({code})' },
  saveChanges: { en: 'Save changes', bn: 'পরিবর্তন সংরক্ষণ' },
  confirmDelete: { en: 'Delete this sale?', bn: 'এই বিক্রি মুছবেন?' },
  yearToDate: { en: 'Year to date', bn: 'বছরের শুরু থেকে' },
  last90Days: { en: 'Last 90 days', bn: 'গত 90 দিন' },
  customRange: { en: 'Custom range', bn: 'কাস্টম সময়সীমা' },
  fromDate: { en: 'From', bn: 'থেকে' },
  toDate: { en: 'To', bn: 'পর্যন্ত' },
  notSet: { en: 'Not set', bn: 'দেওয়া নেই' },
  notPosted: { en: 'Not posted', bn: 'পোস্ট হয়নি' },
  books: { en: 'Books', bn: 'বই' },
  buyer: { en: 'Buyer', bn: 'ক্রেতা' },
  income: { en: 'Income', bn: 'আয়' },
  qtyKg: { en: 'Qty/kg', bn: 'পরিমাণ/kg' },
  fishPerKgCol: { en: 'Fish/kg', bn: 'মাছ/kg' },
  recordToBooks: { en: 'Record to books', bn: 'বইতে রেকর্ড' },
  recordSale: { en: 'Record sale', bn: 'বিক্রি রেকর্ড' },
  noSalesYet: { en: 'No sales recorded.', bn: 'কোনো বিক্রি রেকর্ড নেই।' },
  pondFishSales: { en: 'Pond & fish sales', bn: 'পুকুর ও মাছ বিক্রি' },
  totalInList: { en: 'Total in list', bn: 'তালিকায় মোট' },
  costMoved: { en: 'Total value', bn: 'মোট মূল্য' },
  transferFryCost: { en: 'Fry cost', bn: 'ফ্রাই খরচ' },
  transferOtherExpense: { en: 'Other expense', bn: 'অন্যান্য খরচ' },
  fromToCol: { en: 'From → To', bn: 'থেকে → প্রতি' },
  recordTransfer: { en: 'Record transfer', bn: 'স্থানান্তর রেকর্ড' },
  saveTransfer: { en: 'Save transfer', bn: 'স্থানান্তর সংরক্ষণ' },
  editFishTransfer: { en: 'Edit fish pond transfer', bn: 'মাছ পুকুর স্থানান্তর সম্পাদনা' },
  recordFishTransfer: { en: 'Record fish pond transfer', bn: 'মাছ পুকুর স্থানান্তর রেকর্ড' },
  editTransfer: { en: 'Edit transfer', bn: 'স্থানান্তর সম্পাদনা' },
  removeTransfer: { en: 'Remove transfer', bn: 'স্থানান্তর সরান' },
  removeTransferRollback: { en: 'Remove transfer (rollback)', bn: 'স্থানান্তর সরান (রোলব্যাক)' },
  transferUpdated: { en: 'Transfer updated', bn: 'স্থানান্তর আপডেট' },
  transferRecorded: { en: 'Transfer recorded', bn: 'স্থানান্তর রেকর্ড' },
  couldNotLoadTransfers: { en: 'Could not load transfers', bn: 'স্থানান্তর লোড করা যায়নি' },
  couldNotLoadSales: { en: 'Could not load sales', bn: 'বিক্রি লোড করা যায়নি' },
  couldNotLoadIncomeTypes: { en: 'Could not load income types', bn: 'আয়ের ধরন লোড করা যায়নি' },
  couldNotRecordBooks: { en: 'Could not record to books', bn: 'বইতে রেকর্ড করা যায়নি' },
  couldNotLoadDashboard: { en: 'Could not load dashboard', bn: 'ড্যাশবোর্ড লোড করা যায়নি' },
  couldNotLoadFormData: { en: 'Could not load form data', bn: 'ফর্ম ডেটা লোড করা যায়নি' },
  couldNotLoadExpenses: { en: 'Could not load expenses', bn: 'খরচ লোড করা যায়নি' },
  couldNotLoadFeedingAdvice: { en: 'Could not load feeding advice', bn: 'খাদ্য পরামর্শ লোড করা যায়নি' },
  failedLoadFinancing: { en: 'Failed to load financing', bn: 'অর্থায়ন লোড ব্যর্থ' },
  salePostedEditBlocked: {
    en: 'This line is already in the books. Change it from Invoices, or delete that invoice to unlock editing here.',
    bn: 'এই সারি ইতিমধ্যে বইতে। Invoices থেকে পরিবর্তন করুন, অথবা ইনভয়েস মুছে এখানে সম্পাদনা খুলুন।',
  },
  salePostedDeleteBlocked: {
    en: 'Remove or void the linked invoice first, then you can delete this line.',
    bn: 'প্রথমে লিঙ্ক করা ইনভয়েস সরান বা বাতিল করুন, তারপর এই সারি মুছতে পারবেন।',
  },
  deleteLinkedInvoiceFirst: { en: 'Delete the linked invoice first', bn: 'প্রথমে লিঙ্ক করা ইনভয়েস মুছুন' },
  recordToBooksTitle: { en: 'Use Record in Actions to create the invoice and GL entry', bn: 'ইনভয়েস ও GL এন্ট্রি তৈরিতে Actions-এ Record ব্যবহার করুন' },
  editCostFromPl: { en: 'Edit and save to fill from source pond P&L', bn: 'উৎস পুকুর P&L থেকে পূরণ করতে সম্পাদনা ও সংরক্ষণ করুন' },
  chooseCustomerAr: { en: 'Choose a customer for on-account (A/R) sales.', bn: 'অ্যাকাউন্টে (A/R) বিক্রির জন্য গ্রাহক বেছে নিন।' },
  recordedInvoice: {
    en: 'Recorded: {invNo}. Revenue is in the journal (AUTO-INV sale entry).',
    bn: 'রেকর্ড: {invNo}. আয় জার্নালে (AUTO-INV বিক্রি এন্ট্রি)।',
  },
  howSettled: { en: 'How was it settled?', bn: 'কীভে নিষ্পত্তি হয়েছে?' },
  cashImmediate: { en: 'Cash or immediate payment', bn: 'নগদ বা তাৎক্ষণিক পেমেন্ট' },
  cashImmediateHint: { en: 'Invoice status: paid. Debits cash (or card clearing).', bn: 'ইনভয়েস: paid। নগদ (বা কার্ড ক্লিয়ারিং) ডেবিট।' },
  onAccountAr: { en: 'On account (A/R)', bn: 'অ্যাকাউন্টে (A/R)' },
  onAccountArHint: { en: 'Invoice status: sent. Debits accounts receivable.', bn: 'ইনভয়েস: sent। Accounts receivable ডেবিট।' },
  paymentMethod: { en: 'Payment method', bn: 'পেমেন্ট পদ্ধতি' },
  payCash: { en: 'Cash', bn: 'নগদ' },
  payCard: { en: 'Card', bn: 'কার্ড' },
  payBank: { en: 'Bank / transfer', bn: 'ব্যাংক / ট্রান্সফার' },
  billToCustomer: { en: 'Bill-to customer', bn: 'বিল-টু গ্রাহক' },
  selectCustomer: { en: 'Select customer…', bn: 'গ্রাহক নির্বাচন…' },
  pondCustomerHint: {
    en: 'Or link the pond to a POS customer under Ponds — it will be used if you leave this empty (on account only).',
    bn: 'অথবা Ponds-এ POS গ্রাহক লিঙ্ক করুন — খালি রাখলে (শুধু on account) সেটি ব্যবহার হবে।',
  },
  dueDate: { en: 'Due date', bn: 'পরিশোধের তারিখ' },
  invoiceCustomerOptional: { en: 'Invoice customer (optional)', bn: 'ইনভয়েস গ্রাহক (ঐচ্ছিক)' },
  walkInDefault: { en: 'Walk-in (default)', bn: 'ওয়াক-ইন (ডিফল্ট)' },
  finalizeIntro: {
    en: 'Creates invoice {invRef}, posts revenue to your aquaculture income account (by income type), and debits cash or accounts receivable. You can still see this row here for pond reporting; amounts lock until the invoice is removed.',
    bn: 'ইনভয়েস {invRef} তৈরি, আয়ের ধরন অনুযায়ী অ্যাকোয়াকালচার আয় অ্যাকাউন্টে revenue পোস্ট, নগদ বা A/R ডেবিট। পুকুর রিপোর্টিংয়ের জন্য সারি এখানে থাকবে; ইনভয়েস সরানো পর্যন্ত পরিমাণ লক।',
  },
  salesIntro: {
    en: 'Record one buyer visit with multiple lines — different species, or the same species from different production cycles (size and price). Plus pond-side income such as empty feed sacks and sales of used or scrap materials. Use Cashier for packaged retail over the counter—this screen is the operational record for fish leaving ponds (kg, head) and aquaculture revenue. Use income type to classify each line; feed purchases stay on Expenses. Use Record to books on a row to create the invoice and GL entry (aquaculture revenue 4240–4244, cash or A/R).',
    bn: 'এক ক্রেতার এক ভিজিটে একাধিক লাইন — বিভিন্ন প্রজাতি, বা এক প্রজাতির বিভিন্ন ব্যাচ (আকার ও দাম)। খালি ফিড ব্যাগ, ব্যবহৃত/স্ক্র্যাপ বিক্রি সহ পুকুর-পাশের আয়। কাউন্টার রিটেইলের জন্য Cashier — এখানে পুকুর থেকে মাছ (kg, head) ও অ্যাকোয়াকালচার আয়ের অপারেশনাল রেকর্ড। প্রতি লাইনে income type; ফিড কেনা Expenses-এ। সারিতে Record to books দিয়ে ইনভয়েস ও GL (4240–4244, নগদ বা A/R)।',
  },
  cashier: { en: 'Cashier', bn: 'Cashier' },

  // —— Cycles / stocking batches ——
  cyclesIntro: {
    en: 'Each tilapia fry purchase is a new batch (C01, C02, C03 per season). Other species usually share one open batch per pond that keeps growing — FSERP reuses it on new bills unless you start a 2nd batch on purpose.',
    bn: 'প্রতি tilapia ফ্রাই কেনা নতুন ব্যাচ (মৌসুমে C01, C02, C03)। অন্য প্রজাতিতে সাধারণত পুকুরে একটি খোলা ব্যাচ — নতুন বিলে FSERP পুনরায় ব্যবহার করে, ইচ্ছাকৃত 2য় ব্যাচ ছাড়া।',
  },
  cyclesWorkflowTitle: { en: 'Stocking batches — tilapia vs other species', bn: 'স্টকিং ব্যাচ — tilapia বনাম অন্য প্রজাতি' },
  cyclesWorkflowTilapiaPhase: { en: 'Tilapia (main crop)', bn: 'Tilapia (প্রধান ফসল)' },
  cyclesWorkflowTilapiaDetail: {
    en: 'Three fry purchases per season → three nursing batches (C01, C02, C03). Each new fry bill to the nursing pond opens a new batch unless you pick one manually. Transfer fingerlings with the source batch selected; grow-out ponds get linked batches.',
    bn: 'মৌসুমে তিন ফ্রাই কেনা → তিন নার্সিং ব্যাচ (C01, C02, C03)। নার্সিং পুকুরে নতুন ফ্রাই বিলে নতুন ব্যাচ (ম্যানুয়াল নির্বাচন ছাড়া)। উৎস ব্যাচ নির্বাচন করে আঙুলlings স্থানান্তর; grow-out-এ লিঙ্কড ব্যাচ।',
  },
  cyclesWorkflowOtherPhase: { en: 'Other species', bn: 'অন্য প্রজাতি' },
  cyclesWorkflowOtherDetail: {
    en: 'Usually one batch per pond that keeps growing (pangasius, carp, etc.). FSERP reuses the open batch when you post another fry or cost bill to the same pond and species. Start a 2nd batch only when you deliberately add a new cycle and close the old one.',
    bn: 'সাধারণত পুকুরে একটি ব্যাচ (pangasius, carp ইত্যাদি)। একই পুকুর ও প্রজাতিতে ফ্রাই/খরচ বিলে FSERP খোলা ব্যাচ পুনরায় ব্যবহার। ইচ্ছাকৃত নতুন চক্র ও পুরনো বন্ধ করলে 2য় ব্যাচ।',
  },
  cyclesWorkflowNursingPhase: { en: 'Nursing care', bn: 'নার্সিং যত্ন' },
  cyclesWorkflowNursingDetail: {
    en: 'Record feeding, mortality, and biomass sampling with the batch selected so growth and FCR stay with the right cohort.',
    bn: 'ব্যাচ নির্বাচন করে খাদ্য, মৃত্যু, বায়োমাস নমুনা রেকর্ড করুন — বৃদ্ধি ও FCR সঠিক cohort-এ থাকে।',
  },
  cyclesWorkflowGrowOutPhase: { en: 'Grow-out', bn: 'Grow-out' },
  cyclesWorkflowGrowOutDetail: {
    en: 'Tag feed bills, medicine, and harvest sales to the batch for margin per cohort. Shared pond costs (electricity split across ponds) stay pond-level without a batch.',
    bn: 'ফিড বিল, ঔষধ, ধরা বিক্রি ব্যাচে ট্যাগ করুন cohort অনুযায়ী মার্জিনের জন্য। ভাগ করা পুকুর খরচ (বিদ্যুৎ) ব্যাচ ছাড়া পুকুর-স্তরে।',
  },
  addBatch: { en: 'Add batch', bn: 'ব্যাচ যোগ' },
  editStockingBatch: { en: 'Edit stocking batch', bn: 'স্টকিং ব্যাচ সম্পাদনা' },
  newStockingBatch: { en: 'New stocking batch', bn: 'নতুন স্টকিং ব্যাচ' },
  batchName: { en: 'Batch name', bn: 'ব্যাচের নাম' },
  codeLabel: { en: 'Code', bn: 'কোড' },
  codePlaceholder: { en: 'e.g. C01', bn: 'যেমন C01' },
  cycleCodeAuto: { en: 'Cycle code (assigned automatically)', bn: 'চক্র কোড (স্বয়ংক্রিয়)' },
  cycleCodeHint: {
    en: 'Per pond: C01, C02, … with the lowest free number for this pond (gaps refill after a cycle is deleted).',
    bn: 'পুকুরভিত্তিক: C01, C02, … সর্বনিম্ন খালি নম্বর (ব্যাচ মুছলে ফাঁক পূরণ)।',
  },
  endDateOptional: { en: 'End date (optional — leave empty if open)', bn: 'শেষ তারিখ (ঐচ্ছিক — খোলা থাকলে খালি)' },
  continuousBatchHint: {
    en: 'One continuous batch per pond is normal for this species. Only add a 2nd batch if you are deliberately starting a new rare stocking.',
    bn: 'এই প্রজাতিতে পুকুরে একটি ধারাবাহিক ব্যাচ স্বাভাবিক। ইচ্ছাকৃত নতুন স্টকিং ছাড়া 2য় ব্যাচ দেবেন না।',
  },
  tilapiaBatchHint: {
    en: 'Tilapia: up to three fry batches per season (C01, C02, C03) on nursing, then linked grow-out batches.',
    bn: 'Tilapia: মৌসুমে সর্বোচ্চ তিন ফ্রাই ব্যাচ (C01, C02, C03) নার্সিং-এ, তারপর লিঙ্কড grow-out ব্যাচ।',
  },
  pondNameStartRequired: { en: 'Pond, name, and start date are required', bn: 'পুকুর, নাম ও শুরুর তারিখ আবশ্যক' },
  confirmDeleteCycle: {
    en: 'Delete cycle "{name}"? This cannot be undone if no dependencies block it.',
    bn: 'চক্র "{name}" মুছবেন? নির্ভরতা না থাকলে এটি পূর্বাবস্থায় ফেরানো যাবে না।',
  },
  noBatchesPondFilter: {
    en: 'No batches for this pond in this view. Add a batch or clear the pond filter.',
    bn: 'এই ভিউতে এই পুকুরের ব্যাচ নেই। ব্যাচ যোগ করুন বা পুকুর ফিল্টার সাফ করুন।',
  },
  noBatchesYet: {
    en: 'No stocking batches yet. Add one when you buy fry, or let FSERP create it when you post a fry bill to the nursing pond.',
    bn: 'এখনো স্টকিং ব্যাচ নেই। ফ্রাই কেনার সময় যোগ করুন, অথবা নার্সিং পুকুরে ফ্রাই বিল পোস্ট করলে FSERP তৈরি করবে।',
  },
  createPondThenBatches: {
    en: 'first, then open stocking batches for each fry purchase.',
    bn: 'প্রথমে, তারপর প্রতি ফ্রাই কেনায় স্টকিং ব্যাচ খুলুন।',
  },
  periodOpen: { en: 'Open', bn: 'খোলা' },
  codeOrder: { en: 'Code {code} · Order {order}', bn: 'কোড {code} · ক্রম {order}' },
  codeSort: { en: 'Code {code} · Sort {order}', bn: 'কোড {code} · সাজানো {order}' },

  // —— Transfers ——
  noTransfersYet: {
    en: 'No transfers yet. Example: log fry on a vendor bill (kg + heads), then record a transfer with each line showing destination pond, kg moved, and head count (required). Optional cost per line reallocates nursing biological cost to grow-out ponds.',
    bn: 'এখনো স্থানান্তর নেই। উদাহরণ: ভেন্ডর বিলে ফ্রাই (kg + head), তারপর প্রতি লাইনে গন্তব্য পুকুর, kg ও head count সহ স্থানান্তর। লাইনে ঐচ্ছিক খরচ নার্সিং জৈবিক খরচ grow-out-এ স্থানান্তর।',
  },
  noBookStockSource: { en: 'No book stock in the source pond for this species/cycle.', bn: 'এই প্রজাতি/চক্রের জন্য উৎস পুকুরে বই স্টক নেই।' },
  allFishUsed: { en: 'Other lines already use all available fish — reduce counts or check stock.', bn: 'অন্য লাইনে সব মাছ ব্যবহৃত — সংখ্যা কমান বা স্টক দেখুন।' },
  linkGrowOutFirst: { en: 'Link a grow-out pond on the same physical site from Ponds setup first.', bn: 'প্রথমে Ponds সেটআপ থেকে একই সাইটে grow-out পুকুর লিঙ্ক করুন।' },
  selectSourcePond: { en: 'Select source pond', bn: 'উৎস পুকুর নির্বাচন' },
  speciesOtherRequired: { en: 'Enter a species description when species is "Other"', bn: 'প্রজাতি "Other" হলে বিবরণ দিন' },
  confirmNoSample: {
    en: 'No biomass sample found for this pond, cycle, and species. Weight from head count may be wrong. Record a sample under Aquaculture → Sampling first. Save this transfer anyway?',
    bn: 'এই পুকুর, চক্র ও প্রজাতির বায়োমাস নমুনা নেই। head count থেকে ওজন ভুল হতে পারে। Aquaculture → Sampling-এ নমুনা রেকর্ড করুন। তবু সংরক্ষণ?',
  },
  confirmStaleSample: {
    en: 'Latest sample is {days} days old (>{maxDays}). Fingerling size may have changed — consider re-sampling. Continue with this pcs/kg?',
    bn: 'সর্বশেষ নমুনা {days} দিন পুরনো (>{maxDays})। আঙুলlings আকার বদলেছে — পুনঃনমুনা বিবেচনা করুন। এই pcs/kg দিয়ে চালাবেন?',
  },
  confirmHeadsExceed: {
    en: 'Transfer lines total {total} heads but book stock shows {available} available. Continue anyway?',
    bn: 'স্থানান্তর লাইন মোট {total} head কিন্তু বই স্টক {available}। তবু চালাবেন?',
  },
  lineSelectDest: { en: 'Line {n}: select destination pond', bn: 'লাইন {n}: গন্তব্য পুকুর নির্বাচন' },
  lineDestDiffSource: { en: 'Line {n}: destination must differ from source pond', bn: 'লাইন {n}: গন্তব্য উৎস পুকুর থেকে আলাদা হতে হবে' },
  lineWeightRequired: { en: 'Line {n}: weight (kg) must be greater than zero', bn: 'লাইন {n}: ওজন (kg) শূন্যের বেশি' },
  lineHeadsRequired: { en: 'Line {n}: fish count (heads) is required', bn: 'লাইন {n}: মাছের সংখ্যা (head) আবশ্যক' },
  lineHeadsPositive: { en: 'Line {n}: fish count must be a positive integer', bn: 'লাইন {n}: মাছের সংখ্যা ধনাত্মক পূর্ণসংখ্যা' },
  linePcsRequired: { en: 'Line {n}: pcs/kg is required — record a biomass sample or enter pcs/kg manually', bn: 'লাইন {n}: pcs/kg আবশ্যক — বায়োমাস নমুনা বা ম্যানুয়াল pcs/kg' },
  linePcsPositive: { en: 'Line {n}: pcs/kg must be greater than zero', bn: 'লাইন {n}: pcs/kg শূন্যের বেশি' },
  lineCostValid: { en: 'Line {n}: cost amount must be a valid non-negative number', bn: 'লাইন {n}: খরচের পরিমাণ বৈধ অ-ঋণাত্মক সংখ্যা' },
  lineInvalidCycle: { en: 'Line {n}: invalid production cycle', bn: 'লাইন {n}: অবৈধ উৎপাদন চক্র' },
  lineInvalidPcs: { en: 'Line {n}: invalid pcs/kg', bn: 'লাইন {n}: অবৈধ pcs/kg' },
  invalidSourceCycle: { en: 'Invalid source production cycle', bn: 'অবৈধ উৎস উৎপাদন চক্র' },
  confirmRemoveTransfer: {
    en: 'Remove this fish transfer? Pond stock and management P&L will be recalculated as if it never happened (same as rolling back the transfer).',
    bn: 'এই মাছ স্থানান্তর সরাবেন? পুকুর স্টক ও ব্যবস্থাপনা P&L পুনঃহিসাব — যেন স্থানান্তর হয়নি (রোলব্যাক)।',
  },
  nursingFingerlingTransfer: { en: 'Nursing → fingerling transfer', bn: 'নার্সিং → fingerling স্থানান্তর' },
  nursingWarehouseMoved: {
    en: 'Remaining feed/medicine warehouse stock moved to grow-out pond(s).',
    bn: 'অবশিষ্ট ফিড/ঔষধ গুদাম স্টক grow-out পুকুরে স্থানান্তর হয়েছে।',
  },
  nursingEmptyingNote: {
    en: 'When all fingerlings leave the nursing pond, production costs move with the fish (by head count and weight share) and leftover feed/medicine stock moves automatically.',
    bn: 'সব fingerling চলে গেলে উৎপাদন খরচ মাছের সাথে (সংখ্যা ও ওজন অনুপাতে) যায় এবং অবশিষ্ট ফিড/ঔষধ স্টক স্বয়ংক্রিয়ভাবে grow-out-এ যায়।',
  },
  sameSiteGrowOut: { en: 'Same-site grow-out', bn: 'একই সাইট grow-out' },
  loadingSampleStock: { en: 'Loading sample & book stock for source pond…', bn: 'উৎস পুকুরের নমুনা ও বই স্টক লোড…' },
  biomassSampleTransfer: { en: 'Biomass sample for transfer', bn: 'স্থানান্তরের জন্য বায়োমাস নমুনা' },
  sampleFish: { en: 'Sample fish', bn: 'নমুনা মাছ' },
  sampleKg: { en: 'Sample kg', bn: 'নমুনা kg' },
  fishKgPcs: { en: 'Fish/kg (pcs/kg)', bn: 'মাছ/kg (pcs/kg)' },
  bookHeadAtSample: { en: 'Book head at sample', bn: 'নমুনার সময় বই head' },
  noSampleOnCycle: {
    en: 'No sample on the selected source cycle — using latest sample for this pond and species ({cycle}).',
    bn: 'নির্বাচিত উৎস চক্রে নমুনা নেই — এই পুকুর ও প্রজাতির সর্বশেষ নমুনা ({cycle})।',
  },
  siteScopeSample: {
    en: 'Latest seine sample for this physical site was recorded on {pond} — pcs/kg and book head are still applied to this transfer.',
    bn: 'এই সাইটের সর্বশেষ seine নমুনা {pond}-এ — pcs/kg ও book head এখনও এই স্থানান্তরে প্রয়োগ।',
  },
  anotherProfitCenter: { en: 'another profit center', bn: 'অন্য profit center' },
  sampleNoPcs: {
    en: 'Sample found but pcs/kg could not be calculated — enter seine fish count and sample kg on the sampling record, or type pcs/kg manually on each line.',
    bn: 'নমুনা পাওয়া গেছে কিন্তু pcs/kg হিসাব হয়নি — sampling-এ seine count ও kg দিন, বা প্রতি লাইনে pcs/kg লিখুন।',
  },
  sampleStaleWarning: {
    en: 'Sample is {days} days old — consider re-sampling before large transfers.',
    bn: 'নমুনা {days} দিন পুরনো — বড় স্থানান্তরের আগে পুনঃনমুনা বিবেচনা করুন।',
  },
  pcsAppliedHint: {
    en: 'Pcs/kg is applied from this record. Enter fish count (heads) per line — weight and cost derive automatically (all fields stay editable).',
    bn: 'এই রেকর্ড থেকে pcs/kg প্রয়োগ। প্রতি লাইনে head count — ওজন ও খরচ স্বয়ংক্রিয় (সব ক্ষেত্র সম্পাদনযোগ্য)।',
  },
  openSampling: { en: 'Open sampling', bn: 'Sampling খুলুন' },
  noLiveSample: { en: 'No live biomass sample for this pond and species', bn: 'এই পুকুর ও প্রজাতির লাইভ বায়োমাস নমুনা নেই' },
  noLiveSampleBody: {
    en: 'Select the source pond where you recorded the sample (e.g. Digonta Nursing), then record seine weighing under Sampling if needed. You can still save by entering pcs/kg manually on each line.',
    bn: 'যে উৎস পুকুরে নমুনা রেকর্ড করেছেন সেটি নির্বাচন করুন, প্রয়োজনে Sampling-এ seine ওজন রেকর্ড করুন। প্রতি লাইনে pcs/kg দিয়ে সংরক্ষণ করা যায়।',
  },
  recordSampleNow: { en: 'Record sample now', bn: 'এখনই নমুনা রেকর্ড' },
  bookStockSource: { en: 'Book stock (source pond)', bn: 'বই স্টক (উৎস পুকুর)' },
  estBiomass: { en: '· ~{kg} kg est. biomass', bn: '· ~{kg} kg আনুমানিক বায়োমাস' },
  bookKgParen: { en: '(book {kg} kg)', bn: '(বই {kg} kg)' },
  thisTransfer: { en: 'This transfer', bn: 'এই স্থানান্তর' },
  remainingAfter: { en: 'Remaining after', bn: 'পরে অবশিষ্ট' },
  fromPondSource: { en: 'From pond (source)', bn: 'থেকে পুকুর (উৎস)' },
  selectSourcePondPh: { en: 'Select source pond…', bn: 'উৎস পুকুর নির্বাচন…' },
  transferDate: { en: 'Transfer date', bn: 'স্থানান্তরের তারিখ' },
  sourceStockingBatch: { en: 'Source stocking batch (nursing cohort)', bn: 'উৎস স্টকিং ব্যাচ (নার্সিং cohort)' },
  noneOption: { en: '— None —', bn: '— কিছু নেই —' },
  sourceBatchHint: {
    en: 'Pick the fry batch leaving nursing (e.g. C02). FSERP opens a linked grow-out batch on each destination pond when you leave destination batch blank.',
    bn: 'নার্সিং ছাড়া ফ্রাই ব্যাচ (যেমন C02) বেছে নিন। গন্তব্য ব্যাচ খালি রাখলে FSERP প্রতি গন্তব্য পুকুরে লিঙ্কড grow-out ব্যাচ খোলে।',
  },
  speciesDescription: { en: 'Species description', bn: 'প্রজাতির বিবরণ' },
  speciesDescPh: { en: 'e.g. local strain', bn: 'যেমন স্থানীয় জাত' },
  destinationLines: { en: 'Destination lines', bn: 'গন্তব্য লাইন' },
  resetCostsAuto: { en: 'Reset costs to auto', bn: 'খরচ স্বয়ংক্রিয়ে রিসেট' },
  sameSiteGrowOutBtn: { en: '+ Same-site grow-out', bn: '+ একই সাইট grow-out' },
  addLine: { en: '+ Add line', bn: '+ লাইন যোগ' },
  calculatingTransferCost: { en: 'Calculating transfer cost from pond production costs…', bn: 'পুকুর উৎপাদন খরচ থেকে স্থানান্তর খরচ হিসাব…' },
  enterHeadsFirst: {
    en: 'Enter fish count (heads) on each line first — weight (kg) and cost fill from the latest sample pcs/kg and pond production costs ({rate}). Edit any field to override.',
    bn: 'প্রতি লাইনে head count প্রথমে — ওজন (kg) ও খরচ সর্বশেষ pcs/kg ও উৎপাদন খরচ ({rate}) থেকে। ওভাররাইড করতে যেকোনো ক্ষেত্র সম্পাদনা।',
  },
  perHead: { en: '/head', bn: '/head' },
  perKg: { en: '/kg', bn: '/kg' },
  enterHeadsManualCost: {
    en: 'Enter heads first; weight derives from sample pcs/kg when available. Auto cost needs pond costs recorded — otherwise enter cost manually.',
    bn: 'প্রথমে head; pcs/kg থেকে ওজন। স্বয়ংক্রিয় খরচের জন্য পুকুর খরচ রেকর্ড — না হলে ম্যানুয়াল খরচ।',
  },
  lineN: { en: 'Line {n}', bn: 'লাইন {n}' },
  toPond: { en: 'To pond', bn: 'গন্তব্য পুকুর' },
  toCycleOptional: { en: 'To cycle (optional)', bn: 'গন্তব্য চক্র (ঐচ্ছিক)' },
  fishCountHeadsFirst: { en: 'Fish count (heads) * — enter first', bn: 'মাছের সংখ্যা (head) * — প্রথমে দিন' },
  fishCountPh: { en: 'e.g. 200000', bn: 'যেমন 200000' },
  pcsFromSample: { en: 'Pcs/kg (from sample)', bn: 'Pcs/kg (নমুনা থেকে)' },
  enterMeasuredPcs: { en: 'Enter measured pcs/kg', bn: 'পরিমাপ pcs/kg দিন' },
  weightAutoHeads: { en: 'Weight (kg) * — auto from heads ÷ pcs/kg', bn: 'ওজন (kg) * — head ÷ pcs/kg থেকে স্বয়ংক্রিয়' },
  weightFilledPh: { en: 'Filled when heads + pcs/kg set', bn: 'head + pcs/kg দিলে পূরণ' },
  costAmountBdt: { en: 'Cost amount (BDT)', bn: 'খরচের পরিমাণ (BDT)' },
  costAutoPh: { en: 'Auto when heads/kg entered', bn: 'head/kg দিলে স্বয়ংক্রিয়' },
  costManualPh: { en: 'Enter manually', bn: 'ম্যানুয়াল দিন' },
  fillRemainder: { en: 'Fill remainder ({n} heads)', bn: 'অবশিষ্ট পূরণ ({n} head)' },
  memoTransferPh: { en: 'e.g. Post-nursing split batch 2026-A', bn: 'যেমন Post-nursing split batch 2026-A' },
  nursingPondSuffix: { en: '(nursing', bn: '(নার্সিং' },
  nursingStep1: {
    en: 'Stock fry on a vendor bill to the nursing-phase pond (e.g. 500,000 fry @ 3,000 pcs/kg).',
    bn: 'নার্সিং-ফেজ পুকুরে ভেন্ডর বিলে ফ্রাই স্টক (যেমন 500,000 @ 3,000 pcs/kg)।',
  },
  nursingStep2: {
    en: 'Record mortality and feeding while nursing on that pond.',
    bn: 'সেই পুকুরে নার্সিংয়ে মৃত্যু ও খাদ্য রেকর্ড।',
  },
  nursingStep3: {
    en: 'Sample biomass until fingerling size (record measured pcs/kg — varies by batch).',
    bn: 'fingerling আকার পর্যন্ত বায়োমাস নমুনা (pcs/kg রেকর্ড — ব্যাচভেদে)।',
  },
  nursingStep4: {
    en: 'Transfer fingerlings to production ponds — and transfer remainder to the grow-out pond on the same site.',
    bn: 'fingerlings উৎপাদন পুকুরে স্থানান্তর — অবশিষ্ট একই সাইটের grow-out-এ।',
  },

  // —— Pond costs / expenses page ——
  pondCosts: { en: 'Pond costs', bn: 'পুকুর খরচ' },
  recordVendorBill: { en: 'Record vendor bill', bn: 'ভেন্ডর বিল রেকর্ড' },
  filterPondLabel: { en: 'Filter pond', bn: 'পুকুর ফিল্টার' },
  clearDates: { en: 'Clear dates', bn: 'তারিখ সাফ' },
  pondsPage: { en: 'Ponds', bn: 'পুকুর' },
  expensesBillsFirstTitle: { en: 'Bills-first accounting', bn: 'বিল-প্রথম হিসাব' },
  expensesBillsFirstPart1: {
    en: 'New pond operating costs are recorded on ',
    bn: 'নতুন পুকুর পরিচালন খরচ ',
  },
  expensesBillsFirstVendorBills: { en: 'Vendor bills', bn: 'Vendor bills' },
  expensesBillsFirstPart2: {
    en: ' (pond tag + expense category → automatic 671x chart account). After posting, use ',
    bn: ' (পুকুর ট্যাগ + ব্যয় ক্যাটাগরি → স্বয়ংক্রিয় 671x chart account)। পোস্টের পর ',
  },
  expensesBillsFirstPayments: { en: 'Payments', bn: 'Payments' },
  expensesBillsFirstPart3: {
    en: ' for bank/cash. The table lists ',
    bn: ' ব্যবহার করুন ব্যাংক/নগদের জন্য। টেবিলে ',
  },
  expensesBillsFirstVendorBillLines: { en: 'vendor bill lines', bn: 'vendor bill লাইন' },
  expensesBillsFirstPart4: {
    en: ' and legacy shop/warehouse entries — use ',
    bn: ' ও পুরনো দোকান/গুদাম এন্ট্রি — বিল সারিতে ',
  },
  expensesBillsFirstView: { en: 'View', bn: 'View' },
  expensesBillsFirstPart5: {
    en: ' on bill rows to open the source document.',
    bn: ' দিয়ে মূল দলিল খুলুন।',
  },
  expensesPosRecommendedTitle: {
    en: 'Recommended: stock to ponds via POS on account',
    bn: 'প্রস্তাবিত: POS অ্যাকাউন্টে পুকুরে স্টক',
  },
  expensesPosStep1EnPrefix: { en: 'On ', bn: '' },
  expensesPosStep1Suffix: {
    en: ', each new production unit gets a POS customer automatically; change or clear there if you use a different AR account.',
    bn: 'ে প্রতি নতুন উৎপাদন ইউনিটে স্বয়ংক্রিয় POS গ্রাহক তৈরি হয়; ভিন্ন A/R অ্যাকাউন্ট চালান হলে সেখানে বদলান বা সাফ করুন।',
  },
  expensesPosStep2EnPrefix: { en: 'Open ', bn: '' },
  expensesPosStep2Suffix: {
    en: ' (or use “Open POS” from the pond row), add inventoried lines, and settle on account for that customer.',
    bn: ' খুলুন (অথবা পুকুর সারি থেকে “Open POS”), স্টক আইটেম লাইন যোগ করুন ও সেই গ্রাহকের অ্যাকাউন্টে নিষ্পত্তি করুন।',
  },
  expensesPosStep3Prefix: {
    en: 'On the pond list, use ',
    bn: 'পুকুর তালিকায় প্রতি সারিতে ',
  },
  expensesPosLedger: { en: 'Ledger', bn: 'Ledger' },
  expensesPosStep3Middle: { en: ' or ', bn: ' অথবা ' },
  expensesPosPosShortcut: { en: 'POS', bn: 'POS' },
  expensesPosStep3Suffix: {
    en: ' shortcuts on each row to review A/R or sell again.',
    bn: ' শর্টকাট দিয়ে A/R দেখুন বা আবার বিক্রি করুন।',
  },
  expensesPosFooter: {
    en: 'Record non-POS spend below. Only use the advanced internal issue if you intentionally move stock at average cost without a POS sale—and never for the same physical goods already invoiced on POS.',
    bn: 'নন-POS খরচ নিচে রেকর্ড করুন। advanced internal issue শুধু যখন ইচ্ছাকৃতভাবে POS বিক্রি ছাড়া average cost-এ স্টক সরান—এবং POS-এ ইতিমধ্যে ইনভয়েস করা একই পণ্যের জন্য কখনো নয়।',
  },
  expensesAdvancedStockIssue: {
    en: 'Advanced: internal stock issue at cost (optional)',
    bn: 'অ্যাডভান্সড: average cost-এ অভ্যন্তরীণ স্টক ইস্যু (ঐচ্ছিক)',
  },
  expensesAdvancedStockIssueBodyPrefix: {
    en: 'Bypasses POS: decrements station quantity, posts COGS / inventory at average cost, and creates one pond expense. Use sparingly—for example a true internal transfer with no sale document. Items need cost or unit price and sufficient per-station QOH. You can set each station\'s default pond on the ',
    bn: 'POS বাইপাস: স্টেশন পরিমাণ কমায়, average cost-এ COGS / inventory পোস্ট, এক পুকুর ব্যয় তৈরি। কম ব্যবহার—যেমন বিক্রি দলিল ছাড়া সত্যিকার অভ্যন্তরীণ স্থানান্তর। আইটেমে cost বা unit price ও স্টেশনে পর্যাপ্ত QOH লাগে। প্রতি স্টেশনের ডিফল্ট পুকুর ',
  },
  expensesAdvancedStockIssueBodySuffix: {
    en: ' page (optional prefill only).',
    bn: ' পৃষ্ঠায় সেট করতে পারেন (ঐচ্ছিক প্রিফিল)।',
  },
  stationsPage: { en: 'Stations', bn: 'স্টেশন' },

  // —— Dashboard ——
  dashboardCompanyHint: {
    en: 'When fish farming is a different business than fuel retail (for example Premium Agro vs the filling station) but the same owner, create a separate company for each under one organization, switch books from the header company menu, and turn on aquaculture only on the farming company. A station named Premium Agro is only a site inside the company you are viewing—not a second set of books by itself.',
    bn: 'মাছ চাষ ও ফুয়েল রিটেইল যখন ভিন্ন ব্যবসা (উদাহরণ: Premium Agro বনাম পেট্রোল পাম্প) কিন্তু একই মালিক, তখন এক সংগঠনের অধীনে প্রতিটির জন্য আলাদা company তৈরি করুন। হেডারের company মেনু থেকে বই বদলান এবং aquaculture শুধু চাষের company-তে চালু করুন। Premium Agro নামের station শুধু আপনি যে company দেখছেন তার ভিতরের একটি সাইট—স্বতন্ত্র বই নয়।',
  },
  dashboardActivityChartsPart1: {
    en: 'Activity charts and “recent” lists use the latest sale and expense batches returned by the API (up to 500 lines each); P&L figures above always cover the full selected dates. For FCR, record feed kg on ',
    bn: 'অ্যাক্টিভিটি চার্ট ও “সাম্প্রতিক” তালিকা API থেকে আসা সর্বশেষ বিক্রি ও ব্যয় ব্যাচ ব্যবহার করে (প্রতিটিতে 500 সারি পর্যন্ত); উপরের P&L সর্বদা পুরো নির্বাচিত তারিখ কভার করে। FCR-এর জন্য feed kg রেকর্ড করুন ',
  },
  dashboardOperatingExpensesLink: { en: 'Operating expenses', bn: 'অপারেটিং ব্যয়' },
  dashboardActivityChartsPart2: {
    en: ' when feed is not inventoried through POS; POS-on-account feed for pond customers posts to shop/inventory GL and does not count in module expense totals unless you mirror it here.',
    bn: ' যখন POS-এর মাধ্যমে feed স্টকে নয়; পুকুর গ্রাহকের জন্য POS অ্যাকাউন্টে feed shop/inventory GL-এ পোস্ট হয় এবং এখানে মডিউল ব্যয় মোটে গণনা হয় না যদি না এখানে মিলিয়ে রেকর্ড করেন।',
  },
  dashboardFcrNoteLabel: { en: 'FCR note:', bn: 'FCR নোট:' },
  dashboardFcrNotePart1: {
    en: 'Using all sale-line weight (including fingerlings, etc.) would give {weight}. The headline FCR uses ',
    bn: 'সব বিক্রি-সারির ওজন (fingerlings ইত্যাদি সহ) দিয়ে {weight} হত। হেডলাইন FCR শুধু ',
  },
  dashboardFcrNoteFishHarvest: { en: 'fish harvest sale', bn: 'মাছ ধরা বিক্রি' },
  dashboardFcrNotePart2: { en: ' weight only.', bn: ' ওজন ব্যবহার করে।' },
  dashboardNursingWorkflowTitle: {
    en: 'Physical site: fry nursing → fingerling transfers',
    bn: 'ভৌত সাইট: ফ্রাই নার্সিং → আঙুল (fingerling) স্থানান্তর',
  },
  dashboardNursingWorkflowIntro: {
    en: 'Each physical pond can have two profit centers — nursing phase (e.g. Mynuddin Nursing Pond at 3,000 pcs/kg) and grow-out phase (Mynuddin Pond). After sampling records the current pcs/kg for that batch, transfer to production ponds and move remainder to the grow-out pond on the same site.',
    bn: 'প্রতি ভৌত পুকুরে দুটি profit center — নার্সিং ফেজ (যেমন Mynuddin Nursing Pond, 3,000 pcs/kg) ও grow-out ফেজ (Mynuddin Pond)। নমুনায় ব্যাচের বর্তমান pcs/kg রেকর্ডের পর উৎপাদন পুকুরে স্থানান্তর করুন এবং অবশিষ্ট একই সাইটের grow-out পুকুরে সরান।',
  },
  dashboardPondsSitePair: { en: 'Ponds · create site pair', bn: 'পুকুর · সাইট পেয়ার তৈরি' },
  dashboardStockFryBill: { en: 'Stock fry (vendor bill)', bn: 'ফ্রাই স্টক (vendor bill)' },
  dashboardTransferFingerlings: { en: 'Transfer fingerlings', bn: 'আঙুলlings স্থানান্তর' },

  // —— Pond go-live fleet banner ——
  goLiveSetupInProgress: { en: 'Go-live setup in progress', bn: 'গো-লাইভ সেটআপ চলছে' },
  goLiveAllPondsReady: { en: 'All ponds ready for go-live', bn: 'সব পুকুর গো-লাইভের জন্য প্রস্তুত' },
  goLiveCutoverBadge: { en: 'Cutover {date}', bn: 'কাটওভার {date}' },
  goLiveAllCompleteMessage: {
    en: 'Prior P&L, A/R, biomass, and inventory openings are complete for every pond.',
    bn: 'প্রতিটি পুকুরের পূর্ববর্তী P&L, A/R, বায়োমাস ও inventory opening সম্পূর্ণ।',
  },
  goLiveNeedsWorkOne: {
    en: '1 pond still needs opening balances or biological snapshot before day-to-day use.',
    bn: '১ পুকুরের opening balance বা biological snapshot দরকার দৈনন্দিন ব্যবহারের আগে।',
  },
  goLiveNeedsWorkMany: {
    en: '{count} ponds still need opening balances or biological snapshot before day-to-day use.',
    bn: '{count} পুকুরের opening balance বা biological snapshot দরকার দৈনন্দিন ব্যবহারের আগে।',
  },
  goLiveFleetMessage: {
    en: 'Enter each track as of the cutover date. After go-live, use Sales, Expenses, Feeding, Stock, and Landlords for day-to-day activity.',
    bn: 'কাটওভার তারিখে প্রতিটি ট্র্যাক এন্ট্রি করুন। গো-লাইভের পর দৈনন্দিন কাজের জন্য Sales, Expenses, Feeding, Stock ও Landlords ব্যবহার করুন।',
  },
  goLivePondsReadySuffix: { en: ' ponds ready', bn: ' পুকুর প্রস্তুত' },
  goLiveFleetReadinessAria: { en: 'Fleet go-live readiness', bn: 'ফ্লিট গো-লাইভ প্রস্তুতি' },
  goLiveReview: { en: 'Review go-live', bn: 'গো-লাইভ পর্যালোচনা' },
  goLiveContinueSetup: { en: 'Continue setup', bn: 'সেটআপ চালিয়ে যান' },
  goLiveReadyBadge: { en: 'Go-live ready', bn: 'গো-লাইভ প্রস্তুত' },
  goLivePercentBadge: { en: 'Go-live {percent}%', bn: 'গো-লাইভ {percent}%' },
  goLiveCutoverDateLabel: { en: 'Cutover date:', bn: 'কাটওভার তারিখ:' },
  goLiveOverviewMessage: {
    en: 'Record the state of each pond as of this date. After cutover, day-to-day work uses Sales, Expenses, Feeding, Stock, and Landlords.',
    bn: 'এই তারিখে প্রতিটি পুকুরের অবস্থা রেকর্ড করুন। কাটওভারের পর দৈনন্দিন কাজে Sales, Expenses, Feeding, Stock ও Landlords ব্যবহার করুন।',
  },
  goLivePondsReadyLabel: { en: 'Ponds ready', bn: 'পুকুর প্রস্তুত' },
  goLiveFleetReadinessLabel: { en: 'Fleet readiness', bn: 'ফ্লিট প্রস্তুতি' },

  aquacultureReportOpening: { en: 'Opening report in Reports…', bn: 'Reports-এ রিপোর্ট খুলছে…' },
  openPlReport: { en: 'Open P&L report', bn: 'P&L রিপোর্ট খুলুন' },
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

export function nursingWorkflowSteps(lang: AdviceLanguage): string[] {
  return [
    aquacultureT('nursingStep1', lang),
    aquacultureT('nursingStep2', lang),
    aquacultureT('nursingStep3', lang),
    aquacultureT('nursingStep4', lang),
  ]
}

export function stockingBatchWorkflow(lang: AdviceLanguage) {
  return {
    title: aquacultureT('cyclesWorkflowTitle', lang),
    steps: [
      {
        phase: aquacultureT('cyclesWorkflowTilapiaPhase', lang),
        detail: aquacultureT('cyclesWorkflowTilapiaDetail', lang),
      },
      {
        phase: aquacultureT('cyclesWorkflowOtherPhase', lang),
        detail: aquacultureT('cyclesWorkflowOtherDetail', lang),
      },
      {
        phase: aquacultureT('cyclesWorkflowNursingPhase', lang),
        detail: aquacultureT('cyclesWorkflowNursingDetail', lang),
      },
      {
        phase: aquacultureT('cyclesWorkflowGrowOutPhase', lang),
        detail: aquacultureT('cyclesWorkflowGrowOutDetail', lang),
      },
    ],
  }
}
