"""Bilingual report footnotes and methodology strings."""
from api.services.app_i18n import pick_for_company


def note_pond_warehouse_stock(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "On-hand quantities in each pond warehouse (ItemPondStock). "
        "Values use average inventory unit cost. Snapshot as of the report end date.",
        "প্রতিটি পুকুর গুদামে হাতে থাকা পরিমাণ (ItemPondStock)। "
        "মূল্য গড় ইনভেন্টরি ইউনিট খরচ। রিপোর্ট শেষ তারিখ অনুযায়ী স্ন্যাপশট।",
    )


def note_fish_stock_position(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Biological fish position per pond from transfers, vendor fry bills, sales, stock ledger, "
        "and latest biomass sample. Not the same as inventoried fry SKUs in the pond warehouse.",
        "স্থানান্তর, ভেন্ডর ফ্রাই বিল, বিক্রি, স্টক লেজার ও সর্বশেষ বায়োমাস নমুনা থেকে পুকুরভিত্তিক "
        "জৈবিক মাছের অবস্থান। পুকুর গুদামের ইনভেন্টরি ফ্রাই SKU-র সমান নয়।",
    )


def note_shop_station_stock(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Shop / station bin on-hand (ItemStationStock) for SKUs tracked per station — feed, medicine, "
        "fish fry SKUs, and general supplies. Excludes motor fuel. Transfer to ponds via pond warehouse transfer.",
        "স্টেশনভিত্তিক SKU-র দোকান/স্টেশন বিন (ItemStationStock) — খাবার, ওষুধ, ফ্রাই SKU, সরবরাহ। "
        "মোটর জ্বালানি বাদ। পুকুর গুদাম স্থানান্তরের মাধ্যমে পুকুরে পাঠান।",
    )


def note_pond_total_inventory(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Per-pond total inventory and asset value as of the report end date. "
        "Pond warehouse lines use on-hand quantity × average unit cost. "
        "Live fish uses implied biomass kg × production cost per kg (same basis as inter-pond transfers). "
        "Equipment & site assets are cumulative equipment, repair, and miscellaneous pond expenses through "
        "that date (expensed purchases — aerators, boats, nets, tools, wire, pumps, etc.). "
        "Shop station stock is not included until transferred to the pond.",
        "রিপোর্ট শেষ তারিখ অনুযায়ী পুকুরভিত্তিক মোট ইনভেন্টরি ও সম্পদ মূল্য। "
        "পুকুর গুদাম: হাতে × গড় খরচ। জীবিত মাছ: অনুমানিত বায়োমাস kg × উৎপাদন খরচ/kg। "
        "যন্ত্রপাতি ও সাইট সম্পদ: সঞ্চিত সরঞ্জাম, মেরামত ও বিবিধ পুকুর খরচ। "
        "দোকান স্টক পুকুরে স্থানান্তর না হওয়া পর্যন্ত অন্তর্ভুক্ত নয়।",
    )


def note_equipment_assets(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Operating purchases for equipment, repair & maintenance, and miscellaneous pond assets "
        "(aerators, boats, nets, tools, cameras, wire, etc.). Durable items may also be tracked in "
        "Accounting → Fixed Assets (/fixed-assets) with straight-line depreciation and AUTO-FA-DEP journals.",
        "যন্ত্রপাতি, মেরামত ও রক্ষণাবেক্ষণ ও বিবিধ পুকুর সম্পদের অপারেটিং ক্রয়। "
        "স্থায়ী সম্পদ Accounting → Fixed Assets-এ ট্র্যাক করা যায়।",
    )


def note_pond_sales_comprehensive(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Fish: all Aquaculture pond income lines in the period (every income_type). "
        "POS: invoices to each pond's linked POS customer; lines classified as motor fuel are excluded.",
        "মাছ: সময়সীমার সব পুকুর আয়। POS: প্রতিটি পুকুর POS গ্রাহকের ইনভয়েস; মোটর জ্বালানি বাদ।",
    )


def note_expenses_station_scope(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Aquaculture expense register rows with source station matching Site scope. "
        "Posted GL pond costs on vendor bills are on Profit & Loss (pond scope) or All Ponds — P&L Summary, "
        "not on station P&L when the line is pond-tagged.",
        "সাইট স্কোপ অনুযায়ী স্টেশন-উৎস ব্যয়। পুকুর-ট্যাগ GL খরচ Pond P&L-এ, স্টেশন P&L-এ নয়।",
    )


def note_sampling(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Net sample counts and weights are from the seine/net catch. Extrapolated pond biomass applies "
        "sample mean weight to book head count at save time. Market valuation fields require a market price.",
        "জালের নমুনার সংখ্যা ও ওজন। সংরক্ষণের সময় বইয়ের মাথা সংখ্যায় নমুনার গড় ওজন প্রয়োগ করে "
        "পুকুর বায়োমাস অনুমান। বাজার মূল্যের জন্য বাজার দর দরকার।",
    )


