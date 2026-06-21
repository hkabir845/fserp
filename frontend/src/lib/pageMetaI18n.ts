/**
 * Localized page titles and descriptions keyed by route (en / bn).
 * Used by module pages for consistent language with company settings.
 */
import { navLabel } from '@/lib/erpNavI18n'
import { pick, type AppLanguage } from '@/lib/i18n'

type Row = { en: string; bn: string }

type PageMetaRow = {
  title: Row
  description?: Row
  descriptionNote?: Row
  eyebrow?: Row
}

const P: Record<string, PageMetaRow> = {
  '/apps': {
    title: { en: 'Apps', bn: 'অ্যাপস' },
    eyebrow: { en: 'FSERP launcher', bn: 'FSERP লঞ্চার' },
    description: {
      en: 'Open modules and tools — same access as the sidebar menu.',
      bn: 'মডিউল ও টুল খুলুন — সাইডবার মেনুর মতো একই অ্যাক্সেস।',
    },
  },
  '/dashboard': {
    title: { en: 'Dashboard', bn: 'ড্যাশবোর্ড' },
    eyebrow: { en: 'Your workspace', bn: 'আপনার ওয়ার্কস্পেস' },
    description: {
      en: 'Overview of your business for the current period.',
      bn: 'বর্তমান সময়সীমার ব্যবসার সংক্ষিপ্ত বিবরণ।',
    },
  },
  '/inventory': {
    eyebrow: { en: 'Inventory operations', bn: 'ইনভেন্টরি অপারেশন' },
    title: { en: 'Inventory & transfers', bn: 'ইনভেন্টরি ও স্থানান্তর' },
    description: {
      en: 'Move shop stock between sites, send feed and supplies into pond warehouses, and check quantities by location.',
      bn: 'সাইটের মধ্যে দোকান স্টক স্থানান্তর, পুকুর গুদামে খাদ্য ও সরঞ্জাম পাঠানো, এবং স্থানভিত্তিক পরিমাণ দেখুন।',
    },
  },
  '/items': {
    title: { en: 'Products & services', bn: 'পণ্য ও সেবা' },
    description: {
      en: 'Product catalog, SKUs, rates, and fish fry line (pcs/kg) settings.',
      bn: 'পণ্য ক্যাটালগ, SKU, রেট ও মাছের লাইন (pcs/kg) সেটিংস।',
    },
  },
  '/bills': {
    title: { en: 'Bills', bn: 'বিল' },
    description: { en: 'Vendor bills and purchases.', bn: 'ভেন্ডর বিল ও ক্রয়।' },
  },
  '/invoices': {
    title: { en: 'Invoices', bn: 'ইনভয়েস' },
    description: { en: 'Customer invoices and sales documents.', bn: 'গ্রাহক ইনভয়েস ও বিক্রি নথি।' },
  },
  '/customers': {
    title: { en: 'Customers', bn: 'গ্রাহক' },
    description: { en: 'Customer master data and balances.', bn: 'গ্রাহকের মূল তথ্য ও ব্যালেন্স।' },
  },
  '/vendors': {
    title: { en: 'Vendors', bn: 'ভেন্ডর' },
    description: { en: 'Vendor master data and balances.', bn: 'ভেন্ডরের মূল তথ্য ও ব্যালেন্স।' },
  },
  '/payments': {
    title: { en: 'Payments', bn: 'পেমেন্ট' },
    description: { en: 'Payments made and received.', bn: 'প্রদত্ত ও প্রাপ্ত পেমেন্ট।' },
  },
  '/employees': {
    title: { en: 'Employees', bn: 'কর্মচারী' },
    description: { en: 'Staff records and employment details.', bn: 'কর্মীর তথ্য ও নিয়োগ বিবরণ।' },
  },
  '/payroll': {
    title: { en: 'Payroll', bn: 'পে-রোল' },
    description: { en: 'Pay runs, salaries, and deductions.', bn: 'পে-রান, বেতন ও কাটতি।' },
  },
  '/company': {
    title: { en: 'Company profile', bn: 'কোম্পানি প্রোফাইল' },
    description: { en: 'Company profile, locale, and module settings.', bn: 'কোম্পানি প্রোফাইল, ভাষা ও মডিউল সেটিংস।' },
  },
  '/payments/all': {
    title: { en: 'Payment register', bn: 'পেমেন্ট রেজিস্টার' },
    description: {
      en: 'Combined cash receipts and disbursements register.',
      bn: 'একত্রিত নগদ প্রাপ্তি ও প্রদান রেজিস্টার।',
    },
  },
  '/reports': {
    title: { en: 'Reports', bn: 'রিপোর্ট' },
    eyebrow: { en: 'Business intelligence', bn: 'ব্যবসা বিশ্লেষণ' },
    description: { en: 'Financial and operational reports.', bn: 'আর্থিক ও অপারেশন রিপোর্ট।' },
  },
  '/cashier': {
    title: { en: 'POS / Cashier', bn: 'POS / ক্যাশিয়ার' },
    eyebrow: { en: 'Point of sale', bn: 'পয়েন্ট অফ সেল' },
    description: { en: 'Point of sale and retail checkout.', bn: 'পয়েন্ট অফ সেল ও রিটেইল বিক্রি।' },
  },
  '/chart-of-accounts': {
    title: { en: 'Chart of Accounts', bn: 'অ্যাকাউন্ট চার্ট' },
    description: {
      en: 'All account types in one list (QuickBooks-style). Add bank and cash accounts here with institution and account number — they drive deposits, payments, and fund transfers.',
      bn: 'এক তালিকায় সব অ্যাকাউন্ট ধরন (QuickBooks-স্টাইল)। ব্যাংক ও নগদ অ্যাকাউন্ট এখানে যোগ করুন — জমা, পেমেন্ট ও ফান্ড ট্রান্সফার এখান থেকে চলে।',
    },
    descriptionNote: {
      en: 'Bank lines use type Asset with sub-type Checking or Cash on hand, or type Bank account. Clear the type filter below if you do not see every account.',
      bn: 'ব্যাংক লাইন Asset ধরনে Checking বা Cash on hand সাব-টাইপ, অথবা Bank account ধরনে। সব অ্যাকাউন্ট দেখতে নিচের ধরন ফিল্টার সাফ করুন।',
    },
  },
  '/journal-entries': {
    title: { en: 'Journal Entries', bn: 'জার্নাল এন্ট্রি' },
    description: { en: 'Manual accounting entries.', bn: 'ম্যানুয়াল অ্যাকাউন্টিং এন্ট্রি।' },
  },
  '/fund-transfers': {
    title: { en: 'Fund Transfer', bn: 'ফান্ড ট্রান্সফার' },
    description: {
      en: 'Move money between bank / cash registers and equity accounts (same idea as QuickBooks: transfers between balance-sheet accounts for contributions, draws, and till/bank moves). Bank lines come from your chart; equity lines are all active Equity type accounts.',
      bn: 'ব্যাংক / নগদ রেজিস্টার ও ইকুইটি অ্যাকাউন্টের মধ্যে অর্থ স্থানান্তর (QuickBooks-এর মতো: অবদান, উত্তোলন ও টিল/ব্যাংক স্থানান্তর)। ব্যাংক লাইন চার্ট থেকে; ইকুইটি লাইন সব সক্রিয় Equity ধরনের অ্যাকাউন্ট।',
    },
  },
  '/loans': {
    title: { en: 'Loans & financing register', bn: 'ঋণ ও অর্থায়ন রেজিস্টার' },
    eyebrow: { en: 'General ledger · Borrowings & advances', bn: 'জেনারেল লেজার · ঋণ ও অগ্রিম' },
    description: {
      en: 'Set up counterparties with optional opening receivable or payable, then add facilities. Use each party\'s Ledger for a single timeline: opening + all loans, disbursements, repayments, and interest.',
      bn: 'ঐচ্ছিক opening receivable বা payable সহ counterparty সেট করুন, তারপর facility যোগ করুন। প্রতিটি party-র Ledger-এ এক সময়রেখা: opening + সব ঋণ, disbursement, repayment ও সুদ।',
    },
  },
  '/fixed-assets': {
    title: { en: 'Fixed Assets & Depreciation', bn: 'স্থায়ী সম্পদ ও অবচয়' },
    description: {
      en: 'Asset register with straight-line depreciation and automatic GL journals.',
      bn: 'সোজা-রৈখিক অবচয় ও স্বয়ংক্রিয় GL জার্নালসহ সম্পদ রেজিস্টার।',
    },
  },
  '/stations': {
    title: { en: 'Stations', bn: 'স্টেশন' },
    description: {
      en: 'Manage operating locations: fuel forecourts, retail shops, and—when Aquaculture is licensed—dedicated farm or hub sites without underground fuel. Each site can be linked to a default pond for stock issues and POS.',
      bn: 'অপারেটিং স্থান পরিচালনা: জ্বালানি ফোরকোর্ট, দোকান, এবং অ্যাকোয়াকালচার লাইসেন্সে ফার্ম/হাব সাইট। প্রতিটি সাইট স্টক ইস্যু ও POS-এর জন্য ডিফল্ট পুকুরে লিংক করা যায়।',
    },
  },
  '/tanks': {
    title: { en: 'Tanks', bn: 'ট্যাঙ্ক' },
    description: {
      en: 'Underground fuel storage and book stock—only for stations marked as fuel forecourts.',
      bn: 'ভূগর্ভস্থ জ্বালানি স্টোরেজ ও বই স্টক—শুধু fuel forecourt হিসেবে চিহ্নিত স্টেশনের জন্য।',
    },
  },
  '/islands': {
    title: { en: 'Islands', bn: 'আইল্যান্ড' },
    description: {
      en: 'Pump islands belong only on fuel forecourt stations. Configure site type under Stations.',
      bn: 'পাম্প আইল্যান্ড শুধু fuel forecourt স্টেশনে। Stations-এ সাইট ধরন সেট করুন।',
    },
  },
  '/dispensers': {
    title: { en: 'Dispensers', bn: 'ডিসপেন্সার' },
    description: {
      en: 'Dispensers attach only to islands on fuel forecourt stations.',
      bn: 'ডিসপেন্সার শুধু fuel forecourt স্টেশনের আইল্যান্ডে সংযুক্ত হয়।',
    },
  },
  '/meters': {
    title: { en: 'Meters', bn: 'মিটার' },
    description: {
      en: 'Meters attach to dispensers on fuel forecourt islands only.',
      bn: 'মিটার শুধু fuel forecourt আইল্যান্ডের ডিসপেন্সারে সংযুক্ত হয়।',
    },
  },
  '/nozzles': {
    title: { en: 'Nozzle Configuration', bn: 'নজল কনফিগারেশন' },
    description: {
      en: 'Configure nozzles by selecting station, island, dispenser, meter, and tank.',
      bn: 'স্টেশন, আইল্যান্ড, ডিসপেন্সার, মিটার ও ট্যাঙ্ক নির্বাচন করে নজল সেট করুন।',
    },
  },
  '/tank-dips': {
    title: { en: 'Tank Dip Readings', bn: 'ট্যাঙ্ক ডিপ রিডিং' },
    description: {
      en: 'Stock reconciliation and gain/loss tracking from stick readings.',
      bn: 'স্টিক রিডিং থেকে স্টক মিল ও লাভ/ক্ষতি ট্র্যাকিং।',
    },
  },
  '/shift-management': {
    title: { en: 'Shift Management', bn: 'শিফট ব্যবস্থাপনা' },
    description: {
      en: 'Open and close cashier shifts by template and station.',
      bn: 'টেমপ্লেট ও স্টেশন অনুযায়ী ক্যাশিয়ার শিফট খুলুন ও বন্ধ করুন।',
    },
  },
  '/tax': {
    title: { en: 'Tax management', bn: 'ট্যাক্স ব্যবস্থাপনা' },
    description: {
      en: 'Configure tax names, rates, and effective dates. One deployment — changes apply to this company only.',
      bn: 'ট্যাক্সের নাম, হার ও কার্যকর তারিখ সেট করুন—এক ডিপ্লয়মেন্ট, শুধু এই কোম্পানিতে প্রযোজ্য।',
    },
  },
  '/reporting-categories': {
    title: { en: 'Reporting categories', bn: 'রিপোর্টিং ক্যাটাগরি' },
    description: {
      en: 'Custom income and expense labels that roll up to built-in P&L types.',
      bn: 'বিল্ট-ইন P&L ধরনে rollup হয় এমন কাস্টম আয় ও ব্যয় লেবেল।',
    },
  },
  '/payments/made': {
    title: { en: 'Payments — Made', bn: 'পেমেন্ট — প্রদত্ত' },
    description: {
      en: 'Pay vendor bills and update accounts payable. Edit or delete runs in a single transaction (reverse AUTO-PAY, update books, re-post). Receipts tied to a bank deposit stay locked until the deposit is adjusted.',
      bn: 'ভেন্ডর বিল পরিশোধ ও accounts payable আপডেট। সম্পাদনা/মুছে ফেলা এক ট্রানজ্যাকশনে (AUTO-PAY reverse, বই আপডেট, re-post)। ব্যাংক deposit-এ আটকানো receipt deposit ঠিক না হওয়া পর্যন্ত locked।',
    },
  },
  '/payments/received': {
    title: { en: 'Payments — Received', bn: 'পেমেন্ট — প্রাপ্ত' },
    description: {
      en: 'Record money received from customers and apply it to open invoices. Credit / on-account sales are open invoices until you record a payment.',
      bn: 'গ্রাহক থেকে প্রাপ্ত অর্থ রেকর্ড করুন ও খোলা invoice-এ প্রয়োগ করুন। credit / on-account বিক্রি payment রেকর্ড না হওয়া পর্যন্ত খোলা invoice।',
    },
  },
  '/payments/deposits': {
    title: { en: 'Record deposits', bn: 'জমা রেকর্ড' },
    description: {
      en: 'Move customer receipts from clearing accounts (cash on hand, undeposited funds, or card clearing) into a bank register — the standard AR cash workflow used in professional accounting systems.',
      bn: 'clearing অ্যাকাউন্ট (নগদ, undeposited funds বা card clearing) থেকে গ্রাহক receipt ব্যাংক রেজিস্টারে স্থানান্তর—পেশাদার অ্যাকাউন্টিং-এর মানক AR cash workflow।',
    },
  },
  '/users': {
    title: { en: 'Users', bn: 'ব্যবহারকারী' },
    eyebrow: { en: 'People & access', bn: 'লোক ও অ্যাক্সেস' },
    description: {
      en: 'Invite your team, assign job types, and optional access profiles.',
      bn: 'টিম আমন্ত্রণ, job type ও ঐচ্ছিক access profile বরাদ্দ করুন।',
    },
  },
  '/roles': {
    title: { en: 'Roles & access', bn: 'রোল ও অ্যাক্সেস' },
    description: {
      en: 'Create named roles and allow or block each app in the launcher, plus reports and aquaculture modules. Use section shortcuts (e.g. "All station apps") or tick individual apps. Assign a role on the Users page; unchecked items are hidden in the app launcher and sidebar.',
      bn: 'নামকরা রোল তৈরি করুন এবং লঞ্চারের প্রতিটি অ্যাপ, রিপোর্ট ও অ্যাকোয়াকালচার মডিউল অনুমতি দিন বা ব্লক করুন। সেকশন শর্টকাট (যেমন "সব স্টেশন অ্যাপ") বা পৃথক অ্যাপ টিক দিন। Users পৃষ্ঠায় রোল বরাদ্দ করুন; টিক না থাকা আইটেম লঞ্চার ও সাইডবারে লুকানো থাকে।',
    },
  },
  '/backup': {
    title: { en: 'Backup & Restore', bn: 'ব্যাকআপ ও রিস্টোর' },
    eyebrow: { en: 'Management', bn: 'ম্যানেজমেন্ট' },
    description: {
      en: 'Export or replace the full application data for your company (schema v2): ERP, forecourt, aquaculture, inventory, payroll, loans, and related records.',
      bn: 'আপনার কোম্পানির সম্পূর্ণ অ্যাপ ডেটা (schema v2) এক্সপোর্ট বা প্রতিস্থাপন: ERP, forecourt, aquaculture, inventory, payroll, loans ও সম্পর্কিত রেকর্ড।',
    },
  },
  '/aquaculture': {
    title: { en: 'Operations dashboard', bn: 'অপারেশন ড্যাশবোর্ড' },
    description: {
      en: 'Pond-level profit and loss, biomass, feed, and harvest roll-up for the period.',
      bn: 'সময়সীমার পুকুরভিত্তিক লাভ-ক্ষতি, বায়োমাস, খাদ্য ও ধরার সারাংশ।',
    },
  },
  '/aquaculture/ponds': {
    title: { en: 'Ponds', bn: 'পুকুর' },
    description: {
      en: 'Production units, water area, leasing, and pond roles.',
      bn: 'উৎপাদন ইউনিট, জলের আয়তন, লিজ ও পুকুরের ধরন।',
    },
  },
  '/aquaculture/cycles': {
    title: { en: 'Stocking batches', bn: 'স্টকিং ব্যাচ' },
    description: {
      en: 'Each tilapia fry purchase is a new batch (C01, C02, C03 per season). Other species usually share one open batch per pond that keeps growing — FSERP reuses it on new bills unless you start a 2nd batch on purpose.',
      bn: 'প্রতিটি টিলাপিয়া ফ্রাই ক্রয় নতুন ব্যাচ (সিজনে C01, C02, C03)। অন্যান্য প্রজাতি সাধারণত পুকুরে এক খোলা ব্যাচে চলতে থাকে — নতুন বিলে FSERP এটি পুনরায় ব্যবহার করে যতক্ষণ না ইচ্ছাকৃতভাবে ২য় ব্যাচ শুরু করেন।',
    },
  },
  '/aquaculture/transfers': {
    title: { en: 'Pond transfers', bn: 'পুকুর স্থানান্তর' },
    description: {
      en: 'Move fingerlings between nursing and production ponds.',
      bn: 'নার্সিং ও উৎপাদন পুকুরে ফিঙ্গারলিং স্থানান্তর।',
    },
  },
  '/aquaculture/stock': {
    title: { en: 'Pond stock', bn: 'পুকুর স্টক' },
    description: {
      en: 'See how many fish you have in each pond. Record mortality and corrections under Adjustments.',
      bn: 'প্রতি পুকুরে কত মাছ — দেখুন। মৃত্যু ও সংশোধন Adjustments-এ রেকর্ড করুন।',
    },
  },
  '/aquaculture/stock/options': {
    title: { en: 'Pond stock options', bn: 'পুকুর স্টক অপশন' },
    description: {
      en: 'Configure shared feed and medicine stores used by multiple ponds.',
      bn: 'বহু পুকুরে ব্যবহৃত ভাগ করা খাদ্য ও ঔষধ গুদাম সেট করুন।',
    },
  },
  '/aquaculture/sampling': {
    title: { en: 'Biomass sampling', bn: 'বায়োমাস নমুনা' },
    description: {
      en: 'Record a net sample: catch a batch, weigh them together, count them, and return them to the pond. The app combines your sample mean weight with head count from Fish stock to estimate total pond biomass and growth since the last book mean.',
      bn: 'জালের নমুনা রেকর্ড করুন: মাছ ধরুন, একসাথে ওজন করুন, গুনুন, পুকুরে ফেরত দিন। অ্যাপ নমুনার গড় ওজন Fish stock-এর মাছের সংখ্যার সাথে মিলিয়ে মোট বায়োমাস ও বইয়ের গড় থেকে বৃদ্ধি অনুমান করবে।',
    },
  },
  '/aquaculture/feeding': {
    title: { en: 'Feeding advice', bn: 'খাবার পরামর্শ' },
    description: {
      en: 'WorldFish-based rations from pond biomass. Generate → review → approve → apply to warehouse or expense.',
      bn: 'পুকুর বায়োমাস থেকে WorldFish-ভিত্তিক রেশন। তৈরি → পর্যালোচনা → অনুমোদন → গুদাম বা ব্যয়ে প্রয়োগ।',
    },
    eyebrow: { en: 'AI feeding advisor', bn: 'AI খাদ্য পরামর্শক' },
  },
  '/aquaculture/medicine': {
    title: { en: 'Medicine & treatments', bn: 'ঔষধ ও চিকিৎসা' },
    eyebrow: { en: 'Pond health', bn: 'পুকুর স্বাস্থ্য' },
    description: {
      en: 'Record medicine applied at the pond warehouse. Each entry reduces on-hand stock and posts COGS — same flow as feed consumed.',
      bn: 'পুকুর গুদামে প্রয়োগিত ঔষধ রেকর্ড করুন। প্রতিটি এন্ট্রি হাতে স্টক কমায় ও COGS পোস্ট করে — খাদ্য ব্যবহারের মতোই।',
    },
  },
  '/aquaculture/sales': {
    title: { en: 'Pond & fish sales', bn: 'পুকুর ও মাছ বিক্রি' },
    description: {
      en: 'Record one buyer visit with multiple lines — different species or cycles. Pond-side income (empty sacks, scrap). Use Cashier for packaged retail; this screen is for fish leaving ponds (kg, head) and aquaculture revenue. Use income type per line; use Record to books for invoice and GL (revenue 4240–4244, cash or A/R).',
      bn: 'এক গ্রাহক ভিজিটে বহু লাইন — বিভিন্ন প্রজাতি বা ব্যাচ। পুকুর-পার্শ্ব আয় (খালি ব্যাগ, স্ক্র্যাপ)। প্যাকেজড রিটেইলের জন্য Cashier; এই পৃষ্ঠা পুকুর থেকে মাছ (kg, টি) ও অ্যাকোয়াকালচার আয়ের জন্য। লাইনে income type; ইনভয়েস ও GL-এর জন্য Record to books (আয় 4240–4244, নগদ বা A/R)।',
    },
  },
  '/aquaculture/expenses': {
    title: { en: 'Pond costs & expenses', bn: 'পুকুর খরচ ও ব্যয়' },
    eyebrow: { en: 'Record on vendor bills (posted to GL)', bn: 'ভেন্ডর বিলে রেকর্ড (GL-এ পোস্ট)' },
    description: {
      en: 'Shop feed/medicine: ring out on Cashier on account to the pond customer (Ponds)—keeps SKU and GL aligned with Inventory. Fish kg/head: Pond stock and Sales, not here. New costs: Vendor bills (tag pond, expense category, post, pay via Payments). Lease: Landlords. Wages: Payroll with pond splits—do not duplicate here. Feed/medicine inventory: use Bills, POS, or internal stock issue—not Add expense. Direct cost = one pond; shared = split across ponds. Day labor on bills. Miscellaneous: memo.',
      bn: 'দোকান খাদ্য/ঔষধ: Cashier-এ পুকুর গ্রাহকের অ্যাকাউন্টে রিং আউট (Ponds)—SKU ও GL Inventory-এর সাথে মিলে। পুকুরে kg/টি: Pond stock ও Sales, এখানে নয়। নতুন খরচ: Vendor bills (পুকুর ট্যাগ, ব্যয় ক্যাটাগরি, পোস্ট, Payments-এ পেমেন্ট)। লিজ: Landlords। বেতন: Payroll-এ পুকুর বিভাজন—এখানে ডুপ্লিকেট নয়। খাদ্য/ঔষধ স্টক: Bills, POS বা internal stock issue—Add expense নয়। সরাসরি খরচ = এক পুকুর; ভাগ করা = বহু পুকুরে বিভাজন। দৈনিক শ্রম: বিলে। বিবিধ: মেমো।',
    },
  },
  '/aquaculture/financing': {
    title: { en: 'Financing & loan repayment', bn: 'অর্থায়ন ও ঋণ পরিশোধ' },
    description: {
      en: 'One working-capital loan for the whole site: tag spend on ponds via bills and expenses, track disbursements, and repay from pond P&L using profit transfers plus loan repayment.',
      bn: 'পুরো সাইটের এক কর্ম-পূঁজি ঋণ: বিল ও ব্যয়ে পুকুরে খরচ ট্যাগ, বিতরণ ট্র্যাক, পুকুর P&L থেকে লাভ স্থানান্তর ও ঋণ পরিশোধ।',
    },
  },
  '/aquaculture/landlords': {
    title: { en: 'Landlords', bn: 'জমির মালিক' },
    description: {
      en: 'Pond-level lease metrics for the selected period. Use View for the full ledger, Edit for profile and pond shares, and Pay to record a payment without leaving the list.',
      bn: 'নির্বাচিত সময়সীমার পুকুরভিত্তিক লিজ মেট্রিক। পূর্ণ লেজারের জন্য View, প্রোফাইল ও পুকুর শেয়ারের জন্য Edit, তালিকায় থেকে পেমেন্টের জন্য Pay।',
    },
  },
  '/aquaculture/data-bank': {
    title: { en: 'Data Bank', bn: 'ডেটা ব্যাংক' },
    description: {
      en: 'Archive operational seasons while keeping pond structure.',
      bn: 'পুকুর কাঠামো রেখে অপারেশন সিজন আর্কাইভ করুন।',
    },
  },
  '/aquaculture/report': {
    title: { en: 'Aquaculture report', bn: 'অ্যাকোয়াকালচার রিপোর্ট' },
    eyebrow: { en: 'P&L by site & pond', bn: 'সাইট ও পুকুর P&L' },
    description: {
      en: 'Pond-level profit and loss for the selected period — revenue, costs, and net by production unit. Filters, archive closes, and export live in Reports.',
      bn: 'নির্বাচিত সময়সীমার পুকুরভিত্তিক লাভ-ক্ষতি — আয়, খরচ ও নিট লাভ প্রজাতি ইউনিটে। ফিল্টার, আর্কাইভ ক্লোজ ও এক্সপোর্ট Reports-এ।',
    },
  },
  '/subscriptions': {
    title: { en: 'Subscription & Billing', bn: 'সাবস্ক্রিপশন ও বিলিং' },
    eyebrow: { en: 'Platform billing', bn: 'প্ল্যাটফর্ম বিলিং' },
    description: {
      en: 'Manage your subscription plan and billing information.',
      bn: 'আপনার সাবস্ক্রিপশন প্ল্যান ও বিলিং তথ্য পরিচালনা করুন।',
    },
  },
  '/account/password': {
    title: { en: 'Change password', bn: 'পাসওয়ার্ড পরিবর্তন' },
    eyebrow: { en: 'Account security', bn: 'অ্যাকাউন্ট নিরাপত্তা' },
    description: {
      en: 'For your security, enter your current password, then choose a new one.',
      bn: 'নিরাপত্তার জন্য বর্তমান পাসওয়ার্ড দিন, তারপর নতুন পাসওয়ার্ড বেছে নিন।',
    },
  },
  '/payments/made/new': {
    title: { en: 'Record vendor payment', bn: 'ভেন্ডর পেমেন্ট রেকর্ড' },
    eyebrow: { en: 'Payments — Made', bn: 'পেমেন্ট — প্রদত্ত' },
    description: {
      en: 'Pay open bills from a company bank account.',
      bn: 'কোম্পানি ব্যাংক অ্যাকাউন্ট থেকে খোলা বিল পরিশোধ করুন।',
    },
  },
  '/payments/received/new': {
    title: { en: 'Record payment received', bn: 'প্রাপ্ত পেমেন্ট রেকর্ড' },
    eyebrow: { en: 'Payments — Received', bn: 'পেমেন্ট — প্রাপ্ত' },
    description: {
      en: 'Apply cash or transfer to open invoices, on-account A/R, or record a customer advance.',
      bn: 'খোলা ইনভয়েস, on-account A/R-এ নগদ/ট্রান্সফার প্রয়োগ করুন, অথবা গ্রাহক অগ্রিম রেকর্ড করুন।',
    },
  },
  '/admin/overview': {
    title: { en: 'Platform Overview', bn: 'প্ল্যাটফর্ম ওভারভিউ' },
    eyebrow: { en: 'SaaS platform', bn: 'SaaS প্ল্যাটফর্ম' },
    description: {
      en: 'Cross-tenant statistics and platform health.',
      bn: 'ক্রস-টেন্যান্ট পরিসংখ্যান ও প্ল্যাটফর্ম স্বাস্থ্য।',
    },
  },
}

