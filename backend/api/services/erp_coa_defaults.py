"""
Built-in chart account codes for ERP automation — single source of truth.

Mirrors api.chart_templates.fuel_station, aquaculture_coa_seed, and module posting logic.
UI and GL posting should resolve accounts by code through chart_account_id_for_code().
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ErpCoaPurpose:
    key: str
    module: str
    label: str
    account_code: str
    hint: str


class ErpCoaCode:
    """Template account codes — keep in sync with frontend src/lib/coaDefaults.ts."""

    # Bank & cash
    CASH = "1010"
    UNDEPOSITED = "1020"
    BANK_OP = "1030"
    BANK_CARD_SETTLEMENT = "1040"
    BANK_TAX_TRUST = "1050"
    CARD_CLEARING = "1120"
    CARD_CLEARING_OTHER = "1130"
    EMPLOYEE_ADVANCES = "1150"
    LOAN_RECEIVABLE = "1160"

    # Inventory
    INV_FUEL = "1200"
    INV_LUBE = "1210"
    INV_SHOP = "1220"
    INV_OTHER = "1230"
    INV_BIO = "1581"

    # Fixed assets
    FA_LAND = "1500"
    FA_BUILDINGS = "1510"
    FA_EQUIPMENT = "1520"
    FA_POS_IT = "1530"
    FA_VEHICLES = "1540"
    FA_ACCUM_DEPR = "1550"
    FA_CIP = "1560"

    # Payables & liabilities
    AP_TRADE = "2000"
    AP_FUEL = "2010"
    AP_CREDIT_CARD = "2020"
    AP_CUSTOMER_DEPOSITS = "2030"
    VAT_PAYABLE = "2100"
    EXCISE_PAYABLE = "2110"
    WITHHOLDING_TAX = "2120"
    LOAN_PAYABLE = "2410"
    SALARY_PAYABLE = "2200"
    STAT_DED_PAYABLE = "2210"
    ACCRUED_EXPENSES = "2300"

    # Equity
    OWNER_EQUITY = "3000"
    RETAINED_EARNINGS = "3100"
    OPENING_BALANCE_EQUITY = "3200"
    AQ_PROFIT_CLEARING = "3190"
    OWNER_DRAW = "3300"

    # Receivables
    AR_TRADE = "1100"
    AR_FLEET = "1110"

    # Revenue
    REV_FUEL = "4100"
    REV_DIESEL = "4110"
    REV_PREMIUM_FUEL = "4120"
    REV_OTHER_FUEL = "4130"
    REV_FLEET = "4140"
    REV_SHOP = "4200"
    REV_LUBE_OTC = "4210"
    REV_SERVICES = "4220"
    REV_OTHER = "4230"
    REV_DISCOUNT_CONTRA = "4300"
    REV_INTEREST_LOAN = "4410"
    REV_NON_OPERATING = "4400"

    # COGS & shrink
    COGS_FUEL = "5100"
    COGS_LUBE = "5110"
    COGS_SHOP = "5120"
    SHRINK_FUEL = "5200"
    SHRINK_SHOP = "5210"

    # Operating expenses (selected)
    UTIL_ELECTRIC = "6100"
    UTIL_WATER = "6110"
    RENT_BUILDING = "6200"
    RENT_EQUIPMENT = "6210"
    REPAIR_SITE = "6300"
    REPAIR_BUILDING = "6310"
    DEPR_EXPENSE = "6320"
    SALARY_EXP = "6400"
    PAYROLL_TAX = "6410"
    INSURANCE_PROPERTY = "6500"
    INSURANCE_LIABILITY = "6510"
    BANK_FEES = "6600"
    CASH_OVER_SHORT = "6610"
    INTEREST_EXPENSE_LOAN = "6620"
    MARKETING = "6700"
    PROFESSIONAL_FEES = "6800"
    IT_SUBSCRIPTIONS = "6810"
    OFFICE_ADMIN = "6900"
    STATION_OPERATING = "6920"
    DONATION = "6910"
    STATION_MISC = "6990"
    SECURITY = "7000"
    FUEL_FREIGHT = "7100"
    LICENSES = "7200"
    ENVIRONMENTAL = "7300"
    ASSET_DISPOSAL_LOSS = "7400"

    # Aquaculture expense (6711–6726) & revenue (4240–4244) — see aquaculture_constants
    AQ_LEASE = "6711"
    AQ_LABOR = "6712"
    AQ_FEED = "6716"
    AQ_MEDICINE = "6721"
    AQ_ELECTRICITY = "6717"
    AQ_MISC = "6725"
    AQ_MORTALITY = "6726"
    AQ_REV_HARVEST = "4240"
    AQ_REV_FINGERLING = "4241"
    AQ_REV_PROCESSING = "4242"
    AQ_REV_OTHER = "4243"
    AQ_REV_SCRAP = "4244"
    AQ_CAPITAL_EQUIP = "1580"

    # Prepaid & other current assets
    PREPAID_INSURANCE = "1300"
    PREPAID_RENT = "1310"
    PREPAID_OTHER = "1320"
    DEPOSITS_REFUNDABLE = "1330"
    AR_ALLOWANCE = "1140"
    SHORT_TERM_DEBT = "2400"
    LONG_TERM_DEBT = "2500"
    STATUTORY_OTHER = "2130"


# Ordered registry for API / documentation (grouped by module in payload).
ERP_COA_PURPOSES: tuple[ErpCoaPurpose, ...] = (
    ErpCoaPurpose(
        "bank.cash",
        "bank",
        "Cash on hand (registers / safe)",
        ErpCoaCode.CASH,
        "POS cash sales, petty cash, and payment receipts when undeposited funds (1020) is not used.",
    ),
    ErpCoaPurpose(
        "bank.undeposited",
        "bank",
        "Undeposited funds",
        ErpCoaCode.UNDEPOSITED,
        "Customer payments received before bank deposit batch; preferred over 1010 when both exist.",
    ),
    ErpCoaPurpose(
        "bank.operating",
        "bank",
        "Operating bank account",
        ErpCoaCode.BANK_OP,
        "Default settlement for payments made/received, fund transfers, loan disbursements/repayments, "
        "owner cash contributions (Dr bank / Cr 3000), and fixed-asset purchases.",
    ),
    ErpCoaPurpose(
        "bank.card_clearing",
        "bank",
        "Card clearing (Visa/MC/debit)",
        ErpCoaCode.CARD_CLEARING,
        "Debit side for card POS sales until acquirer settlement.",
    ),
    ErpCoaPurpose(
        "equity.owner_capital",
        "equity",
        "Owner equity / capital contributions",
        ErpCoaCode.OWNER_EQUITY,
        "Credit when owners invest cash (Dr 1030 or 1010). Use Journal Entries — not Fund Transfer.",
    ),
    ErpCoaPurpose(
        "equity.owner_draw",
        "equity",
        "Owner drawings / dividends",
        ErpCoaCode.OWNER_DRAW,
        "Debit when owners withdraw (Cr bank/cash). Use Journal Entries — not Fund Transfer.",
    ),
    ErpCoaPurpose(
        "equity.retained",
        "equity",
        "Retained earnings",
        ErpCoaCode.RETAINED_EARNINGS,
        "Accumulated profits; year-end close target when you formalize retained earnings transfers.",
    ),
    ErpCoaPurpose(
        "equity.opening_balance",
        "equity",
        "Opening balance equity",
        ErpCoaCode.OPENING_BALANCE_EQUITY,
        "Offset for opening balances during initial COA / party setup.",
    ),
    ErpCoaPurpose(
        "equity.aquaculture_profit_clearing",
        "equity",
        "Aquaculture pond profit clearing",
        ErpCoaCode.AQ_PROFIT_CLEARING,
        "Credit side for pond profit transfers from management P&L into books (Dr bank).",
    ),
    ErpCoaPurpose(
        "receivable.trade",
        "receivable",
        "Accounts receivable — trade",
        ErpCoaCode.AR_TRADE,
        "Credit sales, customer payments received, and invoice A/R balances.",
    ),
    ErpCoaPurpose(
        "payable.trade",
        "payable",
        "Accounts payable — trade",
        ErpCoaCode.AP_TRADE,
        "Vendor bills and payments made to suppliers.",
    ),
    ErpCoaPurpose(
        "payable.vat",
        "payable",
        "Sales / VAT payable",
        ErpCoaCode.VAT_PAYABLE,
        "Collected tax on invoices and simplified input VAT on bills.",
    ),
    ErpCoaPurpose(
        "payable.salary",
        "payable",
        "Payroll — net pay payable",
        ErpCoaCode.SALARY_PAYABLE,
        "Accrued net wages between payroll run and bank payment.",
    ),
    ErpCoaPurpose(
        "income.fuel",
        "income",
        "Fuel sales revenue",
        ErpCoaCode.REV_FUEL,
        "Default POS/invoice revenue for fuel-grade lines (4100; diesel/premium may use 4110/4120).",
    ),
    ErpCoaPurpose(
        "income.shop",
        "income",
        "Shop / c-store revenue",
        ErpCoaCode.REV_SHOP,
        "Non-fuel retail at the station or agro shop.",
    ),
    ErpCoaPurpose(
        "income.services",
        "income",
        "Services revenue (wash, fees)",
        ErpCoaCode.REV_SERVICES,
        "Car wash, air, commissions, and service fees.",
    ),
    ErpCoaPurpose(
        "income.other",
        "income",
        "Other operating revenue",
        ErpCoaCode.REV_OTHER,
        "Fallback revenue when a line does not map to fuel/shop/services.",
    ),
    ErpCoaPurpose(
        "income.interest_loan",
        "income",
        "Interest income — loans receivable",
        ErpCoaCode.REV_INTEREST_LOAN,
        "Interest portion on lent funds (Loans → Lent repayments); also fixed-asset disposal gains default.",
    ),
    ErpCoaPurpose(
        "cogs.fuel",
        "cogs",
        "Cost of fuel sold",
        ErpCoaCode.COGS_FUEL,
        "COGS debit for fuel invoice/POS lines with unit cost.",
    ),
    ErpCoaPurpose(
        "cogs.shop",
        "cogs",
        "Cost of shop goods sold",
        ErpCoaCode.COGS_SHOP,
        "COGS debit for shop/convenience lines with unit cost.",
    ),
    ErpCoaPurpose(
        "cogs.shrink_fuel",
        "cogs",
        "Fuel inventory shrink / wet loss",
        ErpCoaCode.SHRINK_FUEL,
        "Tank variance and wet-stock loss; fuel-station cost_of_sales rollup default.",
    ),
    ErpCoaPurpose(
        "cogs.shrink_shop",
        "cogs",
        "Shop inventory shrink",
        ErpCoaCode.SHRINK_SHOP,
        "Theft, damage, and count adjustments for shop inventory.",
    ),
    ErpCoaPurpose(
        "inventory.fuel",
        "inventory",
        "Fuel (wet-stock) inventory",
        ErpCoaCode.INV_FUEL,
        "Asset credited when fuel COGS posts.",
    ),
    ErpCoaPurpose(
        "inventory.shop",
        "inventory",
        "Shop / c-store inventory",
        ErpCoaCode.INV_SHOP,
        "Asset credited when shop COGS posts.",
    ),
    ErpCoaPurpose(
        "inventory.biological",
        "inventory",
        "Biological inventory (live fish)",
        ErpCoaCode.INV_BIO,
        "Capitalized live fish in ponds; paired with mortality (6726) and count gain (4244).",
    ),
    ErpCoaPurpose(
        "loan.principal_lent",
        "loan",
        "Loans receivable — principal (lent)",
        ErpCoaCode.LOAN_RECEIVABLE,
        "Principal GL for money you lent (Loans → Lent). Chart type loan, subtype loan_receivable.",
    ),
    ErpCoaPurpose(
        "loan.principal_borrowed",
        "loan",
        "Loans payable — principal (borrowed)",
        ErpCoaCode.LOAN_PAYABLE,
        "Principal GL for money you borrowed (Loans → Borrowed). Chart type loan, subtype loan_payable.",
    ),
    ErpCoaPurpose(
        "loan.interest_expense",
        "loan",
        "Interest expense — borrowings",
        ErpCoaCode.INTEREST_EXPENSE_LOAN,
        "Interest portion on borrowed loan repayments.",
    ),
    ErpCoaPurpose(
        "loan.interest_income",
        "loan",
        "Interest income — loans receivable",
        ErpCoaCode.REV_INTEREST_LOAN,
        "Interest portion on lent loan collections.",
    ),
    ErpCoaPurpose(
        "loan.settlement",
        "loan",
        "Loan settlement (cash/bank)",
        ErpCoaCode.BANK_OP,
        "Cash/bank GL for disbursements and repayments; prefers linked bank register GL, else 1030 then 1010.",
    ),
    ErpCoaPurpose(
        "payroll.salary_expense",
        "payroll",
        "Salaries & wages expense",
        ErpCoaCode.SALARY_EXP,
        "Gross payroll expense when posting salary to GL (station P&L). Pond allocations use 6712 on pond P&L.",
    ),
    ErpCoaPurpose(
        "payroll.statutory_payable",
        "payroll",
        "Payroll statutory deductions payable",
        ErpCoaCode.STAT_DED_PAYABLE,
        "Employer/employee statutory amounts owed.",
    ),
    ErpCoaPurpose(
        "fixed_asset.depreciation_expense",
        "fixed_asset",
        "Depreciation expense",
        ErpCoaCode.DEPR_EXPENSE,
        "Periodic depreciation (AUTO-FA-DEP journals).",
    ),
    ErpCoaPurpose(
        "fixed_asset.accumulated_depreciation",
        "fixed_asset",
        "Accumulated depreciation (contra-asset)",
        ErpCoaCode.FA_ACCUM_DEPR,
        "Contra-asset credited on each depreciation run.",
    ),
    ErpCoaPurpose(
        "fixed_asset.asset_buildings",
        "fixed_asset",
        "Buildings & canopy (capital)",
        ErpCoaCode.FA_BUILDINGS,
        "Capitalized buildings and canopy structures.",
    ),
    ErpCoaPurpose(
        "fixed_asset.asset_equipment",
        "fixed_asset",
        "Equipment & dispensing systems",
        ErpCoaCode.FA_EQUIPMENT,
        "Default capital asset account for pumps, pond equipment, and tools.",
    ),
    ErpCoaPurpose(
        "fixed_asset.asset_vehicles",
        "fixed_asset",
        "Vehicles",
        ErpCoaCode.FA_VEHICLES,
        "Delivery and service vehicles capitalized to the balance sheet.",
    ),
    ErpCoaPurpose(
        "fixed_asset.disposal_loss",
        "fixed_asset",
        "Loss on asset disposal",
        ErpCoaCode.ASSET_DISPOSAL_LOSS,
        "Net loss when retiring or selling fixed assets below book value.",
    ),
    ErpCoaPurpose(
        "fixed_asset.disposal_gain",
        "fixed_asset",
        "Gain on asset disposal",
        ErpCoaCode.REV_INTEREST_LOAN,
        "Net gain on disposal (4410 non-operating income band).",
    ),
    ErpCoaPurpose(
        "expense.office_admin",
        "expense",
        "Office & administrative supplies",
        ErpCoaCode.OFFICE_ADMIN,
        "Postage, office supplies, and small tools — not general station operating overhead.",
    ),
    ErpCoaPurpose(
        "expense.station_operating",
        "expense",
        "General station operating",
        ErpCoaCode.STATION_OPERATING,
        "Default for fuel-station operating rollup and uncategorized station vendor bills. "
        "Override for payroll (6400), rent (6200), insurance (6500), etc.",
    ),
    ErpCoaPurpose(
        "expense.station_misc",
        "expense",
        "Miscellaneous station expense",
        ErpCoaCode.STATION_MISC,
        "Fuel-station other rollup and one-off site costs.",
    ),
    ErpCoaPurpose(
        "expense.utilities",
        "expense",
        "Utilities — electricity",
        ErpCoaCode.UTIL_ELECTRIC,
        "Fuel-station utilities rollup default; water 6110.",
    ),
    ErpCoaPurpose(
        "expense.maintenance",
        "expense",
        "Repairs & maintenance — site",
        ErpCoaCode.REPAIR_SITE,
        "Fuel-station maintenance rollup; building work 6310.",
    ),
    ErpCoaPurpose(
        "expense.donation",
        "expense",
        "Donation & social support",
        ErpCoaCode.DONATION,
        "POS cash donations (Dr 6910 / Cr cash register GL).",
    ),
    ErpCoaPurpose(
        "aquaculture.pond_misc_expense",
        "aquaculture",
        "Pond miscellaneous expense",
        ErpCoaCode.AQ_MISC,
        "Default aquaculture other / vendor_bill_pond rollup (6725).",
    ),
    ErpCoaPurpose(
        "aquaculture.lease",
        "aquaculture",
        "Pond lease & rights",
        ErpCoaCode.AQ_LEASE,
        "Landlords lease-paid journals (6711).",
    ),
    ErpCoaPurpose(
        "aquaculture.labor",
        "aquaculture",
        "Pond labor (payroll allocation)",
        ErpCoaCode.AQ_LABOR,
        "Pond P&L labor bucket from payroll allocations (6712).",
    ),
    ErpCoaPurpose(
        "aquaculture.rev_harvest",
        "aquaculture",
        "Fish harvest sales revenue",
        ErpCoaCode.AQ_REV_HARVEST,
        "Aquaculture fish sales default income type (4240).",
    ),
    # —— Assets (balance sheet) ——
    ErpCoaPurpose(
        "asset.receivable_fleet",
        "asset",
        "Accounts receivable — fleet / commercial",
        ErpCoaCode.AR_FLEET,
        "B2B fuel credit and fleet charge accounts.",
    ),
    ErpCoaPurpose(
        "asset.receivable_allowance",
        "asset",
        "Allowance for doubtful accounts (contra-AR)",
        ErpCoaCode.AR_ALLOWANCE,
        "Contra-asset reserve against trade receivables.",
    ),
    ErpCoaPurpose(
        "asset.employee_advances",
        "asset",
        "Employee advances & loans",
        ErpCoaCode.EMPLOYEE_ADVANCES,
        "Staff advances recovered through payroll (party opening balances).",
    ),
    ErpCoaPurpose(
        "asset.card_clearing_other",
        "asset",
        "Card clearing — other schemes",
        ErpCoaCode.CARD_CLEARING_OTHER,
        "Amex and secondary card networks with separate settlement.",
    ),
    ErpCoaPurpose(
        "asset.bank_card_settlement",
        "asset",
        "Bank — card settlement account",
        ErpCoaCode.BANK_CARD_SETTLEMENT,
        "Dedicated bank account for acquirer settlements (optional).",
    ),
    ErpCoaPurpose(
        "asset.bank_tax_trust",
        "asset",
        "Bank — tax / statutory trust",
        ErpCoaCode.BANK_TAX_TRUST,
        "Segregated statutory or VAT trust cash if required.",
    ),
    ErpCoaPurpose(
        "asset.inventory_lube",
        "asset",
        "Inventory — lubricants & fluids",
        ErpCoaCode.INV_LUBE,
        "Oils, DEF, and additives on hand; COGS relief pairs with 5110.",
    ),
    ErpCoaPurpose(
        "asset.inventory_other",
        "asset",
        "Inventory — other products",
        ErpCoaCode.INV_OTHER,
        "Car care, accessories, and other resale goods.",
    ),
    ErpCoaPurpose(
        "asset.prepaid_insurance",
        "asset",
        "Prepaid insurance",
        ErpCoaCode.PREPAID_INSURANCE,
        "Unexpired insurance premiums (balance sheet until amortized).",
    ),
    ErpCoaPurpose(
        "asset.prepaid_rent",
        "asset",
        "Prepaid rent or lease",
        ErpCoaCode.PREPAID_RENT,
        "Rent paid in advance.",
    ),
    ErpCoaPurpose(
        "asset.prepaid_other",
        "asset",
        "Prepaid other",
        ErpCoaCode.PREPAID_OTHER,
        "Licenses, subscriptions, and other prepaids.",
    ),
    ErpCoaPurpose(
        "asset.deposits_refundable",
        "asset",
        "Deposits — utilities & landlords",
        ErpCoaCode.DEPOSITS_REFUNDABLE,
        "Refundable utility or lease security deposits.",
    ),
    ErpCoaPurpose(
        "asset.land",
        "asset",
        "Land (capital)",
        ErpCoaCode.FA_LAND,
        "Owned land capitalized separately from buildings.",
    ),
    ErpCoaPurpose(
        "asset.pos_it_equipment",
        "asset",
        "POS & IT equipment (capital)",
        ErpCoaCode.FA_POS_IT,
        "Point-of-sale, servers, and networking hardware capitalized.",
    ),
    ErpCoaPurpose(
        "asset.capex_in_progress",
        "asset",
        "Construction / capex in progress",
        ErpCoaCode.FA_CIP,
        "Capital projects not yet placed in service.",
    ),
    ErpCoaPurpose(
        "asset.aquaculture_capital_equipment",
        "asset",
        "Aquaculture pond & production equipment",
        ErpCoaCode.AQ_CAPITAL_EQUIP,
        "Capitalizable aerators, nets, and durable pond equipment (1580).",
    ),
    # —— Liabilities ——
    ErpCoaPurpose(
        "liability.ap_fuel",
        "liability",
        "Accounts payable — fuel supplier",
        ErpCoaCode.AP_FUEL,
        "Wet-stock and fuel delivery vendor payables.",
    ),
    ErpCoaPurpose(
        "liability.credit_card",
        "liability",
        "Credit cards payable — company cards",
        ErpCoaCode.AP_CREDIT_CARD,
        "Corporate purchasing card balances.",
    ),
    ErpCoaPurpose(
        "liability.customer_deposits",
        "liability",
        "Customer deposits & prepayments",
        ErpCoaCode.AP_CUSTOMER_DEPOSITS,
        "Customer prepayments or deposits held.",
    ),
    ErpCoaPurpose(
        "liability.excise",
        "liability",
        "Excise / fuel duty payable",
        ErpCoaCode.EXCISE_PAYABLE,
        "Fuel excise or carbon levies (rename per jurisdiction).",
    ),
    ErpCoaPurpose(
        "liability.withholding_tax",
        "liability",
        "Withholding tax payable",
        ErpCoaCode.WITHHOLDING_TAX,
        "Employee or vendor withholding due to tax authority.",
    ),
    ErpCoaPurpose(
        "liability.statutory_other",
        "liability",
        "Other statutory payables",
        ErpCoaCode.STATUTORY_OTHER,
        "Environmental fees, licensing payables, and similar.",
    ),
    ErpCoaPurpose(
        "liability.accrued_expenses",
        "liability",
        "Accrued expenses",
        ErpCoaCode.ACCRUED_EXPENSES,
        "Accrued utilities, interest, and other period-end accruals.",
    ),
    ErpCoaPurpose(
        "liability.short_term_debt",
        "liability",
        "Short-term loans & overdraft",
        ErpCoaCode.SHORT_TERM_DEBT,
        "Working capital facilities due within 12 months (distinct from 2410 module loans).",
    ),
    ErpCoaPurpose(
        "liability.long_term_debt",
        "liability",
        "Long-term debt",
        ErpCoaCode.LONG_TERM_DEBT,
        "Term notes and debt beyond 12 months.",
    ),
    # —— COGS (P&L cost of sales) ——
    ErpCoaPurpose(
        "cogs.lube",
        "cogs",
        "Cost of lubricants & fluids sold",
        ErpCoaCode.COGS_LUBE,
        "COGS for bottled lubes and fluids sold over the counter.",
    ),
    ErpCoaPurpose(
        "cogs.pond_feed_consumed",
        "cogs",
        "Pond feed consumed (inventory relief)",
        ErpCoaCode.AQ_FEED,
        "When feed is drawn from pond warehouse — inventory COGS pairs with 6716 operating view on pond P&L.",
    ),
    # —— Income (additional) ——
    ErpCoaPurpose(
        "income.diesel",
        "income",
        "Diesel fuel sales",
        ErpCoaCode.REV_DIESEL,
        "POS/invoice revenue when diesel grade is distinguished from 4100.",
    ),
    ErpCoaPurpose(
        "income.premium_fuel",
        "income",
        "Premium / super fuel sales",
        ErpCoaCode.REV_PREMIUM_FUEL,
        "Higher-octane or premium grade fuel revenue.",
    ),
    ErpCoaPurpose(
        "income.fleet",
        "income",
        "Fleet & commercial fuel sales",
        ErpCoaCode.REV_FLEET,
        "B2B fuel sold on credit to fleet accounts.",
    ),
    ErpCoaPurpose(
        "income.lube_otc",
        "income",
        "Lubricants OTC revenue",
        ErpCoaCode.REV_LUBE_OTC,
        "Bottled lubes and additives sold at the counter.",
    ),
    ErpCoaPurpose(
        "income.discount_contra",
        "income",
        "Discounts & promotions (contra revenue)",
        ErpCoaCode.REV_DISCOUNT_CONTRA,
        "Loyalty and pump discounts — contra-revenue per policy.",
    ),
    ErpCoaPurpose(
        "income.non_operating",
        "income",
        "Interest & non-operating income",
        ErpCoaCode.REV_NON_OPERATING,
        "Bank interest, rebates, and insurance recoveries (4400).",
    ),
    # —— Operating expenses (additional) ——
    ErpCoaPurpose(
        "expense.rent_building",
        "expense",
        "Rent or lease — land & building",
        ErpCoaCode.RENT_BUILDING,
        "Site lease or land rent — override on station operating bills.",
    ),
    ErpCoaPurpose(
        "expense.rent_equipment",
        "expense",
        "Lease — equipment & vehicles",
        ErpCoaCode.RENT_EQUIPMENT,
        "Operating leases for equipment and vehicles.",
    ),
    ErpCoaPurpose(
        "expense.repair_building",
        "expense",
        "Repairs — building & canopy",
        ErpCoaCode.REPAIR_BUILDING,
        "Structural and cosmetic building maintenance.",
    ),
    ErpCoaPurpose(
        "expense.payroll_tax",
        "expense",
        "Payroll taxes & employer contributions",
        ErpCoaCode.PAYROLL_TAX,
        "Employer payroll taxes and statutory employer contributions.",
    ),
    ErpCoaPurpose(
        "expense.insurance_property",
        "expense",
        "Insurance — property & business interruption",
        ErpCoaCode.INSURANCE_PROPERTY,
        "Site, inventory, and business continuity coverage.",
    ),
    ErpCoaPurpose(
        "expense.insurance_liability",
        "expense",
        "Insurance — liability & environmental",
        ErpCoaCode.INSURANCE_LIABILITY,
        "General liability, pollution, and statutory coverage.",
    ),
    ErpCoaPurpose(
        "expense.bank_fees",
        "expense",
        "Bank charges & merchant fees",
        ErpCoaCode.BANK_FEES,
        "Card interchange, acquirer fees, and bank service charges.",
    ),
    ErpCoaPurpose(
        "expense.cash_over_short",
        "expense",
        "Cash over / short",
        ErpCoaCode.CASH_OVER_SHORT,
        "Till variances after investigation.",
    ),
    ErpCoaPurpose(
        "expense.marketing",
        "expense",
        "Marketing & loyalty programs",
        ErpCoaCode.MARKETING,
        "Local advertising, signage, and loyalty subsidies.",
    ),
    ErpCoaPurpose(
        "expense.professional",
        "expense",
        "Professional fees — legal & accounting",
        ErpCoaCode.PROFESSIONAL_FEES,
        "Auditors, lawyers, and consultants.",
    ),
    ErpCoaPurpose(
        "expense.it_subscriptions",
        "expense",
        "IT & software subscriptions",
        ErpCoaCode.IT_SUBSCRIPTIONS,
        "SaaS, support contracts, and cybersecurity.",
    ),
    ErpCoaPurpose(
        "expense.security",
        "expense",
        "Security & cash handling",
        ErpCoaCode.SECURITY,
        "CIT, alarms, and monitoring services.",
    ),
    ErpCoaPurpose(
        "expense.fuel_freight",
        "expense",
        "Fuel freight & delivery in",
        ErpCoaCode.FUEL_FREIGHT,
        "Transport surcharges on wet-stock deliveries.",
    ),
    ErpCoaPurpose(
        "expense.licenses",
        "expense",
        "Licenses, permits & memberships",
        ErpCoaCode.LICENSES,
        "Station licenses and association dues.",
    ),
    ErpCoaPurpose(
        "expense.environmental",
        "expense",
        "Environmental & compliance",
        ErpCoaCode.ENVIRONMENTAL,
        "Testing, inspections, and spill-prevention supplies.",
    ),
    # —— Aquaculture (extended) ——
    ErpCoaPurpose(
        "aquaculture.rev_fingerling",
        "aquaculture",
        "Fingerling / fry sales revenue",
        ErpCoaCode.AQ_REV_FINGERLING,
        "Income type fingerling_sale (4241).",
    ),
    ErpCoaPurpose(
        "aquaculture.rev_processing",
        "aquaculture",
        "Processing / value-add revenue",
        ErpCoaCode.AQ_REV_PROCESSING,
        "Smoked, filleted, or processed fish (4242).",
    ),
    ErpCoaPurpose(
        "aquaculture.rev_other",
        "aquaculture",
        "Other aquaculture income",
        ErpCoaCode.AQ_REV_OTHER,
        "Tours, grants, and other pond income (4243).",
    ),
    ErpCoaPurpose(
        "aquaculture.rev_scrap",
        "aquaculture",
        "Scrap & by-product sales",
        ErpCoaCode.AQ_REV_SCRAP,
        "Empty sacks, scrap materials, non-biological sales (4244).",
    ),
    ErpCoaPurpose(
        "aquaculture.mortality",
        "aquaculture",
        "Mortality & biological shrinkage",
        ErpCoaCode.AQ_MORTALITY,
        "Fish stock ledger losses (6726 / Cr 1581).",
    ),
    ErpCoaPurpose(
        "aquaculture.feed",
        "aquaculture",
        "Feed purchases & consumption",
        ErpCoaCode.AQ_FEED,
        "Feed vendor bills, POS to pond, and warehouse consumption (6716).",
    ),
    ErpCoaPurpose(
        "aquaculture.medicine",
        "aquaculture",
        "Medicine & veterinary",
        ErpCoaCode.AQ_MEDICINE,
        "Medicine purchases and pond warehouse use (6721).",
    ),
    ErpCoaPurpose(
        "aquaculture.electricity",
        "aquaculture",
        "Pond electricity",
        ErpCoaCode.AQ_ELECTRICITY,
        "Aerators and pond electrical costs (6717).",
    ),
)

_PURPOSE_BY_KEY: dict[str, ErpCoaPurpose] = {p.key: p for p in ERP_COA_PURPOSES}


def coa_code_for_purpose(purpose_key: str) -> str | None:
    p = _PURPOSE_BY_KEY.get((purpose_key or "").strip())
    return p.account_code if p else None


def purpose_hint(purpose_key: str) -> str | None:
    p = _PURPOSE_BY_KEY.get((purpose_key or "").strip())
    return p.hint if p else None


def chart_account_id_for_code(company_id: int, account_code: str) -> int | None:
    from api.models import ChartOfAccount

    code = (account_code or "").strip()
    if not code:
        return None
    acc = ChartOfAccount.objects.filter(
        company_id=company_id, account_code=code, is_active=True
    ).first()
    return int(acc.id) if acc else None


def chart_account_row_for_code(company_id: int, account_code: str) -> dict[str, Any] | None:
    from api.models import ChartOfAccount

    code = (account_code or "").strip()
    if not code:
        return None
    acc = ChartOfAccount.objects.filter(
        company_id=company_id, account_code=code, is_active=True
    ).first()
    if not acc:
        return None
    return {
        "account_id": int(acc.id),
        "account_code": acc.account_code,
        "account_name": acc.account_name,
        "account_type": acc.account_type,
        "account_sub_type": acc.account_sub_type or "",
    }


def chart_account_id_for_purpose(company_id: int, purpose_key: str) -> int | None:
    code = coa_code_for_purpose(purpose_key)
    if not code:
        return None
    return chart_account_id_for_code(company_id, code)


def settlement_account_code_preference() -> tuple[str, ...]:
    """Cash movement default order: operating bank, then cash on hand."""
    return (ErpCoaCode.BANK_OP, ErpCoaCode.CASH)


def chart_account_id_for_settlement(company_id: int) -> int | None:
    for code in settlement_account_code_preference():
        aid = chart_account_id_for_code(company_id, code)
        if aid:
            return aid
    return None


def _infer_template_account_type(account_code: str) -> str:
    """Best-effort P&L/BS section from template numbering when COA row is missing."""
    code = (account_code or "").strip()
    if not code or not code[0].isdigit():
        return "other"
    if code.startswith(("671", "672")):
        return "expense"
    if code.startswith("424"):
        return "income"
    if code.startswith("158"):
        return "asset"
    if code in (ErpCoaCode.LOAN_RECEIVABLE, ErpCoaCode.LOAN_PAYABLE):
        return "loan"
    head = int(code[0])
    if head == 1:
        return "asset"
    if head == 2:
        return "liability"
    if head == 3:
        return "equity"
    if head == 4:
        return "income"
    if head == 5:
        return "cost_of_goods_sold"
    if head in (6, 7):
        return "expense"
    return "other"


def _aquaculture_expense_category_coa_map() -> dict[str, str]:
    from api.services.aquaculture_constants import (
        AQUACULTURE_EXPENSE_CATEGORY_CHOICES,
        coa_account_code_for_aquaculture_expense_category,
    )

    return {
        code: coa_account_code_for_aquaculture_expense_category(code)
        for code, _ in AQUACULTURE_EXPENSE_CATEGORY_CHOICES
    }


def _aquaculture_income_type_coa_map() -> dict[str, str]:
    from api.services.aquaculture_constants import (
        AQUACULTURE_INCOME_TYPE_CHOICES,
        coa_account_code_for_aquaculture_income_type,
    )

    return {
        code: coa_account_code_for_aquaculture_income_type(code)
        for code, _ in AQUACULTURE_INCOME_TYPE_CHOICES
    }


def erp_coa_defaults_payload(company_id: int) -> dict[str, Any]:
    """Resolved built-in defaults for the current company COA (API + UI hints)."""
    from api.services.fuel_station_coa_constants import (
        FUEL_STATION_EXPENSE_ROLLUP_COA_CODES,
        FUEL_STATION_INCOME_ROLLUP_COA_CODES,
    )

    purposes_out: list[dict[str, Any]] = []
    by_module: dict[str, list[dict[str, Any]]] = {}
    by_account_type: dict[str, list[dict[str, Any]]] = {}
    for p in ERP_COA_PURPOSES:
        row = chart_account_row_for_code(company_id, p.account_code)
        coa_type = (
            row["account_type"]
            if row
            else _infer_template_account_type(p.account_code)
        )
        item: dict[str, Any] = {
            "key": p.key,
            "module": p.module,
            "label": p.label,
            "account_code": p.account_code,
            "hint": p.hint,
            "account_id": row["account_id"] if row else None,
            "account_name": row["account_name"] if row else None,
            "account_type": coa_type,
            "resolved": row is not None,
        }
        purposes_out.append(item)
        by_module.setdefault(p.module, []).append(item)
        by_account_type.setdefault(coa_type, []).append(item)

    codes_flat = {
        name: getattr(ErpCoaCode, name)
        for name in dir(ErpCoaCode)
        if not name.startswith("_") and isinstance(getattr(ErpCoaCode, name), str)
    }

    return {
        "purposes": purposes_out,
        "by_module": by_module,
        "by_account_type": by_account_type,
        "codes": codes_flat,
        "settlement_preference": list(settlement_account_code_preference()),
        "fuel_station_expense_rollup_coa": dict(FUEL_STATION_EXPENSE_ROLLUP_COA_CODES),
        "fuel_station_income_rollup_coa": dict(FUEL_STATION_INCOME_ROLLUP_COA_CODES),
        "aquaculture_expense_category_coa": _aquaculture_expense_category_coa_map(),
        "aquaculture_income_type_coa": _aquaculture_income_type_coa_map(),
        "note": (
            "Built-in template codes for ERP automation. Missing account_id means the code is not "
            "in this company's chart — seed the fuel-station template or add the account manually."
        ),
    }


def bill_expense_fallback_code(*, has_fuel_station_category: bool = False) -> str:
    """Last-resort vendor bill expense when no line/item/vendor override applies."""
    if has_fuel_station_category:
        return ErpCoaCode.STATION_OPERATING
    return ErpCoaCode.STATION_OPERATING
