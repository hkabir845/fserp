"""Sidebar (menubar) modules — single map for Brain data coverage and list replies."""
from __future__ import annotations

# Mirrors `getFsmsErpMenuItems()` sections in frontend/src/navigation/erpAppMenu.tsx
SIDEBAR_MODULES: list[dict[str, str]] = [
    # Main
    {"key": "dashboard", "section": "main", "label_bn": "ড্যাশবোর্ড", "path": "/dashboard"},
    {"key": "pos_cashier", "section": "main", "label_bn": "POS / ক্যাশিয়ার", "path": "/cashier"},
    # Station
    {"key": "stations", "section": "station", "label_bn": "স্টেশন", "path": "/stations"},
    {"key": "tanks", "section": "station", "label_bn": "ট্যাংক", "path": "/tanks"},
    {"key": "islands", "section": "station", "label_bn": "আইল্যান্ড", "path": "/islands"},
    {"key": "dispensers", "section": "station", "label_bn": "ডিসপেনসার", "path": "/dispensers"},
    {"key": "meters", "section": "station", "label_bn": "মিটার", "path": "/meters"},
    {"key": "nozzles", "section": "station", "label_bn": "নজল", "path": "/nozzles"},
    # Operations
    {"key": "shift_management", "section": "operations", "label_bn": "শিফট ম্যানেজমেন্ট", "path": "/shift-management"},
    {"key": "tank_dips", "section": "operations", "label_bn": "ট্যাংক ডিপ", "path": "/tank-dips"},
    # Accounting
    {"key": "chart_of_accounts", "section": "accounting", "label_bn": "চার্ট অফ অ্যাকাউন্ট", "path": "/chart-of-accounts"},
    {"key": "journal_entries", "section": "accounting", "label_bn": "জার্নাল এন্ট্রি", "path": "/journal-entries"},
    {"key": "fund_transfers", "section": "accounting", "label_bn": "ফান্ড ট্রান্সফার", "path": "/fund-transfers"},
    {"key": "loans", "section": "accounting", "label_bn": "ঋণ", "path": "/loans"},
    {"key": "fixed_assets", "section": "accounting", "label_bn": "স্থায়ী সম্পদ", "path": "/fixed-assets"},
    # Sales
    {"key": "customers", "section": "sales", "label_bn": "গ্রাহক", "path": "/customers"},
    {"key": "vendors", "section": "sales", "label_bn": "সরবরাহকারী", "path": "/vendors"},
    {"key": "invoices", "section": "sales", "label_bn": "ইনভয়েস / বিক্রি", "path": "/invoices"},
    {"key": "bills", "section": "sales", "label_bn": "বিল / ক্রয়", "path": "/bills"},
    {"key": "payments", "section": "sales", "label_bn": "পেমেন্ট", "path": "/payments"},
    # Inventory
    {"key": "items", "section": "inventory", "label_bn": "পণ্য ও সেবা", "path": "/items"},
    {"key": "inventory_transfers", "section": "inventory", "label_bn": "ইনভেন্টরি ট্রান্সফার", "path": "/inventory"},
    # HR
    {"key": "employees", "section": "hr", "label_bn": "কর্মচারী", "path": "/employees"},
    {"key": "payroll", "section": "hr", "label_bn": "পে-রোল", "path": "/payroll"},
    # Management
    {"key": "tax", "section": "management", "label_bn": "ট্যাক্স", "path": "/tax"},
    {"key": "reporting_categories", "section": "management", "label_bn": "রিপোর্টিং ক্যাটাগরি", "path": "/reporting-categories"},
    # Aquaculture
    {"key": "aquaculture_dashboard", "section": "aquaculture", "label_bn": "মৎস্য ড্যাশবোর্ড", "path": "/aquaculture"},
    {"key": "ponds", "section": "aquaculture", "label_bn": "পোন্ড", "path": "/aquaculture/ponds"},
    {"key": "landlords", "section": "aquaculture", "label_bn": "জমিদার", "path": "/aquaculture/landlords"},
    {"key": "production_cycles", "section": "aquaculture", "label_bn": "স্টকিং ব্যাচ", "path": "/aquaculture/cycles"},
    {"key": "fish_transfers", "section": "aquaculture", "label_bn": "মাছ স্থানান্তর", "path": "/aquaculture/transfers"},
    {"key": "pond_stock", "section": "aquaculture", "label_bn": "পোন্ড স্টক", "path": "/aquaculture/stock"},
    {"key": "biomass_sampling", "section": "aquaculture", "label_bn": "বায়োমাস স্যাম্পলিং", "path": "/aquaculture/sampling"},
    {"key": "feeding_advice", "section": "aquaculture", "label_bn": "ফিডিং পরামর্শ", "path": "/aquaculture/feeding"},
    {"key": "aquaculture_medicine", "section": "aquaculture", "label_bn": "ঔষধ ও চিকিৎসা", "path": "/aquaculture/medicine"},
    {"key": "fish_sales", "section": "aquaculture", "label_bn": "পোন্ড মাছ বিক্রি", "path": "/aquaculture/sales"},
    {"key": "pond_expenses", "section": "aquaculture", "label_bn": "পোন্ড খরচ", "path": "/aquaculture/expenses"},
    {"key": "aquaculture_financing", "section": "aquaculture", "label_bn": "মৎস্য ফাইন্যান্সিং", "path": "/aquaculture/financing"},
    # Reports
    {"key": "reports", "section": "reports", "label_bn": "রিপোর্ট", "path": "/reports"},
]

SIDEBAR_MODULE_KEYS = {m["key"] for m in SIDEBAR_MODULES}
