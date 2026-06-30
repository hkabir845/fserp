/**
 * Localized titles/descriptions for report cards (company language en | bn).
 */
import type { AppLanguage } from '@/lib/i18n'

type Loc = { title: { en: string; bn: string }; description: { en: string; bn: string } }

export const REPORT_CATALOG_LABELS: Record<string, Loc> = {
  // Financial
  'trial-balance': {
    title: { en: 'Trial Balance', bn: 'ট্রায়াল ব্যালেন্স' },
    description: {
      en: 'Posted debits and credits by account — optional site filter for multi-station GL',
      bn: 'অ্যাকাউন্ট অনুযায়ী পোস্ট করা ডেবিট ও ক্রেডিট — বহু স্টেশন GL-এর জন্য ঐচ্ছিক সাইট ফিল্টার',
    },
  },
  'balance-sheet': {
    title: { en: 'Balance Sheet', bn: 'ব্যালেন্স শীট' },
    description: {
      en: 'Assets, liabilities, and equity as of period end — optional site filter',
      bn: 'সময়সীমার শেষে সম্পদ, দায় ও ইকুইটি — ঐচ্ছিক সাইট ফিল্টার',
    },
  },
  'income-statement': {
    title: { en: 'Profit & Loss (P&L)', bn: 'লাভ ও ক্ষতি (P&L)' },
    description: {
      en: 'Income (including sales), COGS (cost on sales), and expenses from posted GL — Site scope: one station/pond or All for company-wide',
      bn: 'পোস্ট করা GL থেকে আয় (বিক্রি সহ), COGS (বিক্রির খরচ) ও ব্যয় — সাইট: একটি স্টেশন/পুকুর অথবা কোম্পানি-ব্যাপী সব',
    },
  },
  'customer-balances': {
    title: { en: 'Customer Balances', bn: 'গ্রাহক ব্যালেন্স' },
    description: {
      en: 'Current A/R balance per customer (subledger snapshot)',
      bn: 'প্রতি গ্রাহকের বর্তমান A/R ব্যালেন্স (সাবলেজার স্ন্যাপশট)',
    },
  },
  'ar-aging': {
    title: { en: 'Accounts Receivable Aging', bn: 'প্রাপ্য হিসাব এজিং' },
    description: {
      en: 'Open invoices by customer in aging buckets — filter by station or pond (pond POS customer)',
      bn: 'গ্রাহক অনুযায়ী খোলা ইনভয়েস এজিং বাকেটে — স্টেশন বা পুকুর (পুকুর POS গ্রাহক) ফিল্টার',
    },
  },
  'vendor-balances': {
    title: { en: 'Vendor Balances', bn: 'ভেন্ডর ব্যালেন্স' },
    description: {
      en: 'Current A/P balance per vendor (subledger snapshot)',
      bn: 'প্রতি ভেন্ডরের বর্তমান A/P ব্যালেন্স (সাবলেজার স্ন্যাপশট)',
    },
  },
  'ap-aging': {
    title: { en: 'Accounts Payable Aging', bn: 'দেয় হিসাব এজিং' },
    description: {
      en: 'Open vendor bills by vendor in aging buckets — filter by station or pond-tagged bill lines',
      bn: 'ভেন্ডর অনুযায়ী খোলা বিল এজিং বাকেটে — স্টেশন বা পুকুর-ট্যাগ বিল লাইন ফিল্টার',
    },
  },
  'cash-flow': {
    title: { en: 'Cash Flow Summary', bn: 'নগদ প্রবাহ সারাংশ' },
    description: {
      en: 'Company bank accounts plus cash flow by every station, pond, and head office (clear site filter)',
      bn: 'কোম্পানি ব্যাংক অ্যাকাউন্ট ও প্রতি স্টেশন, পুকুর ও হেড অফিসের নগদ প্রবাহ (সাইট ফিল্টার সাফ করুন)',
    },
  },
  'expense-detail': {
    title: { en: 'Expense Detail (GL)', bn: 'ব্যয় বিস্তারিত (GL)' },
    description: {
      en: 'Operating expenses only (excludes COGS — use Profit & Loss for cost of goods sold) — optional site filter',
      bn: 'শুধু পরিচালন ব্যয় (COGS বাদ — বিক্রির খরচের জন্য P&L ব্যবহার করুন) — ঐচ্ছিক সাইট ফিল্টার',
    },
  },
  'income-detail': {
    title: { en: 'Income Detail (GL)', bn: 'আয় বিস্তারিত (GL)' },
    description: {
      en: 'Income accounts only (excludes COGS and operating expenses — use Profit & Loss for the full picture) — optional site filter',
      bn: 'শুধু আয় অ্যাকাউন্ট (COGS ও পরিচালন ব্যয় বাদ — পূর্ণ চিত্রের জন্য P&L) — ঐচ্ছিক সাইট ফিল্টার',
    },
  },
  'entities-pl-summary': {
    title: { en: 'All Entities — P&L', bn: 'সব সত্তা — P&L' },
    description: {
      en: 'Each entity on its own row: fuel stations, shop hubs (no fuel), ponds, and head office — plus segment totals and company total',
      bn: 'প্রতি সত্তা এক সারিতে: ফুয়েল স্টেশন, শপ হাব (ফুয়েল নেই), পুকুর ও হেড অফিস — সেগমেন্ট ও কোম্পানি মোট সহ',
    },
  },
  'entities-balance-sheet-summary': {
    title: { en: 'All Entities — Balance Sheet', bn: 'সব সত্তা — ব্যালেন্স শীট' },
    description: {
      en: 'Assets, liabilities, and equity as of period end for every station, pond, and head office',
      bn: 'প্রতি স্টেশন, পুকুর ও হেড অফিসের সময়সীমার শেষে সম্পদ, দায় ও ইকুইটি',
    },
  },
  'entities-trial-balance-summary': {
    title: { en: 'All Entities — Trial Balance', bn: 'সব সত্তা — ট্রায়াল ব্যালেন্স' },
    description: {
      en: 'Posted debits and credits in the period for every station, pond, and head office',
      bn: 'সময়সীমায় প্রতি স্টেশন, পুকুর ও হেড অফিসের পোস্ট করা ডেবিট ও ক্রেডিট',
    },
  },
  'entities-financial-summary': {
    title: { en: 'All Entities — Financial (combined)', bn: 'সব সত্তা — আর্থিক (সম্মিলিত)' },
    description: {
      en: 'P&L and balance sheet together for every station, pond, and head office (use separate entity reports for detail)',
      bn: 'প্রতি স্টেশন, পুকুর ও হেড অফিসের P&L ও ব্যালেন্স শীট একসাথে (বিস্তারিতর জন্য পৃথক রিপোর্ট)',
    },
  },
  'stations-financial-summary': {
    title: { en: 'All Stations — P&L Summary', bn: 'সব স্টেশন — P&L সারাংশ' },
    description: {
      en: 'Individual P&L per station (fuel and shop hub without fuel as separate groups) plus stations total and company total',
      bn: 'প্রতি স্টেশনের P&L (ফুয়েল ও ফুয়েলবিহীন শপ হাব পৃথক গ্রুপ) — স্টেশন ও কোম্পানি মোট সহ',
    },
  },
  'fuel-stations-pl-summary': {
    title: { en: 'Fuel Stations — P&L Summary', bn: 'ফুয়েল স্টেশন — P&L সারাংশ' },
    description: {
      en: 'Individual P&L per fuel filling station with category and company totals',
      bn: 'প্রতি ফুয়েল ফিলিং স্টেশনের P&L — ক্যাটাগরি ও কোম্পানি মোট সহ',
    },
  },
  'shop-hubs-pl-summary': {
    title: { en: 'Shop Hubs (no fuel) — P&L Summary', bn: 'শপ হাব (ফুয়েল নেই) — P&L সারাংশ' },
    description: {
      en: 'Individual P&L per shop/agro hub (station without fuel) with category and company totals',
      bn: 'প্রতি শপ/এগ্রো হাবের P&L (ফুয়েলবিহীন স্টেশন) — ক্যাটাগরি ও কোম্পানি মোট সহ',
    },
  },
  'ponds-pl-summary': {
    title: { en: 'All Ponds — P&L Summary (GL)', bn: 'সব পুকুর — P&L সারাংশ (GL)' },
    description: {
      en: 'Individual P&L per pond from posted GL plus ponds total and company total — use Site scope for one pond on other reports',
      bn: 'পোস্ট করা GL থেকে প্রতি পুকুরের P&L — পুকুর ও কোম্পানি মোট; অন্য রিপোর্টে এক পুকুরের জন্য সাইট স্কোপ',
    },
  },
  'liabilities-detail': {
    title: { en: 'Liabilities (GL detail)', bn: 'দায় (GL বিস্তারিত)' },
    description: {
      en: 'Every liability account on the chart with balance as of period end — open the GL ledger per line',
      bn: 'চার্টের সব দায় অ্যাকাউন্ট — সময়সীমার শেষে ব্যালেন্স; প্রতি লাইনে GL লেজার খুলুন',
    },
  },
  'loan-receivable-gl': {
    title: { en: 'Loan receivable (GL)', bn: 'ঋণ প্রাপ্য (GL)' },
    description: {
      en: 'Loans receivable principal accounts (asset-side loan GL) with balances and ledger links',
      bn: 'ঋণ প্রাপ্য প্রধান অ্যাকাউন্ট (সম্পদ-পক্ষ ঋণ GL) — ব্যালেন্স ও লেজার লিংক',
    },
  },
  'loan-payable-gl': {
    title: { en: 'Loan payable (GL)', bn: 'ঋণ দেয় (GL)' },
    description: {
      en: 'Loans payable principal accounts (liability-side loan GL) with balances and ledger links',
      bn: 'ঋণ দেয় প্রধান অ্যাকাউন্ট (দায়-পক্ষ ঋণ GL) — ব্যালেন্স ও লেজার লিংক',
    },
  },
  'loans-borrow-and-lent': {
    title: { en: 'Loans — borrowed & lent', bn: 'ঋণ — নেওয়া ও দেওয়া' },
    description: {
      en: 'Loan facilities: outstanding principal, period cash flows, and GL accounts (principal, bank, interest, accrual)',
      bn: 'ঋণ সুবিধা: বকেয়া প্রধান, সময়সীমার নগদ প্রবাহ ও GL অ্যাকাউন্ট (প্রধান, ব্যাংক, সুদ, সঞ্চয়)',
    },
  },

  // Inventory
  'inventory-sku-valuation': {
    title: { en: 'Inventory: Valuation & Velocity', bn: 'ইনভেন্টরি: মূল্যায়ন ও ভেলোসিটি' },
    description: {
      en: 'Per-SKU on-hand, cost and list value, period sales, velocity, and days of cover',
      bn: 'প্রতি SKU হাতে, খরচ ও তালিকা মূল্য, সময়সীমার বিক্রি, ভেলোসিটি ও কভারের দিন',
    },
  },
  'item-master-by-category': {
    title: { en: 'Item catalog by category', bn: 'ক্যাটাগরি অনুযায়ী আইটেম ক্যাটালগ' },
    description: {
      en: 'All products with reporting category, POS class, and stock & value (snapshot)',
      bn: 'সব পণ্য — রিপোর্টিং ক্যাটাগরি, POS ক্লাস ও স্টক ও মূল্য (স্ন্যাপশট)',
    },
  },
  'item-sales-by-category': {
    title: { en: 'Sales by reporting category', bn: 'রিপোর্টিং ক্যাটাগরি অনুযায়ী বিক্রি' },
    description: {
      en: 'Invoiced quantity and revenue in the period, grouped by item category',
      bn: 'সময়সীমায় ইনভয়েস পরিমাণ ও আয় — আইটেম ক্যাটাগরি অনুযায়ী গ্রুপ',
    },
  },
  'item-purchases-by-category': {
    title: { en: 'Purchases by reporting category', bn: 'রিপোর্টিং ক্যাটাগরি অনুযায়ী ক্রয়' },
    description: {
      en: 'Vendor bill quantity and amount in the period, grouped by item category',
      bn: 'সময়সীমায় ভেন্ডর বিল পরিমাণ ও মোট — আইটেম ক্যাটাগরি অনুযায়ী গ্রুপ',
    },
  },
  'item-sales-custom': {
    title: { en: 'Custom item sales (filtered)', bn: 'কাস্টম আইটেম বিক্রি (ফিল্টার)' },
    description: {
      en: 'Sales by SKU for the period; filter by category and one or more products',
      bn: 'সময়সীমার SKU অনুযায়ী বিক্রি — ক্যাটাগরি ও এক বা বেশি পণ্য ফিল্টার',
    },
  },
  'item-purchases-custom': {
    title: { en: 'Custom item purchases (filtered)', bn: 'কাস্টম আইটেম ক্রয় (ফিল্টার)' },
    description: {
      en: 'Purchases by SKU from bills; filter by category and one or more products',
      bn: 'বিল থেকে SKU অনুযায়ী ক্রয় — ক্যাটাগরি ও এক বা বেশি পণ্য ফিল্টার',
    },
  },
  'item-stock-movement': {
    title: { en: 'Stock movement (purchases vs sales)', bn: 'স্টক চলাচল (ক্রয় বনাম বিক্রি)' },
    description: {
      en: 'Compare vendor receipts (bills) and customer sales in the range by product',
      bn: 'পণ্য অনুযায়ী ভেন্ডর রিসিভ (বিল) ও গ্রাহক বিক্রি তুলনা',
    },
  },
  'item-velocity-analysis': {
    title: { en: 'Fast & slow movers (sales)', bn: 'দ্রুত ও ধীর চলমান (বিক্রি)' },
    description: {
      en: 'Per-SKU sales velocity; fast / medium / slow tiers and items with no sales in range',
      bn: 'প্রতি SKU বিক্রি ভেলোসিটি — দ্রুত/মাঝারি/ধীর স্তর ও সময়সীমায় বিক্রি নেই এমন আইটেম',
    },
  },
  'item-purchase-velocity-analysis': {
    title: { en: 'Fast & slow purchases', bn: 'দ্রুত ও ধীর ক্রয়' },
    description: {
      en: 'Per-SKU purchase volume from bills; fast / medium / slow and items not bought in range',
      bn: 'বিল থেকে প্রতি SKU ক্রয় ভলিউম — দ্রুত/মাঝারি/ধীর ও সময়সীমায় ক্রয় নেই এমন আইটেম',
    },
  },

  // Operational
  'daily-summary': {
    title: { en: 'Daily Summary', bn: 'দৈনিক সারাংশ' },
    description: {
      en: 'Fuel forecourt vs aquaculture shop (Premium Agro): sales, shifts, dips, tanks, and POS categories',
      bn: 'ফুয়েল ফোরকোর্ট বনাম অ্যাকোয়াকালচার শপ (Premium Agro): বিক্রি, শিফট, ডিপ, ট্যাংক ও POS ক্যাটাগরি',
    },
  },
  'shift-summary': {
    title: { en: 'Shift Summary', bn: 'শিফট সারাংশ' },
    description: {
      en: 'Cashier performance and cash reconciliation',
      bn: 'ক্যাশিয়ার কর্মক্ষমতা ও নগদ সমন্বয়',
    },
  },
  'sales-by-nozzle': {
    title: { en: 'Sales by Nozzle', bn: 'নজল অনুযায়ী বিক্রি' },
    description: {
      en: 'Nozzle performance and activity',
      bn: 'নজল কর্মক্ষমতা ও কার্যকলাপ',
    },
  },
  'sales-by-station': {
    title: { en: 'Sales by station', bn: 'স্টেশন অনুযায়ী বিক্রি' },
    description: {
      en: 'Invoice totals by selling location (POS / invoice station)',
      bn: 'বিক্রয় স্থান অনুযায়ী ইনভয়েস মোট (POS / ইনভয়েস স্টেশন)',
    },
  },
  'sales-by-products': {
    title: { en: 'Sales by Products', bn: 'পণ্য অনুযায়ী বিক্রি' },
    description: {
      en: 'Product sales with quantity, price, cost, and profit — cash vs credit',
      bn: 'পরিমাণ, মূল্য, খরচ ও লাভ সহ পণ্য বিক্রি — নগদ বনাম ক্রেডিট',
    },
  },
  'sales-report': {
    title: { en: 'Sales Report', bn: 'বিক্রি রিপোর্ট' },
    description: {
      en: 'Sales by customer (cash vs credit). Filter by shop site — e.g. Premium Agro — for aquaculture POS and retail',
      bn: 'গ্রাহক অনুযায়ী বিক্রি (নগদ বনাম ক্রেডিট) — অ্যাকোয়াকালচার POS ও রিটেলের জন্য শপ সাইট ফিল্টার (যেমন Premium Agro)',
    },
  },
  'purchase-report': {
    title: { en: 'Purchase Report', bn: 'ক্রয় রিপোর্ট' },
    description: {
      en: 'Purchases by vendor (cash vs credit). Filter by shop receipt site — e.g. Premium Agro feed & supplies',
      bn: 'ভেন্ডর অনুযায়ী ক্রয় (নগদ বনাম ক্রেডিট) — শপ রিসিভ সাইট ফিল্টার (যেমন Premium Agro ফিড ও সরঞ্জাম)',
    },
  },
  'fuel-sales': {
    title: { en: 'Fuel Sales Analytics', bn: 'ফুয়েল বিক্রি বিশ্লেষণ' },
    description: {
      en: 'Sales trends and volume analysis',
      bn: 'বিক্রি প্রবণতা ও ভলিউম বিশ্লেষণ',
    },
  },
  'tank-inventory': {
    title: { en: 'Tank Inventory', bn: 'ট্যাংক ইনভেন্টরি' },
    description: {
      en: 'Current stock levels by tank',
      bn: 'ট্যাংক অনুযায়ী বর্তমান স্টক স্তর',
    },
  },
  'tank-dip-register': {
    title: { en: 'Tank Dip Register', bn: 'ট্যাংক ডিপ রেজিস্টার' },
    description: {
      en: 'Chronological stick readings vs book (audit trail)',
      bn: 'কালানুক্রমিক স্টিক রিডিং বনাম বই (অডিট ট্রেইল)',
    },
  },

  // Analytical
  'analytics-kpi': {
    title: { en: 'Analytics & KPIs', bn: 'বিশ্লেষণ ও KPI' },
    description: {
      en: 'Charts for company, every station, and every pond — sales, COGS, expenses, net income, and aquaculture register totals (clear site filter for entity breakdowns).',
      bn: 'কোম্পানি, প্রতি স্টেশন ও পুকুরের চার্ট — বিক্রি, COGS, ব্যয়, নিট আয় ও অ্যাকোয়াকালচার রেজিস্টার মোট (সত্তা বিভাজনের জন্য সাইট ফিল্টার সাফ করুন)।',
    },
  },
  'tank-dip-variance': {
    title: { en: 'Tank Dip Variance', bn: 'ট্যাংক ডিপ ভ্যারিয়েন্স' },
    description: {
      en: 'Gain/Loss analysis from dip readings',
      bn: 'ডিপ রিডিং থেকে লাভ/ক্ষতি বিশ্লেষণ',
    },
  },
  'meter-readings': {
    title: { en: 'Meter Readings', bn: 'মিটার রিডিং' },
    description: {
      en: 'Meter activity and dispensing stats',
      bn: 'মিটার কার্যকলাপ ও ডিসপেন্সিং পরিসংখ্যান',
    },
  },

  // Aquaculture
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
  'aquaculture-fish-growth': {
    title: {
      en: 'Aquaculture — Fish growth & sample intervals',
      bn: 'অ্যাকোয়াকালচার — মাছের বৃদ্ধি ও নমুনা অন্তর',
    },
    description: {
      en: 'Sample-to-sample growth intervals with ADG, interval FCR, period summary, and pond density (kg per decimal)',
      bn: 'নমুনা থেকে নমুনা বৃদ্ধি অন্তর — ADG, অন্তর FCR, সময়সীমা সারাংশ ও পুকুর ডেনসিটি (kg প্রতি ডেসিমেল)',
    },
  },
  'aquaculture-fcr-biomass': {
    title: {
      en: 'Aquaculture — FCR, feed & pond load',
      bn: 'অ্যাকোয়াকালচার — FCR, ফিড ও পুকুর লোড',
    },
    description: {
      en: 'Feed conversion ratio from recorded feed and sampling biomass; kg per decimal and partial harvest hints',
      bn: 'রেকর্ড ফিড ও নমুনা বায়োমাস থেকে ফিড কনভার্সন রেশ — kg প্রতি ডেসিমেল ও আংশিক ধরার ইঙ্গিত',
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
      bn: 'মৃত্যু ও ম্যানুয়াল সংখ্যা/ওজন সমন্বয়ের স্টক লেজার এন্ট্রি, পুকুরভিত্তিক GL রেফারেন্স সহ',
    },
  },
  'aquaculture-pl-management': {
    title: {
      en: 'Aquaculture — P&L: site & ponds',
      bn: 'অ্যাকোয়াকালচার — P&L: সাইট ও পুকুর',
    },
    description: {
      en: 'Management P&L by pond (revenue, costs, profit transfers) plus optional fuel-site posted GL income statement',
      bn: 'পুকুরভিত্তিক ব্যবস্থাপনা P&L (আয়, খরচ, লাভ স্থানান্তর) — ঐচ্ছিক ফুয়েল-সাইট পোস্ট করা GL আয় বিবৃতি',
    },
  },
  'aquaculture-fish-sales': {
    title: {
      en: 'Aquaculture — Pond sales register',
      bn: 'অ্যাকোয়াকালচার — পুকুর বিক্রি রেজিস্টার',
    },
    description: {
      en: 'Fish harvest plus sacks, scrap, and other pond income lines by pond with sub-totals (BDT)',
      bn: 'পুকুরভিত্তিক মাছ ধরা, বস্তা, স্ক্র্যাপ ও অন্যান্য পুকুর আয় — উপমোট সহ (BDT)',
    },
  },
  'aquaculture-pond-sales-comprehensive': {
    title: {
      en: 'Aquaculture — All pond revenue (fish + pond POS)',
      bn: 'অ্যাকোয়াকালচার — সব পুকুর আয় (মাছ + পুকুর POS)',
    },
    description: {
      en: 'Registered pond income (all types) plus General POS / invoice lines to each pond POS customer; motor-fuel lines excluded',
      bn: 'নিবন্ধিত পুকুর আয় (সব ধরন) ও প্রতি পুকুর POS গ্রাহকের General POS / ইনভয়েস লাইন — মোটর ফুয়েল লাইন বাদ',
    },
  },
  'aquaculture-pond-pl': {
    title: {
      en: 'Aquaculture — Pond P&L',
      bn: 'অ্যাকোয়াকালচার — পুকুর P&L',
    },
    description: {
      en: 'One row per pond (leave pond filter empty) or drill into a single pond — revenue, costs, and profit',
      bn: 'প্রতি পুকুর এক সারি (পুকুর ফিল্টার খালি) অথবা এক পুকুরে বিস্তারিত — আয়, খরচ ও লাভ',
    },
  },
  'aquaculture-expenses': {
    title: {
      en: 'Aquaculture — Expense register',
      bn: 'অ্যাকোয়াকালচার — ব্যয় রেজিস্টার',
    },
    description: {
      en: 'Operating expenses by pond and shared allocations with sub-totals (BDT)',
      bn: 'পুকুর ও ভাগ করা বরাদ্দ অনুযায়ী পরিচালন ব্যয় — উপমোট সহ (BDT)',
    },
  },
  'aquaculture-production-cycles': {
    title: {
      en: 'Aquaculture — Production cycles',
      bn: 'অ্যাকোয়াকালচার — উৎপাদন চক্র',
    },
    description: {
      en: 'Production batches overlapping the period, grouped by pond with sub-totals',
      bn: 'সময়সীমায় overlapping উৎপাদন ব্যাচ — পুকুরভিত্তিক গ্রুপ ও উপমোট',
    },
  },
  'aquaculture-profit-transfers': {
    title: {
      en: 'Aquaculture — Pond profit transfers',
      bn: 'অ্যাকোয়াকালচার — পুকুর লাভ স্থানান্তর',
    },
    description: {
      en: 'GL transfers by pond with sub-totals and period total (BDT)',
      bn: 'পুকুরভিত্তিক GL স্থানান্তর — উপমোট ও সময়সীমা মোট (BDT)',
    },
  },
  'aquaculture-fish-transfers': {
    title: {
      en: 'Aquaculture — Inter-pond fish transfers',
      bn: 'অ্যাকোয়াকালচার — পুকুরের মধ্যে মাছ স্থানান্তর',
    },
    description: {
      en: 'Fish moves between ponds with weight, head count, and cost allocation (BDT)',
      bn: 'পুকুরের মধ্যে মাছ স্থানান্তর — ওজন, মাথা সংখ্যা ও খরচ বরাদ্দ (BDT)',
    },
  },
  'aquaculture-fingerling-transfers': {
    title: {
      en: 'Aquaculture — Fingerling transfers (nursing → grow-out)',
      bn: 'অ্যাকোয়াকালচার — ফিঙ্গারলিং স্থানান্তর (নার্সিং → গ্রো-আউট)',
    },
    description: {
      en: 'Nursing pond fingerling moves with purchase vs other costs and receiving pond liability reconciliation (BDT)',
      bn: 'নার্সিং পুকুর থেকে ফিঙ্গারলিং — ক্রয় ও অন্যান্য খরচ, গ্রহণকারী পুকুরের দায় ও মিল (BDT)',
    },
  },
  'aquaculture-pond-total-inventory': {
    title: {
      en: 'Aquaculture — Pond total inventory & value',
      bn: 'অ্যাকোয়াকালচার — পুকুর মোট ইনভেন্টরি ও মূল্য',
    },
    description: {
      en: 'Complete per-pond value: warehouse feed, medicine, supplies, live fish, fry SKU, and equipment/assets (BDT)',
      bn: 'প্রতি পুকুরের পূর্ণ মূল্য: গুদাম ফিড, ঔষধ, সরঞ্জাম, জীবিত মাছ, ফ্রাই SKU ও যন্ত্রপাতি/সম্পদ (BDT)',
    },
  },
  'aquaculture-pond-feed-stock': {
    title: {
      en: 'Aquaculture — Pond feed stock',
      bn: 'অ্যাকোয়াকালচার — পুকুর ফিড স্টক',
    },
    description: {
      en: 'On-hand feed in each pond warehouse with quantity and inventory value (snapshot)',
      bn: 'প্রতি পুকুর গুদামে হাতে ফিড — পরিমাণ ও ইনভেন্টরি মূল্য (স্ন্যাপশট)',
    },
  },
  'aquaculture-pond-medicine-stock': {
    title: {
      en: 'Aquaculture — Pond medicine stock',
      bn: 'অ্যাকোয়াকালচার — পুকুর ঔষধ স্টক',
    },
    description: {
      en: 'On-hand medicine and pond-care products at ponds with quantities and value',
      bn: 'পুকুরে হাতে ঔষধ ও পুকুর-পরিচর্যা পণ্য — পরিমাণ ও মূল্য',
    },
  },
  'aquaculture-pond-supplies-stock': {
    title: {
      en: 'Aquaculture — Pond supplies stock',
      bn: 'অ্যাকোয়াকালচার — পুকুর সরঞ্জাম স্টক',
    },
    description: {
      en: 'Other inventoried materials at pond warehouses (nets, tools, general supplies)',
      bn: 'পুকুর গুদামে অন্যান্য ইনভেন্টরি সামগ্রী (জাল, সরঞ্জাম, সাধারণ সরঞ্জাম)',
    },
  },
  'aquaculture-pond-performance': {
    title: {
      en: 'Aquaculture — Pond performance dashboard',
      bn: 'অ্যাকোয়াকালচার — পুকুর কর্মক্ষমতা ড্যাশবোর্ড',
    },
    description: {
      en: 'All ponds: FCR, load, ADG, live biomass, and bioasset (GL 1581) with pond and period filters',
      bn: 'সব পুকুর: FCR, লোড, ADG, জীবিত বায়োমাস ও বায়োঅ্যাসেট (GL 1581) — পুকুর ও সময়সীমা ফিল্টার',
    },
  },
  'aquaculture-shop-station-stock': {
    title: {
      en: 'Aquaculture — Shop / station inventory',
      bn: 'অ্যাকোয়াকালচার — শপ / স্টেশন ইনভেন্টরি',
    },
    description: {
      en: 'Feed, medicine, fry SKUs, and supplies on hand at shop stations before transfer to ponds',
      bn: 'পুকুরে স্থানান্তরের আগে শপ স্টেশনে হাতে ফিড, ঔষধ, ফ্রাই SKU ও সরঞ্জাম',
    },
  },
  'aquaculture-equipment-assets': {
    title: {
      en: 'Aquaculture — Equipment & assets',
      bn: 'অ্যাকোয়াকালচার — যন্ত্রপাতি ও সম্পদ',
    },
    description: {
      en: 'Aerators, boats, nets, tools, and similar purchases (equipment, repair, miscellaneous expenses)',
      bn: 'এয়ারেটর, নৌকা, জাল, সরঞ্জাম ও অনুরূপ ক্রয় (যন্ত্রপাতি, মেরামত, বিবিধ ব্যয়)',
    },
  },
}

/** @deprecated Use REPORT_CATALOG_LABELS */
export const AQUACULTURE_REPORT_LABELS = REPORT_CATALOG_LABELS

export function localizeReportCard<T extends { id: string; title: string; description: string }>(
  card: T,
  lang: AppLanguage,
): T {
  const loc = REPORT_CATALOG_LABELS[card.id]
  if (!loc) return card
  return {
    ...card,
    title: loc.title[lang],
    description: loc.description[lang],
  }
}