const PATTERNS: Array<{ pattern: RegExp; meta: PageMetaRow }> = [
  {
    pattern: /^\/aquaculture\/ponds\/\d+$/,
    meta: {
      title: { en: 'Pond detail', bn: 'পুকুর বিবরণ' },
      description: {
        en: 'Production history, stock position, costs, and operational notes for this pond.',
        bn: 'এই পুকুরের উৎপাদন ইতিহাস, স্টক অবস্থান, খরচ ও অপারেশন নোট।',
      },
    },
  },
  {
    pattern: /^\/aquaculture\/landlords\/\d+$/,
    meta: {
      title: { en: 'Landlord detail', bn: 'জমির মালিক বিবরণ' },
      description: {
        en: 'Lease terms, pond allocations, payment history, and outstanding balance.',
        bn: 'লিজ শর্ত, পুকুর বরাদ্দ, পেমেন্ট ইতিহাস ও বকেয়া ব্যালেন্স।',
      },
    },
  },
]

export type LocalizedPageMeta = {
  title: string
  description?: string
  descriptionNote?: string
  eyebrow?: string
}

function localizeRow(row: Row, lang: AppLanguage): string {
  return pick(lang, row.en, row.bn)
}

function localizeMeta(meta: PageMetaRow, lang: AppLanguage): LocalizedPageMeta {
  return {
    title: localizeRow(meta.title, lang),
    description: meta.description ? localizeRow(meta.description, lang) : undefined,
    descriptionNote: meta.descriptionNote ? localizeRow(meta.descriptionNote, lang) : undefined,
    eyebrow: meta.eyebrow ? localizeRow(meta.eyebrow, lang) : undefined,
  }
}

export function pageMetaForPath(pathname: string, lang: AppLanguage): LocalizedPageMeta {
  const path = (pathname || '/').split('?')[0].replace(/\/$/, '') || '/'

  if (P[path]) return localizeMeta(P[path], lang)

  for (const { pattern, meta } of PATTERNS) {
    if (pattern.test(path)) return localizeMeta(meta, lang)
  }

  // Parent path (e.g. /aquaculture/stock/adjustments → /aquaculture/stock)
  const parts = path.split('/').filter(Boolean)
  while (parts.length > 1) {
    parts.pop()
    const parent = '/' + parts.join('/')
    if (P[parent]) return localizeMeta(P[parent], lang)
  }

  const navTitle = navLabel(path, lang)
  if (navTitle !== path) {
    return { title: navTitle }
  }

  return { title: path }
}
