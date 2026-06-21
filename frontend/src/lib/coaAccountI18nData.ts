export type CoaAccountI18nRow = {
  name: { en: string; bn: string }
  description: { en: string; bn: string }
}

export const COA_ACCOUNT_I18N: Record<string, CoaAccountI18nRow> = {
  '1010': {
    name: { en: "Cash on Hand — Station Tills", bn: "হাতে নগদ — স্টেশন ক্যাশ টিল" },
    description: { en: "Physical cash in registers and safes.\n\nFSERP / system use: Default cash side for paid POS invoices and similar flows; also used for Payments received when 1020 is not in the chart.", bn: "রেজিস্টার ও সেফে থাকা প্রকৃত নগদ।\n\nFSERP / সিস্টেম ব্যবহার: paid POS invoice ও অনুরূপ flow-এর default নগদ পাশ; Payments received-এ 1020 chart-এ না থাকলে 1010 ব্যবহার।" },
  },
  '1020': {
    name: { en: "Cash Clearing — Undeposited", bn: "নগদ ক্লিয়ারিং — জমা না হওয়া" },
    description: { en: "Cash receipts not yet deposited to bank.\n\nFSERP / system use: Undeposited funds — preferred debit for Payments received when no bank register is selected (both 1010 and 1020 present); batch deposits move from here into the bank GL.", bn: "ব্যাংকে এখনও জমা না হওয়া নগদ গ্রহণ।\n\nFSERP / সিস্টেম ব্যবহার: Undeposited funds — bank register নির্বাচন না হলে Payments received-এ preferred debit (1010 ও 1020 উভয় থাকলে); batch deposit এখান থেকে bank GL-এ স্থানান্তর।" },
  },
  '1030': {
    name: { en: "Bank — Operating Account", bn: "ব্যাংক — অপারেটিং অ্যাকাউন্ট" },
    description: { en: "Primary operating bank account.\n\nFSERP / system use: Operating bank GL; payments received/made and bank-linked transfers when no per-bank GL is set. Owner cash contributions: debit 1030, credit 3000 (Owner Equity / Shareholder Capital) in a journal entry — link your Bank Account register to this chart account so the bank statement shows the same GL activity. Loans module: use as Settlement GL for disbursements/repayments when cash moves through this bank account.", bn: "প্রাথমিক অপারেটিং ব্যাংক অ্যাকাউন্ট।\n\nFSERP / সিস্টেম ব্যবহার: Operating bank GL; per-bank GL না থাকলে payments received/made ও bank-linked transfer। মালিকের নগদ অবদান: journal entry-তে Dr 1030, Cr 3000 — Bank Account register এই chart account-এ link করুন। Loans module: এই ব্যাংক দিয়ে disbursement/repayment হলে Settlement GL।" },
  },
  '1040': {
    name: { en: "Bank — Card Settlement", bn: "ব্যাংক — কার্ড সেটেলমেন্ট" },
    description: { en: "Dedicated account for card acquirer settlements (optional).", bn: "কার্ড acquirer সেটেলমেন্টের জন্য আলাদা অ্যাকাউন্ট (ঐচ্ছিক)।" },
  },
  '1050': {
    name: { en: "Bank — Tax / Trust (Statutory)", bn: "ব্যাংক — কর / ট্রাস্ট (আইনসম্মত)" },
    description: { en: "Segregated statutory or tax trust account if required.", bn: "প্রয়োজন হলে আলাদা আইনসম্মত বা কর ট্রাস্ট অ্যাকাউন্ট।" },
  },
  '1100': {
    name: { en: "Accounts Receivable — Trade", bn: "পাওনা হিসাব — বাণিজ্যিক" },
    description: { en: "Credit sales to walk-in or commercial customers.\n\nFSERP / system use: Trade receivables: credit invoices (sent/partial), customer payments received, and remaining AR on mark-paid.", bn: "হেঁটে আসা বা বাণিজ্যিক গ্রাহকের ক্রেডিট বিক্রয়।\n\nFSERP / সিস্টেম ব্যবহার: Trade receivables: credit invoice (sent/partial), customer payment received, mark-paid-এ remaining AR।" },
  },
  '1110': {
    name: { en: "Accounts Receivable — Fleet / Commercial", bn: "পাওনা হিসাব — ফ্লিট / বাণিজ্যিক" },
    description: { en: "Billed fleet cards and commercial charge accounts.", bn: "ফ্লিট কার্ড ও বাণিজ্যিক চার্জ অ্যাকাউন্ট বিল।" },
  },
  '1120': {
    name: { en: "Card Clearing — Visa / MC / Domestic Debit", bn: "কার্ড ক্লিয়ারিং — ভিসা / MC / ডোমেস্টিক ডেবিট" },
    description: { en: "Unsettled card batches (acquirer clearing).\n\nFSERP / system use: Card / acquirer clearing: debit side for card POS sales when payment_method is card.", bn: "নিষ্পত্তি না হওয়া কার্ড ব্যাচ (acquirer clearing)।\n\nFSERP / সিস্টেম ব্যবহার: Card / acquirer clearing: payment_method card হলে card POS sales-এ debit পাশ।" },
  },
  '1130': {
    name: { en: "Card Clearing — Amex / Other Schemes", bn: "কার্ড ক্লিয়ারিং — Amex / অন্যান্য নেটওয়ার্ক" },
    description: { en: "Secondary card networks with different settlement cycles.", bn: "ভিন্ন সেটেলমেন্ট চক্রের গৌণ কার্ড নেটওয়ার্ক।" },
  },
  '1140': {
    name: { en: "Allowance for Doubtful Accounts", bn: "সন্দেহজনক দেনা সংস্থান" },
    description: { en: "Contra-AR reserve (credit balance; nets against receivables on the balance sheet).", bn: "কনট্রা-AR সংস্থান (ক্রেডিট ব্যালেন্স; ব্যালেন্স শীটে পাওনার বিপরীতে)।" },
  },
  '1150': {
    name: { en: "Employee Advances & Loans", bn: "কর্মচারী অগ্রিম ও ঋণ" },
    description: { en: "Staff advances recoverable via payroll.", bn: "পে-রোলের মাধ্যমে আদায়যোগ্য কর্মচারী অগ্রিম।" },
  },
  '1160': {
    name: { en: "Loans Receivable — Principal (Money Lent)", bn: "ঋণ পাওনা — মূল (ধার দেওয়া)" },
    description: { en: "Balance-sheet principal for funds you lent to others. Use as **Principal GL** on Loans → **Lent**.\n\nFSERP / system use: Loans — principal receivable: Principal GL for money you **lent** (Loans → Lent). Chart type Loan, subtype loan receivable.", bn: "অন্যদের ধার দেওয়া তহবিলের ব্যালেন্স-শীট মূল। Loans → Lent-এ **Principal GL** হিসেবে ব্যবহার করুন।\n\nFSERP / সিস্টেম ব্যবহার: Loans — principal receivable: আপনি **lent** করা টাকার Principal GL (Loans → Lent)। Chart type Loan, subtype loan receivable।" },
  },
  '1200': {
    name: { en: "Inventory — Fuel (Wet Stock at Cost)", bn: "ইনভেন্টরি — জ্বালানি (খরচে ভেজা স্টক)" },
    description: { en: "Tank inventory valued at cost (FIFO/weighted average per policy).\n\nFSERP / system use: Fuel (wet-stock) inventory: credited when COGS posts for fuel lines with item cost.", bn: "খরচে মূল্যায়িত ট্যাংক ইনভেন্টরি (নীতি অনুযায়ী FIFO/weighted average)।\n\nFSERP / সিস্টেম ব্যবহার: Fuel (wet-stock) inventory: item cost সহ fuel line-এ COGS post হলে credit।" },
  },
  '1210': {
    name: { en: "Inventory — Lubricants & Fluids", bn: "ইনভেন্টরি — লুব্রিকেন্ট ও তরল" },
    description: { en: "Oils, DEF, additives on hand.", bn: "হাতে থাকা তেল, DEF, অ্যাডিটিভ।" },
  },
  '1220': {
    name: { en: "Inventory — C-Store / Shop", bn: "ইনভেন্টরি — C-Store / দোকান" },
    description: { en: "Merchandise inventory for convenience retail.\n\nFSERP / system use: Shop / c-store inventory: credited when COGS posts for non-fuel lines with item cost.", bn: "কনভেনিয়েন্স রিটেইলের জন্য পণ্য ইনভেন্টরি।\n\nFSERP / সিস্টেম ব্যবহার: Shop / c-store inventory: item cost সহ non-fuel line-এ COGS post হলে credit।" },
  },
  '1230': {
    name: { en: "Inventory — Other Products", bn: "ইনভেন্টরি — অন্যান্য পণ্য" },
    description: { en: "Car care, accessories, other resale goods.", bn: "গাড়ি যত্ন, আনুষাঙ্গিক ও অন্যান্য পুনঃবিক্রয় পণ্য।" },
  },
  '1300': {
    name: { en: "Prepaid Insurance", bn: "প্রিপেইড বীমা" },
    description: { en: "Unexpired insurance premiums.", bn: "মেয়াদোত্তীর্ণ না হওয়া বীমা প্রিমিয়াম।" },
  },
  '1310': {
    name: { en: "Prepaid Rent or Lease", bn: "প্রিপেইড ভাড়া বা লিজ" },
    description: { en: "Rent paid in advance.", bn: "অগ্রিম প্রদত্ত ভাড়া।" },
  },
  '1320': {
    name: { en: "Prepaid Other", bn: "প্রিপেইড অন্যান্য" },
    description: { en: "Licenses, subscriptions, other prepaids.", bn: "লাইসেন্স, সাবস্ক্রিপশন ও অন্যান্য প্রিপেইড।" },
  },
  '1330': {
    name: { en: "Deposits — Utilities & Landlords", bn: "জামানত — ইউটিলিটি ও জমিদার" },
    description: { en: "Refundable utility or lease deposits.", bn: "ফেরতযোগ্য ইউটিলিটি বা লিজ জামানত।" },
  },
  '1500': {
    name: { en: "Land", bn: "জমি" },
    description: { en: "Owned land (if capitalized separately).", bn: "মালিকানাধীন জমি (আলাদা মূলধনী হলে)।" },
  },
  '1510': {
    name: { en: "Buildings — Station & Canopy", bn: "ভবন — স্টেশন ও ক্যানোপি" },
    description: { en: "Building and canopy structures.", bn: "ভবন ও ক্যানোপি কাঠামো।" },
  },
  '1520': {
    name: { en: "Dispensing Equipment & Underground Systems", bn: "ডিসপেন্সিং সরঞ্জাম ও ভূগর্ভস্থ ব্যবস্থা" },
    description: { en: "Pumps, lines, tank-related equipment.", bn: "পাম্প, লাইন, ট্যাংক-সংক্রান্ত সরঞ্জাম।" },
  },
  '1530': {
    name: { en: "Point of Sale & IT Equipment", bn: "POS ও IT সরঞ্জাম" },
    description: { en: "POS, servers, networking, peripherals.", bn: "POS, সার্ভার, নেটওয়ার্কিং, পেরিফেরাল।" },
  },
  '1540': {
    name: { en: "Vehicles & Mobile Equipment", bn: "যানবাহন ও মোবাইল সরঞ্জাম" },
    description: { en: "Delivery and service vehicles.", bn: "ডেলিভারি ও সার্ভিস যানবাহন।" },
  },
  '1550': {
    name: { en: "Accumulated Depreciation — Buildings & Equipment", bn: "সঞ্চিত মূল্যায়ন — ভবন ও সরঞ্জাম" },
    description: { en: "Contra-asset: accumulated depreciation (credit balance).", bn: "কনট্রা-সম্পদ: সঞ্চিত মূল্যায়ন (ক্রেডিট ব্যালেন্স)।" },
  },
  '1560': {
    name: { en: "Construction / Capex in Progress", bn: "নির্মাণ / ক্যাপেক্স চলমান" },
    description: { en: "Capital projects not yet placed in service.", bn: "এখনও সেবায় না আসা মূলধন প্রকল্প।" },
  },
  '1580': {
    name: { en: "Aquaculture — Pond & Production Equipment (Capitalizable)", bn: "অ্যাকোয়াকালচার — পুকুর ও উৎপাদন সরঞ্জাম (মূলধনী)" },
    description: { en: "Capitalize durable pond equipment, aerators, nets, and similar when following a fixed-asset policy.", bn: "স্থায়ী সম্পদ নীতি অনুসরণ করলে টেকসই পুকুর সরঞ্জাম, এরেটর, জাল ইত্যাদি মূলধনীকরণ।" },
  },
  '1581': {
    name: { en: "Aquaculture — Biological Inventory (Live Fish in Ponds)", bn: "অ্যাকোয়াকালচার — জৈবিক ইনভেন্টরি (পুকুরে জীব মাছ)" },
    description: { en: "Live fish biomass in ponds when capitalized; reduced on mortality (paired with 6726) or harvest, increased on positive count reconciliation (paired with 4244).", bn: "মূলধনীকৃত হলে পুকুরে জীব মাছের বায়োমাস; মৃত্যুতে (6726-এর সাথে) বা আহরণে হ্রাস, ইতিবাচক গণনা সমন্বয়ে বৃদ্ধি (4244-এর সাথে)।" },
  },
  '2000': {
    name: { en: "Accounts Payable — Trade", bn: "দেনা হিসাব — বাণিজ্যিক" },
    description: { en: "Vendor invoices — general.\n\nFSERP / system use: Trade payables: vendor bills (non-draft) and payment-made journals.", bn: "সরবরাহকারী ইনভয়েস — সাধারণ।\n\nFSERP / সিস্টেম ব্যবহার: Trade payables: vendor bill (non-draft) ও payment-made journal।" },
  },
  '2010': {
    name: { en: "Accounts Payable — Fuel Supplier", bn: "দেনা হিসাব — জ্বালানি সরবরাহকারী" },
    description: { en: "Wet-stock and fuel delivery payables.", bn: "ভেজা স্টক ও জ্বালানি ডেলিভারি দেনা।" },
  },
  '2020': {
    name: { en: "Credit Cards Payable — Company Cards", bn: "ক্রেডিট কার্ড দেনা — কোম্পানি কার্ড" },
    description: { en: "Balances on corporate purchasing cards.", bn: "কর্পোরেট ক্রয় কার্ডের ব্যালেন্স।" },
  },
  '2030': {
    name: { en: "Customer Deposits & Prepayments", bn: "গ্রাহক জমা ও অগ্রিম" },
    description: { en: "Customer prepayments or deposits taken.", bn: "গ্রাহকের অগ্রিম বা জমা গ্রহণ।" },
  },
  '2100': {
    name: { en: "Sales / VAT Payable", bn: "বিক্রয় / VAT দেনা" },
    description: { en: "Collected sales or value-added tax remitted to authority.\n\nFSERP / system use: Collected VAT / sales tax on invoices and bills (output and simplified input side on bills).", bn: "কর্তৃপক্ষে জমা দেওয়ার জন্য সংগৃহীত বিক্রয় বা VAT।\n\nFSERP / সিস্টেম ব্যবহার: Invoice ও bill-এ collected VAT / sales tax (output ও bill-এ simplified input side)।" },
  },
  '2110': {
    name: { en: "Excise / Fuel Duty Payable", bn: "আবগ / জ্বালানি শুল্ক দেনা" },
    description: { en: "Fuel excise or carbon levies (rename per jurisdiction).", bn: "জ্বালানি excise বা কার্বন levy (অঞ্চল অনুযায়ী নাম পরিবর্তন)।" },
  },
  '2120': {
    name: { en: "Withholding Tax Payable", bn: "উৎস কর কর্তন দেনা" },
    description: { en: "Employee or vendor withholding due to tax authority.", bn: "কর কর্তৃপক্ষে বকেয়া কর্মচারী বা সরবরাহকারী কর্তন।" },
  },
  '2130': {
    name: { en: "Other Statutory Payables", bn: "অন্যান্য আইনসম্মত দেনা" },
    description: { en: "Environmental, licensing fees payable, etc.", bn: "পরিবেশগত, লাইসেন্সিং ফি দেনা ইত্যাদি।" },
  },
  '2200': {
    name: { en: "Payroll — Salaries & Wages Payable", bn: "পে-রোল — বেতন ও মজুরি দেনা" },
    description: { en: "Net pay and accrued wages owed.", bn: "নেট পে ও সঞ্চিত মজুরি দেনা।" },
  },
  '2210': {
    name: { en: "Payroll — Statutory Deductions Payable", bn: "পে-রোল — আইনসম্মত কর্তন দেনা" },
    description: { en: "Social security, health, pension contributions payable.", bn: "সামাজিক নিরাপত্তা, স্বাস্থ্য, পেনশন অবদান দেনা।" },
  },
  '2300': {
    name: { en: "Accrued Expenses", bn: "সঞ্চিত খরচ" },
    description: { en: "Accrued utilities, interest, and other period costs.", bn: "সঞ্চিত ইউটিলিটি, সুদ ও অন্যান্য period খরচ।" },
  },
  '2400': {
    name: { en: "Short-Term Loans & Bank Overdraft", bn: "স্বল্পমেয়াদি ঋণ ও ব্যাংক ওভারড্রাফট" },
    description: { en: "Working capital facilities due within 12 months.", bn: "১২ মাসের মধ্যে পরিশোধযোগ্য working capital সুবিধা।" },
  },
  '2410': {
    name: { en: "Loans Payable — Principal (Borrowed Funds)", bn: "ঋণ দেনা — মূল (ঋণ নেওয়া)" },
    description: { en: "Balance-sheet principal for bank and third-party loans you owe. Use as **Principal GL** on Loans → **Borrowed**.\n\nFSERP / system use: Loans — principal payable: Principal GL for money you **borrowed** (Loans → Borrowed). Chart type Loan, subtype loan payable.", bn: "আপনার বকেয়া ব্যাংক ও তৃতীয় পক্ষের ঋণের ব্যালেন্স-শীট মূল। Loans → Borrowed-এ **Principal GL** হিসেবে ব্যবহার করুন।\n\nFSERP / সিস্টেম ব্যবহার: Loans — principal payable: আপনি **borrowed** করা টাকার Principal GL (Loans → Borrowed)। Chart type Loan, subtype loan payable।" },
  },
  '2500': {
    name: { en: "Long-Term Debt", bn: "দীর্ঘমেয়াদি ঋণ" },
    description: { en: "Term loans and notes payable beyond 12 months.", bn: "১২ মাসের বেশি মেয়াদের term loan ও notes payable।" },
  },
  '3000': {
    name: { en: "Owner Equity / Shareholder Capital", bn: "মালিকের ইকুইটি / শেয়ারহোল্ডার মূলধন" },
    description: { en: "Paid-in capital and owner contributions.\n\nFSERP / system use: Owner Equity / Shareholder Capital (3000): credit this (and debit a bank/cash GL) via a manual journal when owners invest cash.", bn: "অবদানকৃত মূলধন ও মালিকের অবদান।\n\nFSERP / সিস্টেম ব্যবহার: Owner Equity / Shareholder Capital (3000): মালিক নগদ invest করলে manual journal-এ credit (ও bank/cash GL debit)।" },
  },
  '3100': {
    name: { en: "Retained Earnings", bn: "সঞ্চিত মুনাফা" },
    description: { en: "Accumulated profits carried forward.", bn: "সঞ্চিত মুনাফা carry forward।" },
  },
  '3190': {
    name: { en: "Aquaculture — Pond Profit Clearing (Equity)", bn: "অ্যাকোয়াকালচার — পুকুর মুনাফা ক্লিয়ারিং (ইকুইটি)" },
    description: { en: "Common credit side when posting pond profit transfers from management P&L into the books; pair with bank or cash.", bn: "ম্যানেজমেন্ট P&L থেকে পুকুর মুনাফা বইতে পোস্ট করার সাধারণ ক্রেডিট পাশ; ব্যাংক বা নগদের সাথে জোড়া।" },
  },
  '3200': {
    name: { en: "Opening Balance Equity", bn: "ওপেনিং ব্যালেন্স ইকুইটি" },
    description: { en: "System opening balance offset during initial setup.", bn: "প্রাথমিক সেটআপে সিস্টেম opening balance offset।" },
  },
  '3300': {
    name: { en: "Dividends / Owner Drawings", bn: "লভ্যাংশ / মালিকের উত্তোলন" },
    description: { en: "Distributions to owners (permanent accounts per policy).\n\nFSERP / system use: Owner drawings / dividends: debit this (and credit bank/cash GL) when owners withdraw; use Journal Entries, not Fund Transfer.", bn: "মালিকদের বিতরণ (নীতি অনুযায়ী স্থায়ী হিসাব)।\n\nFSERP / সিস্টেম ব্যবহার: Owner drawings / dividends: মালিক withdraw করলে debit (ও bank/cash GL credit); Journal Entries ব্যবহার করুন, Fund Transfer নয়।" },
  },
  '4100': {
    name: { en: "Fuel Sales — Gasoline / Petrol", bn: "জ্বালানি বিক্রয় — গ্যাসোলিন / পেট্রোল" },
    description: { en: "Retail gasoline / petrol sales.\n\nFSERP / system use: Revenue for fuel-grade / liter-based POS and invoice lines.", bn: "খুচরা গ্যাসোলিন / পেট্রোল বিক্রয়।\n\nFSERP / সিস্টেম ব্যবহার: Fuel-grade / liter-based POS ও invoice line-এর revenue।" },
  },
  '4110': {
    name: { en: "Fuel Sales — Diesel", bn: "জ্বালানি বিক্রয় — ডিজেল" },
    description: { en: "Retail diesel sales.", bn: "খুচরা ডিজেল বিক্রয়।" },
  },
  '4120': {
    name: { en: "Fuel Sales — Premium / Super", bn: "জ্বালানি বিক্রয় — প্রিমিয়াম / সুপার" },
    description: { en: "Higher-octane or premium grades.", bn: "উচ্চ-অকটেন বা প্রিমিয়াম গ্রেড।" },
  },
  '4130': {
    name: { en: "Fuel Sales — Other Grades / Blends", bn: "জ্বালানি বিক্রয় — অন্যান্য গ্রেড / ব্লেন্ড" },
    description: { en: "E85, biodiesel blends, other fuels.", bn: "E85, বায়োডিজেল ব্লেন্ড, অন্যান্য জ্বালানি।" },
  },
  '4140': {
    name: { en: "Fuel Sales — Fleet & Commercial (B2B)", bn: "জ্বালানি বিক্রয় — ফ্লিট ও বাণিজ্যিক (B2B)" },
    description: { en: "Fuel sold on credit to fleet accounts.", bn: "ফ্লিট অ্যাকাউন্টে ক্রেডিটে বিক্রীত জ্বালানি।" },
  },
  '4200': {
    name: { en: "C-Store / Convenience Sales", bn: "C-Store / কনভেনিয়েন্স বিক্রয়" },
    description: { en: "Merchandise and tobacco where permitted.\n\nFSERP / system use: Revenue for shop / convenience-style POS and invoice lines.", bn: "পণ্য ও অনুমোদিত হলে তামাক।\n\nFSERP / সিস্টেম ব্যবহার: Shop / convenience-style POS ও invoice line-এর revenue।" },
  },
  '4210': {
    name: { en: "Lubricants & Additives — Over-the-Counter", bn: "লুব্রিকেন্ট ও অ্যাডিটিভ — ওভার-দ্য-কাউন্টার" },
    description: { en: "Bottled lubes and additives sold at counter.", bn: "কাউন্টারে বোতলজাত লুব ও অ্যাডিটিভ বিক্রয়।" },
  },
  '4220': {
    name: { en: "Car Wash & Services", bn: "কার ওয়াশ ও সেবা" },
    description: { en: "Wash bay and ancillary services revenue.", bn: "ওয়াশ বে ও সহায়ক সেবা আয়।" },
  },
  '4230': {
    name: { en: "Other Operating Revenue", bn: "অন্যান্য অপারেটিং আয়" },
    description: { en: "Air, vacuum, commissions, misc. operating.\n\nFSERP / system use: Fallback revenue when a line does not map to 4100/4200.", bn: "এয়ার, ভ্যাকুয়াম, কমিশন, বিবিধ অপারেটিং।\n\nFSERP / সিস্টেম ব্যবহার: 4100/4200-এ map না হওয়া line-এর fallback revenue।" },
  },
  '4240': {
    name: { en: "Aquaculture Revenue — Fish Harvest Sales", bn: "অ্যাকোয়াকালচার আয় — মাছ আহরণ বিক্রয়" },
    description: { en: "Revenue from table-size / harvest fish sales (see Aquaculture income_type fish_harvest_sale).", bn: "টেবিল সাইজ / আহরণ মাছ বিক্রয় থেকে আয় (Aquaculture income_type fish_harvest_sale দেখুন)।" },
  },
  '4241': {
    name: { en: "Aquaculture Revenue — Fingerling & Fry Sales", bn: "অ্যাকোয়াকালচার আয় — পোনা ও ফ্রাই বিক্রয়" },
    description: { en: "Revenue from seed / fry sales (income_type fingerling_sale).", bn: "বীজ / ফ্রাই বিক্রয় থেকে আয় (income_type fingerling_sale)।" },
  },
  '4242': {
    name: { en: "Aquaculture Revenue — Processing & Value-Add", bn: "অ্যাকোয়াকালচার আয় — প্রক্রিয়াকরণ ও ভ্যালু-অ্যাড" },
    description: { en: "Processing, filleting, smoking, or other value-added services (income_type processing_value_add).", bn: "প্রক্রিয়াকরণ, ফিলেট, ধূমপান বা অন্যান্য value-added সেবা (income_type processing_value_add)।" },
  },
  '4243': {
    name: { en: "Aquaculture Revenue — Other", bn: "অ্যাকোয়াকালচার আয় — অন্যান্য" },
    description: { en: "Other aquaculture-related income (income_type other_income).", bn: "অন্যান্য অ্যাকোয়াকালচার-সংক্রান্ত আয় (income_type other_income)।" },
  },
  '4244': {
    name: { en: "Aquaculture Revenue — Empty Sacks & Scrap Sales", bn: "অ্যাকোয়াকালচার আয় — খালি বস্তা ও স্ক্র্যাপ বিক্রয়" },
    description: { en: "Empty feed sacks, used or rejected materials, and used or scrap equipment sold from ponds (income_type empty_feed_sack_sale, used_material_sale, rejected_material_sale, used_equipment_sale).\n\n[Aquaculture — Biological Inventory Count Gain:] Upward physical count vs books (Dr 1581 / Cr this account).", bn: "খালি ফিড বস্তা, ব্যবহৃত বা প্রত্যাখ্যাত উপাদান, ও ব্যবহৃত/স্ক্র্যাপ সরঞ্জাম বিক্রয় (income_type empty_feed_sack_sale, used_material_sale, rejected_material_sale, used_equipment_sale)।\n\n[জৈবিক ইনভেন্টরি গণনা লাভ:] বইয়ের তুলনায় উপরের দিকের physical count (Dr 1581 / Cr এই হিসাব)।" },
  },
  '4300': {
    name: { en: "Discounts & Promotions (Contra Revenue)", bn: "ছাড় ও প্রচার (কনট্রা আয়)" },
    description: { en: "Loyalty and pump discounts (contra-revenue; net against sales per policy).", bn: "লয়ালটি ও পাম্প ছাড় (contra-revenue; নীতি অনুযায়ী বিক্রয়ের বিপরীতে net)।" },
  },
  '4400': {
    name: { en: "Interest & Non-Operating Income", bn: "সুদ ও অ-অপারেটিং আয়" },
    description: { en: "Bank interest, rebates, insurance recoveries.", bn: "ব্যাংক সুদ, rebate, বীমা recovery।" },
  },
  '4410': {
    name: { en: "Interest Income — Loans Receivable", bn: "সুদ আয় — ঋণ পাওনা" },
    description: { en: "Interest earned on lent funds. Optional **Interest GL** when splitting principal vs interest on **Lent** loans.\n\nFSERP / system use: Loans — interest income on funds lent; optional Interest GL when splitting repayments on lent loans.", bn: "ধার দেওয়া তহবিলে অর্জিত সুদ। Lent ঋণে মূল বনাম সুদ ভাগ করার সময় **Interest GL** (ঐচ্ছিক)।\n\nFSERP / সিস্টেম ব্যবহার: Loans — lent funds-এ সুদ আয়; lent loan repayment ভাগ করার সময় optional Interest GL।" },
  },
  '5100': {
    name: { en: "Cost of Fuel Sold", bn: "বিক্রীত জ্বালানির খরচ" },
    description: { en: "Fuel COGS (wet stock consumed) matched to fuel revenue.\n\nFSERP / system use: COGS for fuel lines (debit) when items have unit cost.", bn: "জ্বালানি COGS (ভেজা স্টক consumed) জ্বালানি আয়ের সাথে matched।\n\nFSERP / সিস্টেম ব্যবহার: Unit cost থাকলে fuel line-এর COGS (debit)।" },
  },
  '5110': {
    name: { en: "Cost of Lubricants & Fluids Sold", bn: "বিক্রীত লুব্রিকেন্ট ও তরলের খরচ" },
    description: { en: "Product cost for lube and fluids sold.", bn: "বিক্রীত লুব ও তরলের product cost।" },
  },
  '5120': {
    name: { en: "Cost of C-Store Goods Sold", bn: "C-Store পণ্য বিক্রির খরচ" },
    description: { en: "Merchandise COGS for shop.\n\nFSERP / system use: COGS for shop lines (debit) when items have unit cost.", bn: "দোকানের merchandise COGS।\n\nFSERP / সিস্টেম ব্যবহার: Unit cost থাকলে shop line-এর COGS (debit)।" },
  },
  '5200': {
    name: { en: "Inventory Shrinkage — Fuel (Wet Loss / Variance)", bn: "ইনভেন্টরি ক্ষয় — জ্বালানি (ভেজা ক্ষতি / variance)" },
    description: { en: "Tank loss, evaporation, meter variance beyond tolerance.", bn: "ট্যাংক ক্ষতি, বাষ্পীভবন, meter variance tolerance-এর বাইরে।" },
  },
  '5210': {
    name: { en: "Inventory Shrinkage — Shop / Other", bn: "ইনভেন্টরি ক্ষয় — দোকান / অন্যান্য" },
    description: { en: "Theft, damage, count adjustments (non-fuel).", bn: "চুরি, ক্ষতি, count adjustment (non-fuel)।" },
  },
  '6100': {
    name: { en: "Utilities — Electricity", bn: "ইউটিলিটি — বিদ্যুৎ" },
    description: { en: "Power for pumps, lighting, refrigeration.", bn: "পাম্প, আলো, refrigeration-এর বিদ্যুৎ।" },
  },
  '6110': {
    name: { en: "Utilities — Water & Sewer", bn: "ইউটিলিটি — পানি ও নর্দমা" },
    description: { en: "Water for wash and site use.", bn: "ওয়াশ ও সাইট ব্যবহারের পানি।" },
  },
  '6200': {
    name: { en: "Rent or Lease — Land & Building", bn: "ভাড়া বা লিজ — জমি ও ভবন" },
    description: { en: "Site lease or land rent.", bn: "সাইট লিজ বা জমি ভাড়া।" },
  },
  '6210': {
    name: { en: "Lease — Equipment & Vehicles", bn: "লিজ — সরঞ্জাম ও যানবাহন" },
    description: { en: "Operating leases for equipment.", bn: "সরঞ্জামের operating lease।" },
  },
  '6300': {
    name: { en: "Repairs & Maintenance — Dispensing & Site", bn: "মেরামত ও রক্ষণ — ডিসপেন্সিং ও সাইট" },
    description: { en: "Pump repair, line maintenance, forecourt upkeep.", bn: "পাম্প মেরামত, লাইন রক্ষণ, forecourt upkeep।" },
  },
  '6310': {
    name: { en: "Repairs & Maintenance — Building & Canopy", bn: "মেরামত ও রক্ষণ — ভবন ও ক্যানোপি" },
    description: { en: "Structural and cosmetic maintenance.", bn: "কাঠামোগত ও cosmetic রক্ষণ।" },
  },
  '6320': {
    name: { en: "Depreciation Expense — Buildings & Equipment", bn: "মূল্যায়ন খরচ — ভবন ও সরঞ্জাম" },
    description: { en: "Periodic depreciation on fixed assets.", bn: "স্থায়ী সম্পদের periodic depreciation।" },
  },
  '6400': {
    name: { en: "Salaries & Wages", bn: "বেতন ও মজুরি" },
    description: { en: "Gross wages before employer taxes and benefits.", bn: "নিয়োগকর্তা কর ও সুবিধার আগে gross মজুরি।" },
  },
  '6410': {
    name: { en: "Payroll Taxes & Employer Contributions", bn: "পে-রোল কর ও নিয়োগকর্তার অবদান" },
    description: { en: "Employer payroll taxes and benefits.", bn: "নিয়োগকর্তা payroll tax ও সুবিধা।" },
  },
  '6420': {
    name: { en: "Staff Training & Uniforms", bn: "কর্মী প্রশিক্ষণ ও ইউনিফর্ম" },
    description: { en: "Training, safety gear, uniforms.", bn: "প্রশিক্ষণ, safety gear, ইউনিফর্ম।" },
  },
  '6500': {
    name: { en: "Insurance — Property & Business Interruption", bn: "বীমা — সম্পত্তি ও ব্যবসায়িক বাধা" },
    description: { en: "Site, inventory, and business continuity coverage.", bn: "সাইট, ইনভেন্টরি ও business continuity coverage।" },
  },
  '6510': {
    name: { en: "Insurance — Liability & Environmental", bn: "বীমা — দায় ও পরিবেশগত" },
    description: { en: "General liability, pollution, statutory coverage.", bn: "সাধারণ দায়, pollution, আইনসম্মত coverage।" },
  },
  '6600': {
    name: { en: "Bank Charges & Merchant Service Fees", bn: "ব্যাংক চার্জ ও মার্চেন্ট সার্ভিস ফি" },
    description: { en: "Card interchange, acquirer fees, bank service charges.", bn: "কার্ড interchange, acquirer fee, ব্যাংক service charge।" },
  },
  '6610': {
    name: { en: "Cash Over / Short", bn: "নগদ অতিরিক্ত / কম" },
    description: { en: "Till variances after investigation.", bn: "তদন্তের পর till variance।" },
  },
  '6620': {
    name: { en: "Interest Expense — Loan Borrowings", bn: "সুদ খরচ — ঋণ গ্রহণ" },
    description: { en: "Interest paid on borrowed funds. Optional **Interest GL** when splitting principal vs interest on **Borrowed** loans.\n\nFSERP / system use: Loans — interest expense on borrowings; optional Interest GL when splitting repayments on borrowed loans.", bn: "ঋণ নেওয়া তহবিলে প্রদত্ত সুদ। Borrowed ঋণে মূল বনাম সুদ ভাগ করার সময় **Interest GL** (ঐচ্ছিক)।\n\nFSERP / সিস্টেম ব্যবহার: Loans — borrowings-এ সুদ খরচ; borrowed loan repayment ভাগ করার সময় optional Interest GL।" },
  },
  '6700': {
    name: { en: "Marketing & Loyalty Programs", bn: "মার্কেটিং ও লয়ালটি প্রোগ্রাম" },
    description: { en: "Local ads, signage, loyalty subsidies.", bn: "স্থানীয় বিজ্ঞাপন, signage, loyalty subsidy।" },
  },
  '6711': {
    name: { en: "Aquaculture Expense — Lease & Pond Rights", bn: "অ্যাকোয়াকালচার খরচ — লিজ ও পুকুর অধিকার" },
    description: { en: "Lease money and pond rental (maps to aquaculture expense_category lease).", bn: "লিজ টাকা ও পুকুর ভাড়া (aquaculture expense_category lease)।" },
  },
  '6712': {
    name: { en: "Aquaculture Expense — Labor & Wages", bn: "অ্যাকোয়াকালচার খরচ — শ্রম ও মজুরি" },
    description: { en: "Pond workers on payroll (worker_salary). Day labor is recorded on vendor bills (day_labor).", bn: "পে-রোলে পুকুর শ্রমিক (worker_salary)। দৈনিক শ্রম vendor bill-এ (day_labor)।" },
  },
  '6713': {
    name: { en: "Aquaculture Expense — Soil Cut & Earthworks", bn: "অ্যাকোয়াকালচার খরচ — মাটি কাটা ও পৃথিবী কাজ" },
    description: { en: "Soil cut and earthworks for pond construction or maintenance (soilcut).", bn: "পুকুর নির্মাণ বা রক্ষণের মাটি কাটা ও earthworks (soilcut)।" },
  },
  '6714': {
    name: { en: "Aquaculture Expense — Pond Preparation", bn: "অ্যাকোয়াকালচার খরচ — পুকুর প্রস্তুতি" },
    description: { en: "Liming, fertilization, drying, and preparation before stocking (pond_preparation).", bn: "stocking-এর আগে liming, fertilization, drying ও প্রস্তুতি (pond_preparation)।" },
  },
  '6715': {
    name: { en: "Aquaculture Expense — Fry & Fingerlings", bn: "অ্যাকোয়াকালচার খরচ — পোনা ও ফ্রাই" },
    description: { en: "Stocking purchases (fry_stocking).", bn: "stocking কেনা (fry_stocking)।" },
  },
  '6716': {
    name: { en: "Aquaculture Expense — Feed", bn: "অ্যাকোয়াকালচার খরচ — ফিড" },
    description: { en: "Commercial feed purchases (feed_purchase).", bn: "বাণিজ্যিক ফিড কেনা (feed_purchase)।" },
  },
  '6717': {
    name: { en: "Aquaculture Expense — Electricity (Ponds)", bn: "অ্যাকোয়াকালচার খরচ — বিদ্যুৎ (পুকুর)" },
    description: { en: "Aeration and pond electricity (electricity).", bn: "aeration ও পুকুর বিদ্যুৎ (electricity)।" },
  },
  '6718': {
    name: { en: "Aquaculture Expense — Equipment & Tools", bn: "অ্যাকোয়াকালচার খরচ — সরঞ্জাম ও টুলস" },
    description: { en: "Durable equipment, aerators, nets, and tools not capitalized to 1580 (equipment).", bn: "1580-এ মূলধনী না করা টেকসই সরঞ্জাম, এরেটর, জাল ও tools (equipment)।" },
  },
  '6719': {
    name: { en: "Aquaculture Expense — Day labor, harvest & contract crew", bn: "অ্যাকোয়াকালচার খরচ — দৈনিক শ্রম, আহরণ ও চুক্তি দল" },
    description: { en: "Daily hired labor, contract harvest, and fisherman bills (day_labor, fisherman).", bn: "দৈনিক ভাড়াটে শ্রম, চুক্তি harvest ও fisherman bill (day_labor, fisherman)।" },
  },
  '6720': {
    name: { en: "Aquaculture Expense — Transportation", bn: "অ্যাকোয়াকালচার খরচ — পরিবহন" },
    description: { en: "Fish haulage and logistics (transportation).", bn: "মাছ পরিবহন ও logistics (transportation)।" },
  },
  '6721': {
    name: { en: "Aquaculture Expense — Medicine & Veterinary", bn: "অ্যাকোয়াকালচার খরচ — ওষুধ ও পশুচিকিৎসা" },
    description: { en: "Medicine, vaccine, and veterinary supplies (medicine_purchase).", bn: "ওষুধ, vaccine ও veterinary supplies (medicine_purchase)।" },
  },
  '6722': {
    name: { en: "Aquaculture Expense — Repairs & Structural Maintenance", bn: "অ্যাকোয়াকালচার খরচ — মেরামত ও কাঠামোগত রক্ষণ" },
    description: { en: "Pond dike, pump, aerator, vehicle, and site repair labour and materials (repair_maintenance).", bn: "পুকুর বাঁধ, পাম্প, এরেটর, যানবাহন ও সাইট repair labour ও materials (repair_maintenance)।" },
  },
  '6725': {
    name: { en: "Aquaculture Expense — Miscellaneous & other operating", bn: "অ্যাকোয়াকালচার খরচ — বিবিধ ও অন্যান্য অপারেটিং" },
    description: { en: "Miscellaneous pond costs (code other): boats, wiring, lighting, cameras, engines, aerators, nets, repairs, bikes, labour, site consumables, and items not mapped to a dedicated category.", bn: "বিবিধ পুকুর খরচ (code other): নৌকা, wiring, lighting, camera, engine, এরেটor, জাল, মেরামত, সাইকেল, শ্রম, site consumables ও dedicated category-তে mapped নয় এমন আইটেম।" },
  },
  '6726': {
    name: { en: "Aquaculture — Mortality, Predation & Shrinkage", bn: "অ্যাকোয়াকালচার — মৃত্যু, শিকার ও ক্ষয়" },
    description: { en: "Deaths, snake or predator losses, birds, theft, escapes, and similar shrinkage (Dr expense / Cr 1581).", bn: "মৃত্যু, সাপ বা শিকারী ক্ষতি, পাখি, চুরি, পালানো ও অনুরূপ shrinkage (Dr expense / Cr 1581)।" },
  },
  '6800': {
    name: { en: "Professional Fees — Legal & Accounting", bn: "পেশাদার ফি — আইন ও হিসাব" },
    description: { en: "Auditors, lawyers, consultants.", bn: "auditor, আইনজীবী, consultant।" },
  },
  '6810': {
    name: { en: "IT & Software Subscriptions", bn: "IT ও সফটওয়্যার সাবস্ক্রিপশন" },
    description: { en: "SaaS, support, cybersecurity.", bn: "SaaS, support, cybersecurity।" },
  },
  '6900': {
    name: { en: "Office & Administrative", bn: "অফিস ও প্রশাসনিক" },
    description: { en: "Supplies, postage, small tools not capitalized.\n\nFSERP / system use: Office & administrative supplies only (postage, small tools). Not the default for station vendor bills — use 6920 station operating or a fuel-station cost type on the bill line.", bn: "মূলধনী না হওয়া supplies, postage, ছোট tools।\n\nFSERP / সিস্টেম ব্যবহার: Office ও administrative supplies only (postage, ছোট tools)। station vendor bill-এর default নয় — 6920 station operating বা bill line-এ fuel-station cost type ব্যবহার করুন।" },
  },
  '6910': {
    name: { en: "Donation & Social Support", bn: "দান ও সামাজিক সহায়তা" },
    description: { en: "Charitable giving and local social support paid from station cash; use POS to debit expense and credit cash in hand (1010) or the active register.\n\nFSERP / system use: Donation and social support paid from the station: record in POS; debits 6910 and credits 1010 Cash on Hand or the selected cash register’s linked GL (same as sales deposits).", bn: "স্টেশন নগদ থেকে দান ও স্থানীয় সামাজিক সহায়তা; POS-এ expense debit ও হাতে নগদ (1010) বা active register credit।\n\nFSERP / সিস্টেম ব্যবহার: স্টেশন থেকে দান ও সামাজিক সহায়তা: POS-এ record; Dr 6910, Cr 1010 Cash on Hand বা নির্বাচিত cash register-এর linked GL (sales deposit-এর মতো)।" },
  },
  '6920': {
    name: { en: "General Station Operating Expenses", bn: "সাধারণ স্টেশন অপারেটিং খরচ" },
    description: { en: "Default GL for fuel-station operating rollup on vendor bills (payroll, rent, insurance, bank fees, security, marketing, and general overhead). Override the bill line for dedicated accounts: 6400 wages, 6200 rent, 6500 insurance, 6600 bank fees, 7000 security, 6700 marketing, 6900 office supplies only.\n\nFSERP / system use: General station operating expenses: default GL for fuel-station operating rollup and uncategorized station vendor bills. Override line GL for payroll (6400), rent (6200), utilities (6100), etc.", bn: "vendor bill-এ fuel-station operating rollup-এর default GL (payroll, rent, insurance, bank fee, security, marketing ও general overhead)। dedicated হিসাবের জন্য bill line override: 6400 wages, 6200 rent, 6500 insurance, 6600 bank fee, 7000 security, 6700 marketing, 6900 office supplies only।\n\nFSERP / সিস্টেম ব্যবহার: General station operating expenses: fuel-station operating rollup ও uncategorized station vendor bill-এর default GL। payroll (6400), rent (6200), utilities (6100) ইত্যাদির জন্য line GL override।" },
  },
  '6990': {
    name: { en: "Miscellaneous Station Expenses", bn: "বিবিধ স্টেশন খরচ" },
    description: { en: "One-off or uncategorized station costs (fuel-station other rollup on vendor bills).\n\nFSERP / system use: Miscellaneous station expenses (fuel-station other rollup on vendor bills).", bn: "এককালীন বা uncategorized স্টেশন খরচ (vendor bill-এ fuel-station other rollup)।\n\nFSERP / সিস্টেম ব্যবহার: Miscellaneous station expenses (vendor bill-এ fuel-station other rollup)।" },
  },
  '7000': {
    name: { en: "Security & Cash Handling Services", bn: "নিরাপত্তা ও নগদ পরিচালনা সেবা" },
    description: { en: "CIT, alarms, monitoring.", bn: "CIT, alarm, monitoring।" },
  },
  '7100': {
    name: { en: "Fuel Freight & Delivery In", bn: "জ্বালানি ফ্রেইট ও ডেলিভারি ইন" },
    description: { en: "Transport surcharges on wet-stock deliveries.", bn: "ভেজা স্টক ডেলিভারিতে transport surcharge।" },
  },
  '7200': {
    name: { en: "Licenses, Permits & Memberships", bn: "লাইসেন্স, পারমিট ও সদস্যপদ" },
    description: { en: "Station licenses, industry association dues.", bn: "স্টেশন লাইসেন্স, industry association dues।" },
  },
  '7300': {
    name: { en: "Environmental & Compliance", bn: "পরিবেশ ও সম্মতি" },
    description: { en: "Testing, inspections, spill prevention supplies.", bn: "পরীক্ষা, inspection, spill prevention supplies।" },
  },
  '7400': {
    name: { en: "Loss on Asset Disposal / Write-off", bn: "সম্পদ নিষ্পত্তি / write-off-এ ক্ষতি" },
    description: { en: "Net loss on sale or retirement of assets.\n\nFSERP / system use: Loss on asset disposal / write-off: default when retiring fixed assets below book value.", bn: "সম্পদ বিক্রয় বা retirement-এ net loss।\n\nFSERP / সিস্টেম ব্যবহার: Loss on asset disposal / write-off: book value-এর নিচে fixed asset retire করলে default।" },
  },
}