def note_fish_stock_breakdown(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Biological fish position split by production cycle and species. "
        "Formula per bucket: stocked − sales − mortality + other adjustments = present.",
        "উৎপাদন চক্র ও প্রজাতি অনুযায়ী জৈবিক মাছের অবস্থান। "
        "সূত্র: স্টকড − বিক্রি − মৃত্যু + অন্যান্য সমন্বয় = বর্তমান।",
    )


def note_fish_biomass_movements(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "All fish biomass movements in the period: vendor stocking bills, inter-pond transfers, "
        "harvest sales, mortality losses, and manual stock ledger adjustments.",
        "সময়সীমার সব মাছের বায়োমাস চলাচল: স্টকিং বিল, আন্তঃ-পুকুর স্থানান্তর, ধরা বিক্রি, "
        "মৃত্যু ও ম্যানুয়াল স্টক লেজার সমন্বয়।",
    )


def note_fish_stock_adjustments(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Mortality losses and manual fish count/weight adjustments from the stock ledger. "
        "Optional GL posting uses bio-asset accounts when enabled on each entry.",
        "স্টক লেজার থেকে মৃত্যু ও ম্যানুয়াল সংখ্যা/ওজন সমন্বয়। "
        "ঐচ্ছিক GL পোস্টিং বায়ো-অ্যাসেট অ্যাকাউন্ট ব্যবহার করে।",
    )


def note_feed_medicine_consumption(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Feed and medicine consumed from each pond warehouse (manual consumption or feeding advice apply). "
        "Daily feed totals show sacks, kilograms, and metric tons (1 t = 1,000 kg) plus cost. "
        "Sacks and kg come from recorded feed metrics on each consumption; cost is inventory value at use (COGS).",
        "প্রতিটি পুকুর গুদাম থেকে ব্যবহৃত খাবার ও ঔষধ (ম্যানুয়াল বা ফিডিং অ্যাডভাইস প্রয়োগ)। "
        "দৈনিক খাবার মোট: বস্তা, কেজি ও মেট্রিক টন (১ টন = ১,০০০ কেজি) সহ খরচ। "
        "বস্তা ও কেজি প্রতিটি ব্যবহারের রেকর্ড থেকে; খরচ ব্যবহারের সময় ইনভেন্টরি মূল্য (COGS)।",
    )


def note_feed_consumption(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Feed consumed from each pond warehouse (manual consumption or feeding advice apply). "
        "Daily totals show sacks, kilograms, and metric tons (1 t = 1,000 kg) plus cost at inventory value (COGS).",
        "প্রতিটি পুকুর গুদাম থেকে ব্যবহৃত খাবার (ম্যানুয়াল বা ফিডিং অ্যাডভাইস প্রয়োগ)। "
        "দৈনিক মোট: বস্তা, কেজি ও মেট্রিক টন (১ টন = ১,০০০ কেজি) সহ ইনভেন্টরি মূল্যে খরচ (COGS)।",
    )


def note_medicine_consumption(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Medicine consumed from each pond warehouse (manual treatments). "
        "Daily totals and entry detail show cost at inventory value (COGS).",
        "প্রতিটি পুকুর গুদাম থেকে ব্যবহৃত ঔষধ (ম্যানুয়াল চিকিৎসা)। "
        "দৈনিক মোট ও এন্ট্রি বিস্তারিত ইনভেন্টরি মূল্যে খরচ (COGS) দেখায়।",
    )


def note_fish_transfers(company_id: int) -> str:
    return pick_for_company(
        company_id,
        "Each line is an internal sale: the selling pond raises an invoice and the buying pond "
        "records a bill, settled on 1595 Inter-Pond Current Account (never cash). "
        "Seller journals AUTO-IPT-INV (Dr 1595 / Cr 4245 at price; Dr 5245 / Cr 1581 at book cost). "
        "Buyer journals AUTO-IPT-BILL (Dr 1581 / Cr 1595 at price). Company-wide 1595 cancels; "
        "4245/5245 are eliminated on consolidation so company profit does not move.",
        "প্রতিটি লাইন অভ্যন্তরীণ বিক্রি: বিক্রেতা পুকুর ইনভয়েস, ক্রেতা পুকুর বিল — "
        "১৫৯৫ আন্তঃ-পুকুর চলতি হিসাবে নিষ্পত্তি (নগদ নয়)। "
        "বিক্রেতা AUTO-IPT-INV (মূল্যে Dr 1595 / Cr 4245; বই খরচে Dr 5245 / Cr 1581)। "
        "ক্রেতা AUTO-IPT-BILL (মূল্যে Dr 1581 / Cr 1595)। কোম্পানি পর্যায়ে 1595 বাতিল; "
        "একত্রীকরণে 4245/5245 বাদ যায় বলে কোম্পানি মুনাফা নড়ে না।",
    )
