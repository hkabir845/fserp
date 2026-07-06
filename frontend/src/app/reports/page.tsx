'use client'

import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyDateInput } from '@/components/CompanyDateInput'
import { useCompany } from '@/contexts/CompanyContext'
import { 
  FileText, TrendingUp, DollarSign, Users, Package, 
  BarChart3, Calendar, Download, Filter, RefreshCw, Printer,
  Gauge, Droplet,   ClipboardList, Layers, ShoppingCart, MapPin, Fish, Store,
  Scale, Landmark, Banknote, BookOpen, CreditCard,
  type LucideIcon,
} from 'lucide-react'
import {
  canAccessReport,
  canViewInventorySkuReport,
  getCurrentUserPermissions,
  hasPermission,
} from '@/utils/rbac'
import api, { getApiBaseUrl } from '@/lib/api'
import { formatDate, formatDateOnly, formatDateRange, localDateISO, toDateInputValue } from '@/utils/date'
import { formatAmountPlain, formatCurrency, formatNumber } from '@/utils/formatting'
import { escapeHtml, printDocument } from '@/utils/printDocument'
import type { PrintBranding } from '@/utils/printBranding'
import { loadPrintBranding } from '@/utils/printBranding'
import { useCenterActiveListItem } from '@/hooks/useCenterActiveListItem'
import { FinancialAnalyticsPanel } from './analytics/FinancialAnalyticsPanel'
import { AquaculturePlManagementPanel } from './aquaculture/AquaculturePlManagementPanel'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { AQ_HERO_BTN_GHOST, AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { usePageMeta } from '@/hooks/usePageMeta'
import { t as i18nT } from '@/lib/i18n'
import { localizeReportCard } from '@/lib/reportCatalogI18n'
import { getTenantLocaleConfig } from '@/utils/tenantLocale'
import {
  formatPondScopeKey,
  isPersistedReportSiteScopeKey,
  isValidReportSiteScopeKey,
  parseReportSiteScopeKey,
  resolveGrandTotalLabel,
  resolveReportTotalLabel,
  resolveEffectiveAquaculturePondId,
  isPondLockedBySiteScope,
} from './reportSiteScope'
import {
  inferSegmentFromHomeStation,
  parseReportBusinessSegment,
  REPORT_BUSINESS_SEGMENT_STORAGE_KEY,
  type ReportBusinessSegment,
  type ReportStationForSegment,
} from './reportBusinessSegment'
import { BusinessSegmentFilter } from './BusinessSegmentFilter'
import { ReportSiteScopeSelect } from '@/components/reports/ReportSiteScopeSelect'
import { SalesPurchasePeriodFilter } from './SalesPurchasePeriodFilter'
import {
  inferSalesPurchasePreset,
  persistSalesPurchasePeriod,
  loadStoredSalesPurchasePeriod,
  salesPurchaseRangeForPreset,
  SALES_PURCHASE_PERIOD_PRESETS,
  type SalesPurchasePeriodPreset,
} from './salesPurchasePeriod'
import { EXTRA_FINANCIAL_REPORT_IDS, renderExtraFinancialReport } from '@/components/reports/ExtraFinancialReportPanels'
import { ReportStructuredFallback } from '@/components/reports/ReportStructuredFallback'
import {
  DrillAmount,
  glAccountDrill,
  ReportDrillProvider,
  type ReportDrillTarget,
} from '@/components/reports/ReportDrillContext'
import { ReportAmountCell } from '@/components/reports/ReportAmountCell'
import {
  AquaculturePlCategoryMatrices,
  AquaculturePlConsumptionSection,
  AquaculturePlNetSummary,
  PlActiveExpenseCategoriesList,
  PlConsumptionCostsExpenses,
  PlPondByPondExpenseTable,
  resolvePlMgmtSnapshot,
} from '@/components/reports/AquaculturePlCategoryMatrices'
import {
  accountsTotalRow,
  agingBucketTotalRow,
  contactsTotalRow,
  documentsTotalRow,
  itemsTotalRow,
  loansTotalRow,
  scopedPlTotalRow,
} from '@/components/reports/reportDrillAggregate'
import {
  buildAquacultureGroupsCsv,
  buildAquaculturePrintHtml,
  buildFeedMedicineConsumptionCsv,
  buildExtraFinancialPrintHtml,
  buildExtraFinancialReportCsv,
  buildGenericPrintHtml,
  buildGenericTabularCsv,
} from '@/utils/reportExportHelpers'
import { AquacultureFeedMedicineConsumptionPanel } from '@/app/reports/aquaculture/AquacultureFeedMedicineConsumptionPanel'
import { extractErrorMessage } from '@/utils/errorHandler'

const SALES_PURCHASE_REPORT_IDS = new Set<ReportType>(['sales-report', 'purchase-report'])
const BUSINESS_LINE_REPORT_IDS = new Set<ReportType>([
  'sales-report',
  'purchase-report',
  'daily-summary',
])

/** Longer timeout for heavy GL / operational reports (especially with site filter). */
const REPORT_API_TIMEOUT_MS = 120_000

/** Reports rendered entirely in the browser — no `/api/reports/<id>/` call. */
const CLIENT_ONLY_REPORT_IDS = new Set<ReportType>(['analytics-kpi', 'aquaculture-pl-management'])

type ItemScopeTableProps = {
  reportType: ReportType
  category: string
  onCategoryChange: (v: string) => void
  selectedItemIds: number[]
  onToggleItem: (id: number) => void
  onSelectAllVisible: () => void
  onClearItems: () => void
  /** Items shown in the checkbox list (filtered by category when set). */
  visibleItemOptions: { id: number; name: string; item_number?: string; category?: string }[]
  categoryList: string[]
  fetchReport: (id: ReportType) => void | Promise<void>
}

type BusinessSegmentTableProps = {
  value: ReportBusinessSegment
  onChange: (segment: ReportBusinessSegment) => void
  stations: ReportStationForSegment[]
  lockedSegment: ReportBusinessSegment | null
}

type SalesPurchasePeriodTableProps = {
  dateRange: { startDate: string; endDate: string }
  preset: SalesPurchasePeriodPreset
  onPresetChange: (preset: SalesPurchasePeriodPreset) => void
  onDateChange: (field: 'startDate' | 'endDate', value: string) => void
}

type ReportScopeTableProps = {
  reportStationKey: string
  stations: { id: number; station_name: string }[]
  ponds: { id: number; name: string }[]
  aquaculturePondId: string
  onViewEntityPl?: (entityType: 'station' | 'pond', entityId: number) => void
  onLoansStrictSiteChange?: (strict: boolean) => void
}

type ReportType = 
  | 'trial-balance'
  | 'balance-sheet'
  | 'income-statement'
  | 'customer-balances'
  | 'vendor-balances'
  | 'ar-aging'
  | 'ap-aging'
  | 'cash-flow'
  | 'expense-detail'
  | 'income-detail'
  | 'stations-financial-summary'
  | 'fuel-stations-pl-summary'
  | 'shop-hubs-pl-summary'
  | 'ponds-pl-summary'
  | 'entities-pl-summary'
  | 'entities-balance-sheet-summary'
  | 'entities-trial-balance-summary'
  | 'entities-financial-summary'
  | 'liabilities-detail'
  | 'loan-receivable-gl'
  | 'loan-payable-gl'
  | 'loans-borrow-and-lent'
  | 'fuel-sales'
  | 'tank-inventory'
  | 'shift-summary'
  | 'tank-dip-variance'
  | 'tank-dip-register'
  | 'meter-readings'
  | 'sales-by-nozzle'
  | 'sales-by-station'
  | 'sales-by-products'
  | 'sales-report'
  | 'purchase-report'
  | 'daily-summary'
  | 'inventory-sku-valuation'
  | 'item-master-by-category'
  | 'item-sales-by-category'
  | 'item-purchases-by-category'
  | 'item-sales-custom'
  | 'item-purchases-custom'
  | 'item-stock-movement'
  | 'item-velocity-analysis'
  | 'item-purchase-velocity-analysis'
  | 'analytics-kpi'
  | 'aquaculture-pond-pl'
  | 'aquaculture-fish-sales'
  | 'aquaculture-pond-sales-comprehensive'
  | 'aquaculture-expenses'
  | 'aquaculture-feed-medicine-consumption'
  | 'aquaculture-sampling'
  | 'aquaculture-production-cycles'
  | 'aquaculture-profit-transfers'
  | 'aquaculture-fish-transfers'
  | 'aquaculture-fingerling-transfers'
  | 'aquaculture-pond-feed-stock'
  | 'aquaculture-pond-medicine-stock'
  | 'aquaculture-pond-supplies-stock'
  | 'aquaculture-fish-stock-position'
  | 'aquaculture-fish-stock-breakdown'
  | 'aquaculture-fish-biomass-movements'
  | 'aquaculture-fish-stock-adjustments'
  | 'aquaculture-biological-asset-ledger'
  | 'aquaculture-fcr-biomass'
  | 'aquaculture-fish-growth'
  | 'aquaculture-pond-performance'
  | 'aquaculture-shop-station-stock'
  | 'aquaculture-equipment-assets'
  | 'aquaculture-pond-total-inventory'
  | 'aquaculture-pl-management'

const ITEM_SCOPED_REPORT_IDS: readonly ReportType[] = [
  'inventory-sku-valuation',
  'item-sales-custom',
  'item-purchases-custom',
  'item-stock-movement',
  'item-velocity-analysis',
  'item-purchase-velocity-analysis',
] as const

interface ReportCard {
  id: ReportType
  title: string
  description: string
  icon: LucideIcon
  category: 'financial' | 'operational' | 'analytical' | 'inventory' | 'aquaculture'
}

const reports: ReportCard[] = [
  // Financial Reports (QuickBooks-Style)
  {
    id: 'trial-balance',
    title: 'Trial Balance',
    description: 'Posted debits and credits by account — optional site filter for multi-station GL',
    icon: BarChart3,
    category: 'financial'
  },
  {
    id: 'balance-sheet',
    title: 'Balance Sheet',
    description: 'Assets, liabilities, and equity as of period end — optional site filter',
    icon: FileText,
    category: 'financial'
  },
  {
    id: 'income-statement',
    title: 'Profit & Loss (P&L)',
    description:
      'Income (including sales), COGS (cost on sales), and expenses from posted GL — Site scope: one station/pond or All for company-wide',
    icon: TrendingUp,
    category: 'financial'
  },
  {
    id: 'customer-balances',
    title: 'Customer Balances',
    description: 'Current A/R balance per customer (subledger snapshot)',
    icon: Users,
    category: 'financial'
  },
  {
    id: 'ar-aging',
    title: 'Accounts Receivable Aging',
    description:
      'Open invoices by customer in aging buckets — filter by station or pond (pond POS customer)',
    icon: Users,
    category: 'financial'
  },
  {
    id: 'vendor-balances',
    title: 'Vendor Balances',
    description: 'Current A/P balance per vendor (subledger snapshot)',
    icon: Users,
    category: 'financial'
  },
  {
    id: 'ap-aging',
    title: 'Accounts Payable Aging',
    description:
      'Open vendor bills by vendor in aging buckets — filter by station or pond-tagged bill lines',
    icon: Users,
    category: 'financial'
  },
  {
    id: 'cash-flow',
    title: 'Cash Flow Summary',
    description: 'Company bank accounts plus cash flow by every station, pond, and head office (clear site filter)',
    icon: Banknote,
    category: 'financial'
  },
  {
    id: 'expense-detail',
    title: 'Expense Detail (GL)',
    description:
      'Operating expenses only (excludes COGS — use Profit & Loss for cost of goods sold) — optional site filter',
    icon: DollarSign,
    category: 'financial'
  },
  {
    id: 'income-detail',
    title: 'Income Detail (GL)',
    description:
      'Income accounts only (excludes COGS and operating expenses — use Profit & Loss for the full picture) — optional site filter',
    icon: TrendingUp,
    category: 'financial'
  },
  {
    id: 'entities-pl-summary',
    title: 'All Entities — P&L',
    description:
      'Each entity on its own row: fuel stations, shop hubs (no fuel), ponds, and head office — plus segment totals and company total',
    icon: TrendingUp,
    category: 'financial',
  },
  {
    id: 'entities-balance-sheet-summary',
    title: 'All Entities — Balance Sheet',
    description: 'Assets, liabilities, and equity as of period end for every station, pond, and head office',
    icon: FileText,
    category: 'financial',
  },
  {
    id: 'entities-trial-balance-summary',
    title: 'All Entities — Trial Balance',
    description: 'Posted debits and credits in the period for every station, pond, and head office',
    icon: BarChart3,
    category: 'financial',
  },
  {
    id: 'entities-financial-summary',
    title: 'All Entities — Financial (combined)',
    description:
      'P&L and balance sheet together for every station, pond, and head office (use separate entity reports for detail)',
    icon: FileText,
    category: 'financial',
  },
  {
    id: 'stations-financial-summary',
    title: 'All Stations — P&L Summary',
    description:
      'Individual P&L per station (fuel and shop hub without fuel as separate groups) plus stations total and company total',
    icon: MapPin,
    category: 'financial',
  },
  {
    id: 'fuel-stations-pl-summary',
    title: 'Fuel Stations — P&L Summary',
    description: 'Individual P&L per fuel filling station with category and company totals',
    icon: Droplet,
    category: 'financial',
  },
  {
    id: 'shop-hubs-pl-summary',
    title: 'Shop Hubs (no fuel) — P&L Summary',
    description: 'Individual P&L per shop/agro hub (station without fuel) with category and company totals',
    icon: Store,
    category: 'financial',
  },
  {
    id: 'ponds-pl-summary',
    title: 'All Ponds — P&L Summary (GL)',
    description:
      'Individual P&L per pond from posted GL plus ponds total and company total — use Site scope for one pond on other reports',
    icon: MapPin,
    category: 'financial',
  },
  {
    id: 'liabilities-detail',
    title: 'Liabilities (GL detail)',
    description: 'Every liability account on the chart with balance as of period end — open the GL ledger per line',
    icon: Scale,
    category: 'financial',
  },
  {
    id: 'loan-receivable-gl',
    title: 'Loan receivable (GL)',
    description: 'Loans receivable principal accounts (asset-side loan GL) with balances and ledger links',
    icon: Landmark,
    category: 'financial',
  },
  {
    id: 'loan-payable-gl',
    title: 'Loan payable (GL)',
    description: 'Loans payable principal accounts (liability-side loan GL) with balances and ledger links',
    icon: CreditCard,
    category: 'financial',
  },
  {
    id: 'loans-borrow-and-lent',
    title: 'Loans — borrowed & lent',
    description: 'Loan facilities: outstanding principal, period cash flows, and GL accounts (principal, bank, interest, accrual)',
    icon: Banknote,
    category: 'financial',
  },

  {
    id: 'inventory-sku-valuation',
    title: 'Inventory: Valuation & Velocity',
    description: 'Per-SKU on-hand, cost and list value, period sales, velocity, and days of cover',
    icon: Layers,
    category: 'inventory',
  },
  {
    id: 'item-master-by-category',
    title: 'Item catalog by category',
    description: 'All products with reporting category, POS class, and stock & value (snapshot)',
    icon: Package,
    category: 'inventory',
  },
  {
    id: 'item-sales-by-category',
    title: 'Sales by reporting category',
    description: 'Invoiced quantity and revenue in the period, grouped by item category',
    icon: BarChart3,
    category: 'inventory',
  },
  {
    id: 'item-purchases-by-category',
    title: 'Purchases by reporting category',
    description: 'Vendor bill quantity and amount in the period, grouped by item category',
    icon: ShoppingCart,
    category: 'inventory',
  },
  {
    id: 'item-sales-custom',
    title: 'Custom item sales (filtered)',
    description: 'Sales by SKU for the period; filter by category and one or more products',
    icon: Filter,
    category: 'inventory',
  },
  {
    id: 'item-purchases-custom',
    title: 'Custom item purchases (filtered)',
    description: 'Purchases by SKU from bills; filter by category and one or more products',
    icon: ShoppingCart,
    category: 'inventory',
  },
  {
    id: 'item-stock-movement',
    title: 'Stock movement (purchases vs sales)',
    description: 'Compare vendor receipts (bills) and customer sales in the range by product',
    icon: TrendingUp,
    category: 'inventory',
  },
  {
    id: 'item-velocity-analysis',
    title: 'Fast & slow movers (sales)',
    description: 'Per-SKU sales velocity; fast / medium / slow tiers and items with no sales in range',
    icon: BarChart3,
    category: 'inventory',
  },
  {
    id: 'item-purchase-velocity-analysis',
    title: 'Fast & slow purchases',
    description: 'Per-SKU purchase volume from bills; fast / medium / slow and items not bought in range',
    icon: ShoppingCart,
    category: 'inventory',
  },
  
  // Operational Reports (Filling Station)
  {
    id: 'daily-summary',
    title: 'Daily Summary',
    description:
      'Fuel forecourt vs aquaculture shop (Premium Agro): sales, shifts, dips, tanks, and POS categories',
    icon: Calendar,
    category: 'operational'
  },
  {
    id: 'shift-summary',
    title: 'Shift Summary',
    description: 'Cashier performance and cash reconciliation',
    icon: Users,
    category: 'operational'
  },
  {
    id: 'sales-by-nozzle',
    title: 'Sales by Nozzle',
    description: 'Nozzle performance and activity',
    icon: Package,
    category: 'operational'
  },
  {
    id: 'sales-by-station',
    title: 'Sales by station',
    description: 'Invoice totals by selling location (POS / invoice station)',
    icon: MapPin,
    category: 'operational'
  },
  {
    id: 'sales-by-products',
    title: 'Sales by Products',
    description: 'Product sales with quantity, price, cost, and profit — cash vs credit',
    icon: Package,
    category: 'operational'
  },
  {
    id: 'sales-report',
    title: 'Sales Report',
    description:
      'Sales by customer (cash vs credit). Filter by shop site — e.g. Premium Agro — for aquaculture POS and retail',
    icon: CreditCard,
    category: 'operational'
  },
  {
    id: 'purchase-report',
    title: 'Purchase Report',
    description:
      'Purchases by vendor (cash vs credit). Filter by shop receipt site — e.g. Premium Agro feed & supplies',
    icon: ShoppingCart,
    category: 'operational'
  },
  {
    id: 'fuel-sales',
    title: 'Fuel Sales Analytics',
    description: 'Sales trends and volume analysis',
    icon: TrendingUp,
    category: 'operational'
  },
  {
    id: 'tank-inventory',
    title: 'Tank Inventory',
    description: 'Current stock levels by tank',
    icon: Package,
    category: 'operational'
  },
  {
    id: 'tank-dip-register',
    title: 'Tank Dip Register',
    description: 'Chronological stick readings vs book (audit trail)',
    icon: ClipboardList,
    category: 'operational'
  },
  
  // Analytical Reports
  {
    id: 'analytics-kpi',
    title: 'Analytics & KPIs',
    description:
      'Charts for company, every station, and every pond — sales, COGS, expenses, net income, and aquaculture register totals (clear site filter for entity breakdowns).',
    icon: TrendingUp,
    category: 'analytical',
  },
  {
    id: 'tank-dip-variance',
    title: 'Tank Dip Variance',
    description: 'Gain/Loss analysis from dip readings',
    icon: TrendingUp,
    category: 'analytical'
  },
  {
    id: 'meter-readings',
    title: 'Meter Readings',
    description: 'Meter activity and dispensing stats',
    icon: BarChart3,
    category: 'analytical'
  },

  // Aquaculture — biomass sampling & pond stock, then sales / finance / warehouse
  {
    id: 'aquaculture-sampling',
    title: 'Aquaculture — Biomass sampling register',
    description:
      'Net samples by pond: fish count, weight, pcs/kg, extrapolated pond biomass, book reference, and market valuation',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-fish-growth',
    title: 'Aquaculture — Fish growth & sample intervals',
    description:
      'Sample-to-sample growth intervals with ADG, interval FCR, period summary, and pond density (kg per decimal)',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-fcr-biomass',
    title: 'Aquaculture — FCR, feed & pond load',
    description: 'Feed conversion ratio from recorded feed and sampling biomass; kg per decimal and partial harvest hints',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-fish-stock-position',
    title: 'Aquaculture — Fish stock by pond',
    description:
      'Present biological fish per pond: stocked, sold, mortality, adjustments, latest sample, load, and harvest hints',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-fish-stock-breakdown',
    title: 'Aquaculture — Fish stock by batch & species',
    description:
      'Stock position split by production cycle and species — stocked minus outflows equals present (kg and head count)',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-fish-biomass-movements',
    title: 'Aquaculture — Fish biomass movements',
    description:
      'All fish biomass transactions in the period: stocking bills, transfers, sales, mortality, and manual adjustments',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-biological-asset-ledger',
    title: 'Aquaculture — Biological asset ledger',
    description:
      'Pond biological asset value (fry + feed + labour + direct costs), cost per fish/kg, cost buckets, and movement ledger as of period end',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-fish-stock-adjustments',
    title: 'Aquaculture — Mortality & stock adjustments',
    description:
      'Stock ledger entries for mortality losses and manual count/weight corrections, grouped by pond with GL reference',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-pl-management',
    title: 'Aquaculture — P&L: site & ponds',
    description:
      'Management P&L by pond (revenue, costs, profit transfers) plus optional fuel-site posted GL income statement',
    icon: BarChart3,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-fish-sales',
    title: 'Aquaculture — Pond sales register',
    description: 'Fish harvest plus sacks, scrap, and other pond income lines by pond with sub-totals (BDT)',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-pond-sales-comprehensive',
    title: 'Aquaculture — All pond revenue (fish + pond POS)',
    description:
      'Registered pond income (all types) plus General POS / invoice lines to each pond POS customer; motor-fuel lines excluded',
    icon: Store,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-pond-pl',
    title: 'Aquaculture — Pond P&L',
    description:
      'One row per pond (leave pond filter empty) or drill into a single pond — revenue, costs, and profit',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-feed-medicine-consumption',
    title: 'Aquaculture — Feed & medicine consumption',
    description:
      'Feed and medicine used from pond warehouses in the period — quantities, cost per entry, and totals by pond (BDT)',
    icon: Package,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-expenses',
    title: 'Aquaculture — Expense register',
    description: 'Operating expenses by pond and shared allocations with sub-totals (BDT)',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-production-cycles',
    title: 'Aquaculture — Production cycles',
    description: 'Production batches overlapping the period, grouped by pond with sub-totals',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-profit-transfers',
    title: 'Aquaculture — Pond profit transfers',
    description: 'GL transfers by pond with sub-totals and period total (BDT)',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-fish-transfers',
    title: 'Aquaculture — Inter-pond fish transfers',
    description: 'Fish moves between ponds with weight, head count, and cost allocation (BDT)',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-fingerling-transfers',
    title: 'Aquaculture — Fingerling transfers (nursing → grow-out)',
    description:
      'Nursing pond fingerling moves: species, fish count, pcs/kg, fry purchase + other costs, receiving pond liability, and balanced reconciliation',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-pond-total-inventory',
    title: 'Aquaculture — Pond total inventory & value',
    description:
      'Complete per-pond value: warehouse feed, medicine, supplies, live fish, fry SKU, and equipment/assets (BDT)',
    icon: Scale,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-pond-feed-stock',
    title: 'Aquaculture — Pond feed stock',
    description: 'On-hand feed in each pond warehouse with quantity and inventory value (snapshot)',
    icon: Package,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-pond-medicine-stock',
    title: 'Aquaculture — Pond medicine stock',
    description: 'On-hand medicine and pond-care products at ponds with quantities and value',
    icon: Package,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-pond-supplies-stock',
    title: 'Aquaculture — Pond supplies stock',
    description: 'Other inventoried materials at pond warehouses (nets, tools, general supplies)',
    icon: Package,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-pond-performance',
    title: 'Aquaculture — Pond performance dashboard',
    description:
      'All ponds: FCR, load, ADG, live biomass, and bioasset (GL 1581) with pond and period filters',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-shop-station-stock',
    title: 'Aquaculture — Shop / station inventory',
    description: 'Feed, medicine, fry SKUs, and supplies on hand at shop stations before transfer to ponds',
    icon: Store,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-equipment-assets',
    title: 'Aquaculture — Equipment & assets',
    description:
      'Aerators, boats, nets, tools, and similar purchases (equipment, repair, miscellaneous expenses)',
    icon: Layers,
    category: 'aquaculture',
  },
]

function isApiBackedReportId(reportId: string): reportId is ReportType {
  if (CLIENT_ONLY_REPORT_IDS.has(reportId as ReportType)) return false
  return reports.some((r) => r.id === reportId)
}

const SUMMARY_EXCLUDED_REPORTS: ReportType[] = [
  'daily-summary',
  'shift-summary',
  'sales-by-nozzle',
  'tank-dip-variance',
  'tank-dip-register',
  'meter-readings',
  'inventory-sku-valuation',
  'loans-borrow-and-lent',
]

/** All aquaculture module reports (for Mix tab, permission gating, company module flag). */
const AQUACULTURE_REPORT_ID_SET = new Set<ReportType>([
  'aquaculture-pl-management',
  'aquaculture-pond-pl',
  'aquaculture-fish-sales',
  'aquaculture-pond-sales-comprehensive',
  'aquaculture-expenses',
  'aquaculture-feed-medicine-consumption',
  'aquaculture-sampling',
  'aquaculture-production-cycles',
  'aquaculture-profit-transfers',
  'aquaculture-fish-transfers',
  'aquaculture-fingerling-transfers',
  'aquaculture-pond-feed-stock',
  'aquaculture-pond-medicine-stock',
  'aquaculture-pond-supplies-stock',
  'aquaculture-fish-stock-position',
  'aquaculture-fish-stock-breakdown',
  'aquaculture-fish-biomass-movements',
  'aquaculture-fish-stock-adjustments',
  'aquaculture-biological-asset-ledger',
  'aquaculture-fcr-biomass',
  'aquaculture-fish-growth',
  'aquaculture-pond-performance',
  'aquaculture-shop-station-stock',
  'aquaculture-equipment-assets',
  'aquaculture-pond-total-inventory',
])

/** Mix — Fuel & Aquaculture: core GL + fuel ops + every aquaculture report (when role allows). */
const MIX_FUEL_AQUACULTURE_REPORT_IDS: readonly ReportType[] = [
  'trial-balance',
  'balance-sheet',
  'income-statement',
  'customer-balances',
  'vendor-balances',
  'ar-aging',
  'ap-aging',
  'cash-flow',
  'expense-detail',
  'income-detail',
  'entities-pl-summary',
  'entities-balance-sheet-summary',
  'entities-trial-balance-summary',
  'entities-financial-summary',
  'stations-financial-summary',
  'fuel-stations-pl-summary',
  'shop-hubs-pl-summary',
  'ponds-pl-summary',
  'daily-summary',
  'fuel-sales',
  'sales-by-station',
  'sales-by-products',
  'sales-report',
  'purchase-report',
  'shift-summary',
  'aquaculture-pl-management',
  'aquaculture-fish-sales',
  'aquaculture-pond-sales-comprehensive',
  'aquaculture-pond-pl',
  'aquaculture-expenses',
  'aquaculture-feed-medicine-consumption',
  'aquaculture-sampling',
  'aquaculture-production-cycles',
  'aquaculture-profit-transfers',
  'aquaculture-fish-transfers',
  'aquaculture-fingerling-transfers',
  'aquaculture-pond-feed-stock',
  'aquaculture-pond-medicine-stock',
  'aquaculture-pond-supplies-stock',
  'aquaculture-fish-stock-position',
  'aquaculture-fish-stock-breakdown',
  'aquaculture-fish-biomass-movements',
  'aquaculture-fish-stock-adjustments',
  'aquaculture-biological-asset-ledger',
  'aquaculture-fcr-biomass',
  'aquaculture-fish-growth',
  'aquaculture-pond-performance',
  'aquaculture-shop-station-stock',
  'aquaculture-equipment-assets',
  'aquaculture-pond-total-inventory',
] as const

/** Aquaculture reports also listed under Analytical (ponds + sales KPIs). */
const ANALYTICAL_POND_REPORT_IDS: readonly ReportType[] = [
  'aquaculture-pond-pl',
  'aquaculture-fish-sales',
  'aquaculture-pond-sales-comprehensive',
] as const

/** Reports that accept optional `station_id` (all sites when empty; home-station users are always scoped in API). */
const REPORTS_STATION_SCOPED = new Set<ReportType>([
  'trial-balance',
  'balance-sheet',
  'income-statement',
  'cash-flow',
  'expense-detail',
  'income-detail',
  'liabilities-detail',
  'loan-receivable-gl',
  'loan-payable-gl',
  'loans-borrow-and-lent',
  'fuel-sales',
  'tank-inventory',
  'shift-summary',
  'daily-summary',
  'sales-by-station',
  'sales-by-products',
  'sales-report',
  'purchase-report',
  'sales-by-nozzle',
  'meter-readings',
  'tank-dip-variance',
  'tank-dip-register',
  'inventory-sku-valuation',
  'item-master-by-category',
  'item-sales-by-category',
  'item-purchases-by-category',
  'item-sales-custom',
  'item-purchases-custom',
  'item-stock-movement',
  'item-velocity-analysis',
  'item-purchase-velocity-analysis',
  'aquaculture-shop-station-stock',
  'customer-balances',
  'vendor-balances',
  'ar-aging',
  'ap-aging',
])

/** GL reports that accept optional pond_id when Site scope is a pond (p:{id}). */
const REPORTS_GL_POND_SCOPED = new Set<ReportType>([
  'trial-balance',
  'income-statement',
  'balance-sheet',
  'expense-detail',
  'income-detail',
  'cash-flow',
])

/** AR/AP subledger reports that accept pond_id (pond POS customer / pond-tagged bills). */
const REPORTS_SUBLEDGER_POND_SCOPED = new Set<ReportType>([
  'customer-balances',
  'vendor-balances',
  'ar-aging',
  'ap-aging',
])

/** Subset of station-scoped reports where amounts come from posted GL lines (not invoice subledgers). */
const REPORTS_GL_STATION_SCOPED = new Set<ReportType>([
  'trial-balance',
  'balance-sheet',
  'income-statement',
  'cash-flow',
  'expense-detail',
  'income-detail',
  'liabilities-detail',
  'loan-receivable-gl',
  'loan-payable-gl',
  'loans-borrow-and-lent',
])

/** Single source of truth: APIs that accept `start_date` / `end_date` (used for fetch + period UI). */
const REPORTS_WITH_PERIOD = new Set<ReportType>([
  'trial-balance',
  'balance-sheet',
  'income-statement',
  'liabilities-detail',
  'loan-receivable-gl',
  'loan-payable-gl',
  'loans-borrow-and-lent',
  'customer-balances',
  'vendor-balances',
  'ar-aging',
  'ap-aging',
  'cash-flow',
  'expense-detail',
  'income-detail',
  'entities-pl-summary',
  'entities-balance-sheet-summary',
  'entities-trial-balance-summary',
  'entities-financial-summary',
  'stations-financial-summary',
  'fuel-stations-pl-summary',
  'shop-hubs-pl-summary',
  'ponds-pl-summary',
  'daily-summary',
  'shift-summary',
  'sales-by-nozzle',
  'sales-by-station',
  'sales-by-products',
  'sales-report',
  'purchase-report',
  'fuel-sales',
  'tank-inventory',
  'tank-dip-variance',
  'tank-dip-register',
  'meter-readings',
  'inventory-sku-valuation',
  'item-master-by-category',
  'item-sales-by-category',
  'item-purchases-by-category',
  'item-sales-custom',
  'item-purchases-custom',
  'item-stock-movement',
  'item-velocity-analysis',
  'item-purchase-velocity-analysis',
  'aquaculture-pond-pl',
  'aquaculture-fish-sales',
  'aquaculture-pond-sales-comprehensive',
  'aquaculture-expenses',
  'aquaculture-feed-medicine-consumption',
  'aquaculture-sampling',
  'aquaculture-production-cycles',
  'aquaculture-profit-transfers',
  'aquaculture-fish-transfers',
  'aquaculture-fingerling-transfers',
  'aquaculture-pond-feed-stock',
  'aquaculture-pond-medicine-stock',
  'aquaculture-pond-supplies-stock',
  'aquaculture-fish-stock-position',
  'aquaculture-fish-stock-breakdown',
  'aquaculture-fish-biomass-movements',
  'aquaculture-fish-stock-adjustments',
  'aquaculture-biological-asset-ledger',
  'aquaculture-fcr-biomass',
  'aquaculture-fish-growth',
  'aquaculture-pond-performance',
  'aquaculture-shop-station-stock',
  'aquaculture-equipment-assets',
  'aquaculture-pond-total-inventory',
])

/** In-report + export label for which site(s) a station-scoped report covers. */
function getReportSiteScopeDisplay(
  reportId: ReportType | null,
  reportData:
    | { filter_station_id?: number; filter_pond_id?: number; filter_pond_name?: string }
    | null
    | undefined,
  stations: { id: number; station_name: string }[],
  userHasHomeStation: boolean,
  homeStationId: number | null,
  homeStationName: string | null,
  reportStationId: string,
  ponds: { id: number; name: string }[] = []
): { headline: string; detail: string } | null {
  if (!reportId || !REPORTS_STATION_SCOPED.has(reportId)) return null
  const gl = REPORTS_GL_STATION_SCOPED.has(reportId)
  const rawPondFid =
    reportData && typeof reportData === 'object' && 'filter_pond_id' in reportData
      ? (reportData as { filter_pond_id?: unknown }).filter_pond_id
      : undefined
  const pondFid = typeof rawPondFid === 'number' && rawPondFid > 0 ? rawPondFid : undefined
  if (pondFid != null) {
    const fromApi =
      reportData && typeof reportData === 'object' && 'filter_pond_name' in reportData
        ? String((reportData as { filter_pond_name?: unknown }).filter_pond_name || '').trim()
        : ''
    const name =
      fromApi || ponds.find((p) => p.id === pondFid)?.name?.trim() || `Pond #${pondFid}`
    return {
      headline: `Pond: ${name}`,
      detail: gl ? 'Posted GL lines for this pond only (income, COGS, expenses).' : 'This pond only.',
    }
  }
  const rawFid = reportData && typeof reportData === 'object' && 'filter_station_id' in reportData
    ? (reportData as { filter_station_id?: unknown }).filter_station_id
    : undefined
  const fid = typeof rawFid === 'number' && rawFid > 0 ? rawFid : undefined
  if (fid != null) {
    const name = stations.find((s) => s.id === fid)?.station_name?.trim() || `Station #${fid}`
    return {
      headline: `Site: ${name}`,
      detail: gl
        ? 'Posted GL for this site only (income, COGS from sales, expenses).'
        : 'This site only.',
    }
  }
  if (userHasHomeStation) {
    const name =
      (homeStationName && homeStationName.trim()) ||
      (homeStationId != null ? stations.find((s) => s.id === homeStationId)?.station_name?.trim() : undefined) ||
      (homeStationId != null ? `Station #${homeStationId}` : 'Assigned site')
    return {
      headline: `Site: ${name}`,
      detail: gl ? 'Limited to your assigned site (GL).' : 'Limited to your assigned site.',
    }
  }
  const scope = parseReportSiteScopeKey(reportStationId)
  if (scope.kind === 'pond') {
    const name = ponds.find((p) => p.id === scope.id)?.name?.trim() || `Pond #${scope.id}`
    return {
      headline: `Pond: ${name}`,
      detail: gl ? 'Pond scope · posted GL for this pond only.' : 'Pond scope filter.',
    }
  }
  if (scope.kind === 'station') {
    const name =
      stations.find((s) => s.id === scope.id)?.station_name?.trim() || `Station #${scope.id}`
    return {
      headline: `Site: ${name}`,
      detail: gl
        ? 'Site scope · income, COGS, and expenses for this site only.'
        : 'Site scope filter.',
    }
  }
  return {
    headline: 'All sites',
    detail: gl
      ? 'All sites · company-wide income, COGS, and expenses from posted GL.'
      : 'All sites · use Site scope to narrow.',
  }
}

function getAquacultureReportScopeDisplay(
  reportStationId: string,
  stations: { id: number; station_name: string }[],
  ponds: { id: number; name: string }[],
  effectivePondId: string
): { headline: string; detail: string } {
  if (effectivePondId && /^\d+$/.test(effectivePondId)) {
    const id = parseInt(effectivePondId, 10)
    const name = ponds.find((p) => p.id === id)?.name?.trim() || `Pond #${id}`
    return { headline: `Pond: ${name}`, detail: 'This report shows this pond only.' }
  }
  const scope = parseReportSiteScopeKey(reportStationId)
  if (scope.kind === 'station') {
    const name =
      stations.find((s) => s.id === scope.id)?.station_name?.trim() || `Station #${scope.id}`
    return {
      headline: `Site: ${name}`,
      detail: 'Shop/station filter applies to shop inventory reports; pond lists show all ponds unless a pond is selected.',
    }
  }
  return { headline: 'All ponds', detail: 'Company-wide aquaculture totals for every pond.' }
}

/** Scope label for Sales / Purchase reports (business line — not the global Site picker). */
function getSalesPurchaseScopeDisplay(
  reportData: { business_segment?: string; business_segment_label?: string; business_segment_station_names?: string[] } | null | undefined,
  userHasHomeStation: boolean
): { headline: string; detail: string } | null {
  if (!reportData || typeof reportData !== 'object') return null

  const segment = (reportData.business_segment || 'all').toLowerCase()
  const label = (reportData.business_segment_label || '').trim()
  const names = Array.isArray(reportData.business_segment_station_names)
    ? reportData.business_segment_station_names.filter(Boolean)
    : []
  const nameList = names.length > 0 ? names.join(', ') : ''

  if (segment === 'fuel') {
    return {
      headline: label || 'Fuel Station',
      detail: nameList ? `Forecourt at ${nameList}.` : 'Fuel forecourt only.',
    }
  }
  if (segment === 'aquaculture') {
    return {
      headline: label || 'Aquaculture (Premium Agro)',
      detail: nameList ? `Shop hub at ${nameList}.` : 'Aquaculture shop hub only.',
    }
  }
  if (segment === 'single') {
    return {
      headline: label ? `Business line: ${label}` : 'Assigned site',
      detail: userHasHomeStation
        ? 'Limited to your assigned site.'
        : nameList
          ? `${nameList} only.`
          : 'Selected site only.',
    }
  }
  return {
    headline: 'All business lines',
    detail: 'Company-wide fuel and aquaculture totals.',
  }
}

function printMoney(value: unknown, fallback: unknown = 0): number {
  const raw = value ?? fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function buildDailySummaryLinePrintHtml(bl: Record<string, unknown>): string {
  const isFuel = bl.line === 'fuel'
  const sales = (bl.sales || {}) as Record<string, unknown>
  const shifts = (bl.shifts || {}) as Record<string, unknown>
  const dips = (bl.dips || {}) as Record<string, unknown>
  const tanks = Array.isArray(bl.tanks) ? bl.tanks : []
  const byFuel = (bl.by_product_fuel || {}) as Record<string, { line_count?: number; liters?: number; amount?: number }>
  const byCat = (bl.by_pos_category || {}) as Record<string, { line_count?: number; quantity?: number; amount?: number }>
  const aq = (bl.aquaculture || {}) as Record<string, unknown>
  const stationLabel = Array.isArray(bl.station_names) ? (bl.station_names as string[]).join(', ') : ''
  const label = String(bl.label || (isFuel ? 'Fuel Station' : 'Aquaculture (Premium Agro)'))

  let html = `<h2>${escapeHtml(label)}</h2>`
  if (stationLabel) {
    html += `<p><em>${escapeHtml(stationLabel)}</em></p>`
  }
  html += '<table><tbody>'
  html += `<tr><td><strong>Transactions</strong></td><td>${sales.total_transactions ?? 0}</td></tr>`
  if (isFuel) {
    html += `<tr><td><strong>Fuel liters</strong></td><td>${formatNumber(Number(sales.total_liters ?? 0))} L</td></tr>`
    html += `<tr><td><strong>Fuel sales</strong></td><td>${formatCurrency(printMoney(sales.fuel_amount, sales.total_amount))}</td></tr>`
    html += `<tr><td><strong>Shop / other</strong></td><td>${formatCurrency(printMoney(sales.shop_amount))}</td></tr>`
    html += `<tr><td><strong>Cash sales</strong></td><td>${formatCurrency(printMoney(sales.cash_sales_total))}</td></tr>`
    html += `<tr><td><strong>Shifts</strong></td><td>${shifts.total_shifts ?? 0}</td></tr>`
    html += `<tr><td><strong>Cash variance</strong></td><td>${formatCurrency(printMoney(shifts.total_cash_variance))}</td></tr>`
    html += `<tr><td><strong>Dip readings</strong></td><td>${dips.total_readings ?? 0}</td></tr>`
    html += `<tr><td><strong>Net dip variance (L)</strong></td><td>${formatNumber(Number(dips.net_variance_liters ?? dips.net_variance ?? 0))}</td></tr>`
  } else {
    html += `<tr><td><strong>Shop sales</strong></td><td>${formatCurrency(printMoney(sales.shop_amount, sales.total_amount))}</td></tr>`
    html += `<tr><td><strong>Cash (walk-in)</strong></td><td>${formatCurrency(printMoney(sales.cash_sales_total))}</td></tr>`
    html += `<tr><td><strong>Credit (pond POS)</strong></td><td>${formatCurrency(printMoney(sales.credit_sales_total))}</td></tr>`
    html += `<tr><td><strong>Pond POS invoices</strong></td><td>${aq.pond_pos_invoice_count ?? 0}</td></tr>`
    html += `<tr><td><strong>Pond POS total</strong></td><td>${formatCurrency(printMoney(aq.pond_pos_sales_total))}</td></tr>`
    html += `<tr><td><strong>Average sale</strong></td><td>${formatCurrency(printMoney(sales.average_sale))}</td></tr>`
  }
  html += '</tbody></table>'

  const fuelKeys = Object.keys(byFuel)
  if (isFuel && fuelKeys.length > 0) {
    html +=
      '<h3>Fuel by product</h3><table><thead><tr><th>Product</th><th style="text-align:right">Lines</th><th style="text-align:right">Liters</th><th style="text-align:right">Amount</th></tr></thead><tbody>'
    fuelKeys.forEach((k) => {
      const m = byFuel[k]
      html += `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${m.line_count ?? 0}</td><td style="text-align:right">${formatNumber(Number(m.liters ?? 0))}</td><td style="text-align:right">${formatCurrency(m.amount ?? 0)}</td></tr>`
    })
    html += '</tbody></table>'
  }

  const catKeys = Object.keys(byCat)
  if (!isFuel && catKeys.length > 0) {
    html +=
      '<h3>Sales by product category (POS)</h3><table><thead><tr><th>Category</th><th style="text-align:right">Lines</th><th style="text-align:right">Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>'
    catKeys.forEach((k) => {
      const m = byCat[k]
      html += `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${m.line_count ?? 0}</td><td style="text-align:right">${formatNumber(Number(m.quantity ?? 0))}</td><td style="text-align:right">${formatCurrency(m.amount ?? 0)}</td></tr>`
    })
    html += '</tbody></table>'
  }

  if (isFuel && tanks.length > 0) {
    html +=
      '<h3>Tank levels</h3><table><thead><tr><th>Tank</th><th>Product</th><th style="text-align:right">Capacity</th><th style="text-align:right">Stock</th><th style="text-align:right">Fill %</th></tr></thead><tbody>'
    tanks.forEach((tank: Record<string, unknown>) => {
      html += `<tr><td>${escapeHtml(String(tank.tank_name ?? ''))}</td><td>${escapeHtml(String(tank.product ?? ''))}</td><td style="text-align:right">${Number(tank.capacity ?? 0).toLocaleString()}</td><td style="text-align:right">${Number(tank.current_stock ?? 0).toLocaleString()}</td><td style="text-align:right">${formatNumber(Number(tank.fill_percentage ?? 0))}%</td></tr>`
    })
    html += '</tbody></table>'
  }

  return html
}

function buildDailySummaryPrintHtml(reportData: Record<string, unknown>): string {
  const businessLines: Record<string, unknown>[] = Array.isArray(reportData.business_lines)
    ? (reportData.business_lines as Record<string, unknown>[])
    : []
  const sales = (reportData.sales || {}) as Record<string, unknown>
  let html = ''

  if (businessLines.length > 1) {
    html += '<h2>Company total</h2><table><tbody>'
    html += `<tr><td><strong>Total transactions</strong></td><td>${sales.total_transactions ?? 0}</td></tr>`
    html += `<tr><td><strong>Total amount</strong></td><td>${formatCurrency(printMoney(sales.total_amount))}</td></tr>`
    if (Number(sales.total_liters ?? 0) > 0) {
      html += `<tr><td><strong>Total fuel liters</strong></td><td>${formatNumber(Number(sales.total_liters ?? 0))} L</td></tr>`
    }
    html += '</tbody></table>'
  }

  if (businessLines.length > 0) {
    businessLines.forEach((bl) => {
      html += buildDailySummaryLinePrintHtml(bl)
    })
  } else {
    html += buildDailySummaryLinePrintHtml({
      line: 'fuel',
      label: 'Operations',
      sales: reportData.sales || {},
      shifts: reportData.shifts || {},
      dips: reportData.dips || {},
      tanks: reportData.tanks || [],
      by_product_fuel: (reportData.sales as Record<string, unknown> | undefined)?.by_product || {},
      by_pos_category: {},
      aquaculture: {},
    })
  }

  if (reportData.accounting_note) {
    html += `<p><em>${escapeHtml(String(reportData.accounting_note))}</em></p>`
  }
  return html
}

function buildDailySummaryCsv(reportData: Record<string, unknown>): string {
  const csvEscape = (value: unknown): string => {
    if (value === null || value === undefined) return '""'
    const str = String(value).replace(/"/g, '""')
    return `"${str}"`
  }
  const businessLines: Record<string, unknown>[] = Array.isArray(reportData.business_lines)
    ? (reportData.business_lines as Record<string, unknown>[])
    : []
  const lines: string[] = ['Business line,Metric,Value']

  const pushRow = (lineLabel: string, metric: string, value: string | number) => {
    lines.push([csvEscape(lineLabel), csvEscape(metric), csvEscape(String(value))].join(','))
  }

  if (businessLines.length > 1) {
    const sales = (reportData.sales || {}) as Record<string, unknown>
    pushRow('Company total', 'Transactions', printMoney(sales.total_transactions))
    pushRow('Company total', 'Total amount', printMoney(sales.total_amount))
    if (Number(sales.total_liters ?? 0) > 0) {
      pushRow('Company total', 'Fuel liters', printMoney(sales.total_liters))
    }
  }

  const exportLine = (bl: Record<string, unknown>) => {
    const isFuel = bl.line === 'fuel'
    const label = String(bl.label || (isFuel ? 'Fuel Station' : 'Aquaculture (Premium Agro)'))
    const sales = (bl.sales || {}) as Record<string, unknown>
    const shifts = (bl.shifts || {}) as Record<string, unknown>
    const dips = (bl.dips || {}) as Record<string, unknown>
    const aq = (bl.aquaculture || {}) as Record<string, unknown>

    pushRow(label, 'Transactions', printMoney(sales.total_transactions))
    if (isFuel) {
      pushRow(label, 'Fuel liters', printMoney(sales.total_liters))
      pushRow(label, 'Fuel sales', printMoney(sales.fuel_amount, sales.total_amount))
      pushRow(label, 'Shop / other', printMoney(sales.shop_amount))
      pushRow(label, 'Cash sales', printMoney(sales.cash_sales_total))
      pushRow(label, 'Shifts', printMoney(shifts.total_shifts))
      pushRow(label, 'Cash variance', printMoney(shifts.total_cash_variance))
      pushRow(label, 'Dip readings', printMoney(dips.total_readings))
      pushRow(label, 'Net dip variance (L)', printMoney(dips.net_variance_liters, dips.net_variance))
      const byFuel = (bl.by_product_fuel || {}) as Record<string, { line_count?: number; liters?: number; amount?: number }>
      Object.entries(byFuel).forEach(([name, m]) => {
        pushRow(label, `Fuel product: ${name} (L)`, m.liters ?? 0)
        pushRow(label, `Fuel product: ${name} (amount)`, m.amount ?? 0)
      })
    } else {
      pushRow(label, 'Shop sales', printMoney(sales.shop_amount, sales.total_amount))
      pushRow(label, 'Cash (walk-in)', printMoney(sales.cash_sales_total))
      pushRow(label, 'Credit (pond POS)', printMoney(sales.credit_sales_total))
      pushRow(label, 'Pond POS invoices', printMoney(aq.pond_pos_invoice_count))
      pushRow(label, 'Pond POS total', printMoney(aq.pond_pos_sales_total))
      pushRow(label, 'Average sale', printMoney(sales.average_sale))
      const byCat = (bl.by_pos_category || {}) as Record<string, { line_count?: number; quantity?: number; amount?: number }>
      Object.entries(byCat).forEach(([cat, m]) => {
        pushRow(label, `POS category: ${cat} (qty)`, m.quantity ?? 0)
        pushRow(label, `POS category: ${cat} (amount)`, m.amount ?? 0)
      })
    }
  }

  if (businessLines.length > 0) {
    businessLines.forEach(exportLine)
  } else {
    exportLine({
      line: 'fuel',
      label: 'Operations',
      sales: reportData.sales || {},
      shifts: reportData.shifts || {},
      dips: reportData.dips || {},
      by_product_fuel: (reportData.sales as Record<string, unknown> | undefined)?.by_product || {},
      by_pos_category: {},
      aquaculture: {},
    })
  }

  return lines.join('\n')
}

type ReportScopeExportData = {
  filter_station_id?: number
  business_segment?: string
  business_segment_label?: string
  business_segment_station_names?: string[]
}

function getReportScopeForExport(
  reportId: ReportType | null,
  reportData: ReportScopeExportData | null | undefined,
  stations: { id: number; station_name: string }[],
  userHasHomeStation: boolean,
  homeStationId: number | null,
  homeStationName: string | null,
  reportStationId: string,
  ponds: { id: number; name: string }[] = []
): { headline: string; detail: string; prefix: string } | null {
  if (reportId && BUSINESS_LINE_REPORT_IDS.has(reportId)) {
    const sp = getSalesPurchaseScopeDisplay(reportData, userHasHomeStation)
    return sp ? { ...sp, prefix: 'Business line' } : null
  }
  const site = getReportSiteScopeDisplay(
    reportId,
    reportData,
    stations,
    userHasHomeStation,
    homeStationId,
    homeStationName,
    reportStationId,
    ponds
  )
  return site ? { ...site, prefix: 'Site scope' } : null
}

export default function ReportsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pageMeta = usePageMeta()
  const { selectedCompany } = useCompany()
  const { language: companyLang } = useCompanyLocale()
  /** Legal / display name for print & CSV — from API (same tenant as reports). */
  const [reportCompanyLabel, setReportCompanyLabel] = useState('')
  const [reportPrintBranding, setReportPrintBranding] = useState<PrintBranding | null>(null)
  const [selectedReport, setSelectedReport] = useState<ReportType | null>(null)
  const [reportData, setReportData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  /** false until `user` is read in an effect — keeps report list in sync with SSR (no localStorage on server). */
  const [reportRbacHydrated, setReportRbacHydrated] = useState(false)
  const [dateRange, setDateRange] = useState({
    startDate: localDateISO(),
    endDate: localDateISO(),
  })
  const [filterCategory, setFilterCategory] = useState<
    'all' | 'mix' | 'financial' | 'operational' | 'analytical' | 'inventory' | 'aquaculture'
  >('all')

  const [aquaculturePondId, setAquaculturePondId] = useState('')
  const [aquacultureCycleId, setAquacultureCycleId] = useState('')
  const [aquacultureIncludeCycleBreakdown, setAquacultureIncludeCycleBreakdown] = useState(false)
  const [fingerlingSearch, setFingerlingSearch] = useState('')
  const [fingerlingSpecies, setFingerlingSpecies] = useState('')
  const [fingerlingMinCost, setFingerlingMinCost] = useState('')
  const [fingerlingMaxCost, setFingerlingMaxCost] = useState('')
  const [fingerlingNursingPondId, setFingerlingNursingPondId] = useState('')
  const [fingerlingGrowoutPondId, setFingerlingGrowoutPondId] = useState('')
  const [fingerlingBalance, setFingerlingBalance] = useState<'all' | 'balanced' | 'unbalanced'>('all')
  const [aquaculturePonds, setAquaculturePonds] = useState<{ id: number; name: string; pond_role?: string }[]>([])
  const [aquacultureCycles, setAquacultureCycles] = useState<{ id: number; name: string }[]>([])
  /** null = not loaded yet; false = company setting off */
  const [companyAquacultureEnabled, setCompanyAquacultureEnabled] = useState<boolean | null>(null)

  /** Shared filters for item-scoped reports (category + multi-select products). */
  const [itemScopeCategory, setItemScopeCategory] = useState('')
  const [itemScopeItemIds, setItemScopeItemIds] = useState<number[]>([])
  const [itemScopeItemOptions, setItemScopeItemOptions] = useState<
    { id: number; name: string; item_number?: string; category?: string }[]
  >([])
  const [itemFilterCategoryList, setItemFilterCategoryList] = useState<string[]>([])
  const [reportStationList, setReportStationList] = useState<ReportStationForSegment[]>([])
  const [reportStationId, setReportStationId] = useState('')
  const [loansStrictSiteOnly, setLoansStrictSiteOnly] = useState(false)
  const [businessSegment, setBusinessSegment] = useState<ReportBusinessSegment>('all')
  const todayIso = localDateISO()
  const [salesPurchaseDateRange, setSalesPurchaseDateRange] = useState({
    startDate: todayIso,
    endDate: todayIso,
  })
  const [salesPurchaseDatePreset, setSalesPurchaseDatePreset] =
    useState<SalesPurchasePeriodPreset>('today')
  const salesPurchaseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reportDisplayRef = useRef<HTMLDivElement>(null)
  const reportListRef = useRef<HTMLElement>(null)
  const [userHasHomeStation, setUserHasHomeStation] = useState(false)
  const [homeStationMeta, setHomeStationMeta] = useState<{
    id: number | null
    name: string | null
  }>({ id: null, name: null })

  const onItemScopeCategoryChange = useCallback((v: string) => {
    setItemScopeCategory(v)
    setItemScopeItemIds([])
  }, [])

  const itemScopeVisibleOptions = useMemo(() => {
    if (!itemScopeCategory.trim()) return itemScopeItemOptions
    return itemScopeItemOptions.filter(
      (i) => (i.category || 'General') === itemScopeCategory.trim()
    )
  }, [itemScopeCategory, itemScopeItemOptions])

  const toggleItemScopeId = useCallback((id: number) => {
    setItemScopeItemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const selectAllVisibleItemScope = useCallback(() => {
    setItemScopeItemIds(itemScopeVisibleOptions.map((i) => i.id))
  }, [itemScopeVisibleOptions])

  const clearItemScopeSelection = useCallback(() => setItemScopeItemIds([]), [])

  useEffect(() => {
    let c = true
    api
      .get('/items/categories/')
      .then((r) => {
        if (!c) return
        const p = Array.isArray(r.data?.presets) ? r.data.presets : []
        const u = Array.isArray(r.data?.custom_in_use) ? r.data.custom_in_use : []
        setItemFilterCategoryList(
          Array.from(new Set([...p, ...u].map((s: string) => String(s).trim()).filter(Boolean))).sort(
            (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
          )
        )
      })
      .catch(() => {})
    return () => {
      c = false
    }
  }, [selectedCompany?.id])

  useEffect(() => {
    if (!selectedReport || !ITEM_SCOPED_REPORT_IDS.includes(selectedReport)) return
    let c = true
    api
      .get('/items/')
      .then((r) => {
        if (!c || !Array.isArray(r.data)) return
        setItemScopeItemOptions(
          r.data.map((it: { id: number; name: string; item_number?: string; category?: string }) => ({
            id: it.id,
            name: it.name,
            item_number: it.item_number,
            category: it.category,
          }))
        )
      })
      .catch(() => {})
    return () => {
      c = false
    }
  }, [selectedReport, selectedCompany?.id]) // load item list for scoped reports

  useEffect(() => {
    let cancelled = false
    api
      .get('/companies/current/')
      .then((res) => {
        if (cancelled || !res.data) return
        const d = res.data as {
          name?: string
          company_name?: string
          aquaculture_enabled?: boolean
        }
        const label = [d.name, d.company_name]
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .find((s) => s.length > 0)
        if (label) setReportCompanyLabel(label)
        if (typeof d.aquaculture_enabled === 'boolean') {
          setCompanyAquacultureEnabled(d.aquaculture_enabled)
        } else {
          setCompanyAquacultureEnabled(false)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedCompany?.id])

  useEffect(() => {
    let cancelled = false
    loadPrintBranding(api)
      .then((b) => {
        if (!cancelled) setReportPrintBranding(b)
      })
      .catch(() => {
        if (!cancelled) setReportPrintBranding(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedCompany?.id])

  const resolveReportCompanyName = () =>
    reportCompanyLabel.trim() ||
    (selectedCompany?.name && String(selectedCompany.name).trim()) ||
    (typeof window !== 'undefined' ? (localStorage.getItem('company_name') || '').trim() : '') ||
    'Company'

  // Get user role from localStorage; operator is POS-only (no reports UI)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const userStr = localStorage.getItem('user')
    if (!userStr || userStr === 'undefined' || userStr === 'null') {
      setReportRbacHydrated(true)
      return
    }
    try {
      const parsedUser = JSON.parse(userStr) as {
        role?: string
        home_station_id?: unknown
        home_station_name?: string | null
      }
      if (parsedUser && typeof parsedUser === 'object') {
        const r = parsedUser.role?.toLowerCase() || null
        setUserRole(r)
        const hs = parsedUser.home_station_id
        if (hs != null && String(hs).trim() !== '') {
          setUserHasHomeStation(true)
          setHomeStationMeta({
            id: Number(hs),
            name: typeof parsedUser.home_station_name === 'string' ? parsedUser.home_station_name : null,
          })
        } else {
          setUserHasHomeStation(false)
          setHomeStationMeta({ id: null, name: null })
        }
        if (r === 'operator' || r === 'pump_attendant') {
          router.replace('/cashier')
        }
      }
    } catch (error) {
      console.error('Error parsing user data:', error)
    }
    setReportRbacHydrated(true)
  }, [router])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = localStorage.getItem('access_token')?.trim()
    if (!t) return
    let cancelled = false
    api
      .get<
        {
          id: number
          station_name: string
          station_number?: string
          operates_fuel_retail?: boolean
          is_active?: boolean
        }[]
      >('/stations/')
      .then((res) => {
        if (cancelled) return
        const rows = Array.isArray(res.data) ? res.data : []
        const mapped = rows.map((s) => ({
          id: s.id,
          station_name: s.station_name || `Station ${s.id}`,
          station_number: s.station_number != null ? String(s.station_number) : undefined,
          operates_fuel_retail: s.operates_fuel_retail === false ? false : true,
          is_active: s.is_active !== false,
        }))
        setReportStationList(mapped)
        const saved = localStorage.getItem('fserp_report_station_id')?.trim() || ''
        if (saved && isPersistedReportSiteScopeKey(saved)) {
          const scope = parseReportSiteScopeKey(saved)
          if (scope.kind === 'station' && !mapped.some((s) => s.id === scope.id)) {
            try {
              localStorage.removeItem('fserp_report_station_id')
            } catch {
              /* ignore */
            }
            setReportStationId('')
          }
        }
      })
      .catch(() => {
        if (!cancelled) setReportStationList([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedCompany?.id])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem('fserp_report_station_id')?.trim() || ''
    if (saved && isPersistedReportSiteScopeKey(saved)) setReportStationId(saved)
    else setReportStationId('')
    const savedSeg = localStorage.getItem(REPORT_BUSINESS_SEGMENT_STORAGE_KEY)
    setBusinessSegment(parseReportBusinessSegment(savedSeg))
    const storedPeriod = loadStoredSalesPurchasePeriod()
    setSalesPurchaseDateRange(storedPeriod.range)
    setSalesPurchaseDatePreset(storedPeriod.preset)
  }, [selectedCompany?.id])

  const lockedBusinessSegment = useMemo(
    () => inferSegmentFromHomeStation(reportStationList, homeStationMeta?.id ?? null),
    [reportStationList, homeStationMeta?.id]
  )

  useEffect(() => {
    if (!reportStationId || !isPersistedReportSiteScopeKey(reportStationId)) return
    if (
      isValidReportSiteScopeKey(reportStationId, reportStationList, aquaculturePonds)
    ) {
      return
    }
    setReportStationId('')
    try {
      localStorage.removeItem('fserp_report_station_id')
    } catch {
      /* ignore */
    }
  }, [reportStationId, reportStationList, aquaculturePonds])

  useEffect(() => {
    if (companyAquacultureEnabled !== true) {
      setAquaculturePonds([])
      return
    }
    let cancelled = false
    api
      .get<{ id: number; name: string; pond_role?: string }[]>('/aquaculture/ponds/')
      .then((res) => {
        if (cancelled) return
        setAquaculturePonds(Array.isArray(res.data) ? res.data : [])
      })
      .catch(() => {
        if (!cancelled) setAquaculturePonds([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedCompany?.id, companyAquacultureEnabled])

  useEffect(() => {
    if (!aquaculturePondId || selectedReport !== 'aquaculture-pond-pl') {
      setAquacultureCycles([])
      return
    }
    let cancelled = false
    api
      .get<{ id: number; name: string }[]>('/aquaculture/production-cycles/', {
        params: { pond_id: aquaculturePondId },
      })
      .then((res) => {
        if (cancelled) return
        setAquacultureCycles(Array.isArray(res.data) ? res.data : [])
      })
      .catch(() => {
        if (!cancelled) setAquacultureCycles([])
      })
    return () => {
      cancelled = true
    }
  }, [aquaculturePondId, selectedReport])

  const showAquacultureReports =
    companyAquacultureEnabled !== false &&
    (hasPermission('app.aquaculture') || hasPermission('app.aquaculture.report_pl'))

  useEffect(() => {
    if (!showAquacultureReports && filterCategory === 'aquaculture') {
      setFilterCategory('all')
    }
  }, [showAquacultureReports, filterCategory])

  const persistReportStation = useCallback((id: string) => {
    setReportStationId(id)
    try {
      if (id && isPersistedReportSiteScopeKey(id)) {
        localStorage.setItem('fserp_report_station_id', id)
      } else {
        localStorage.removeItem('fserp_report_station_id')
      }
    } catch {
      /* ignore */
    }
  }, [])

  const showPondsInSiteScope = showAquacultureReports && aquaculturePonds.length > 0

  const effectiveAquaculturePondId = useMemo(
    () => resolveEffectiveAquaculturePondId(reportStationId, aquaculturePondId),
    [reportStationId, aquaculturePondId]
  )

  const pondLockedBySiteScope = useMemo(
    () => isPondLockedBySiteScope(reportStationId),
    [reportStationId]
  )

  const reportSiteScope = useMemo(() => {
    if (selectedReport && BUSINESS_LINE_REPORT_IDS.has(selectedReport)) {
      return null
    }
    if (selectedReport && String(selectedReport).startsWith('aquaculture-')) {
      return getAquacultureReportScopeDisplay(
        reportStationId,
        reportStationList,
        aquaculturePonds,
        effectiveAquaculturePondId
      )
    }
    return getReportSiteScopeDisplay(
      selectedReport,
      reportData,
      reportStationList,
      userHasHomeStation,
      homeStationMeta.id,
      homeStationMeta.name,
      reportStationId,
      aquaculturePonds
    )
  }, [
    selectedReport,
    reportData,
    reportStationList,
    userHasHomeStation,
    homeStationMeta,
    reportStationId,
    aquaculturePonds,
    effectiveAquaculturePondId,
  ])
  
  // Filter reports based on user role and category
  const getFilteredReports = () => {
    let roleFilteredReports = reports.map((r) => localizeReportCard(r, companyLang))

    if (reportRbacHydrated && getCurrentUserPermissions() != null) {
      roleFilteredReports = roleFilteredReports.filter((report) => canAccessReport(report.id))
    }

    // First filter by role (legacy sessions without explicit permissions)
    if (userRole === 'cashier' && getCurrentUserPermissions() == null) {
      // Cashiers see only: Sales and Stock reports
      roleFilteredReports = reports.filter(report => 
        report.id === 'fuel-sales' ||
        report.id === 'sales-by-nozzle' ||
        report.id === 'sales-by-station' ||
        report.id === 'sales-by-products' ||
        report.id === 'sales-report' ||
        report.id === 'purchase-report' ||
        report.id === 'shift-summary' ||
        report.id === 'tank-inventory' ||
        report.id === 'tank-dip-register' ||
        report.id === 'daily-summary'
      )
    }

    const inventoryExtraReports: ReportType[] = [
      'inventory-sku-valuation',
      'item-master-by-category',
      'item-sales-by-category',
      'item-purchases-by-category',
      'item-sales-custom',
      'item-purchases-custom',
      'item-stock-movement',
      'item-velocity-analysis',
      'item-purchase-velocity-analysis',
    ]
    const canShowInventoryBlock = reportRbacHydrated
      ? canViewInventorySkuReport(userRole)
      : ['super_admin', 'admin', 'accountant', 'manager'].includes((userRole || '').toLowerCase())
    roleFilteredReports = roleFilteredReports.filter(
      (report) => !inventoryExtraReports.includes(report.id) || canShowInventoryBlock
    )

    if (!showAquacultureReports) {
      roleFilteredReports = roleFilteredReports.filter(
        (report) => !AQUACULTURE_REPORT_ID_SET.has(report.id) && report.id !== 'ponds-pl-summary',
      )
    }

    // Then filter by category
    if (filterCategory === 'all') {
      return roleFilteredReports
    }
    if (filterCategory === 'mix') {
      const mixSet = new Set<ReportType>(MIX_FUEL_AQUACULTURE_REPORT_IDS)
      const order = MIX_FUEL_AQUACULTURE_REPORT_IDS
      return roleFilteredReports
        .filter((r) => mixSet.has(r.id))
        .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    }
    if (filterCategory === 'analytical') {
      const pondExtra = new Set<ReportType>(ANALYTICAL_POND_REPORT_IDS)
      return roleFilteredReports.filter(
        (r) => r.category === 'analytical' || pondExtra.has(r.id),
      )
    }
    return roleFilteredReports.filter((r) => r.category === filterCategory)
  }
  
  const filteredReports = getFilteredReports()

  const scrollReportPanelIntoView = useCallback(() => {
    if (typeof window === 'undefined') return
    requestAnimationFrame(() => {
      const el = reportDisplayRef.current
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.scrollTop = 0
    })
  }, [])

  const fetchReport = useCallback(async (
    reportId: ReportType,
    opts?: {
      businessSegment?: ReportBusinessSegment
      salesPurchaseDateRange?: { startDate: string; endDate: string }
      /** Override the period date range for this fetch (non sales/purchase reports). */
      dateRangeOverride?: { startDate: string; endDate: string }
      /** Override Site scope for this fetch (station id or p:{pondId}). */
      siteScopeKey?: string
      /** Loans borrow/lent report: exclude company-wide loans when a site is selected. */
      strictSiteOnly?: boolean
    }
  ) => {
    setLoading(true)
    setReportData(null) // Clear previous data
    scrollReportPanelIntoView()
    const segmentForFetch = opts?.businessSegment ?? businessSegment
    const spRangeForFetch = opts?.salesPurchaseDateRange ?? salesPurchaseDateRange

    if (reportId === 'analytics-kpi') {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
      if (!token) {
        alert('Your session has expired. Please log in again.')
        router.push('/login')
        return
      }
      setSelectedReport('analytics-kpi')
      setReportData({ _analytics: true as const })
      setLoading(false)
      return
    }

    if (reportId === 'aquaculture-pl-management') {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
      if (!token) {
        alert('Your session has expired. Please log in again.')
        router.push('/login')
        return
      }
      setSelectedReport('aquaculture-pl-management')
      setReportData({ _aquaculturePlManagement: true as const })
      setLoading(false)
      return
    }

    if (!isApiBackedReportId(reportId)) {
      alert(`Unknown report "${reportId}". Choose a report from the list on the left.`)
      setLoading(false)
      return
    }

    const params: Record<string, string> = {}
    if (REPORTS_WITH_PERIOD.has(reportId)) {
      if (SALES_PURCHASE_REPORT_IDS.has(reportId)) {
        params.start_date = spRangeForFetch.startDate
        params.end_date = spRangeForFetch.endDate
      } else {
        const periodRange = opts?.dateRangeOverride ?? dateRange
        params.start_date = periodRange.startDate
        params.end_date = periodRange.endDate
      }
    }
    if (
      reportId === 'inventory-sku-valuation' ||
      reportId === 'item-sales-custom' ||
      reportId === 'item-purchases-custom' ||
      reportId === 'item-stock-movement' ||
      reportId === 'item-velocity-analysis' ||
      reportId === 'item-purchase-velocity-analysis'
    ) {
      if (itemScopeCategory.trim()) params.category = itemScopeCategory.trim()
      if (itemScopeItemIds.length > 0) params.item_ids = itemScopeItemIds.join(',')
    }

    if (String(reportId).startsWith('aquaculture-')) {
      const aqScopeKey = (opts?.siteScopeKey ?? reportStationId).trim()
      const pondFilter = resolveEffectiveAquaculturePondId(aqScopeKey, aquaculturePondId)
      if (pondFilter) {
        params.pond_id = pondFilter
      } else {
        const aqScope = parseReportSiteScopeKey(aqScopeKey)
        if (aqScope.kind === 'station') {
          params.station_id = String(aqScope.id)
        }
      }
      if (reportId === 'aquaculture-pond-pl') {
        if (aquacultureCycleId && /^\d+$/.test(aquacultureCycleId)) {
          params.cycle_id = aquacultureCycleId
        }
        if (aquacultureIncludeCycleBreakdown) {
          params.include_cycle_breakdown = 'true'
        }
      }
      if (reportId === 'aquaculture-fingerling-transfers') {
        if (fingerlingSearch.trim()) params.q = fingerlingSearch.trim()
        if (fingerlingSpecies.trim()) params.species = fingerlingSpecies.trim()
        if (fingerlingMinCost.trim()) params.min_cost = fingerlingMinCost.trim()
        if (fingerlingMaxCost.trim()) params.max_cost = fingerlingMaxCost.trim()
        if (fingerlingNursingPondId && /^\d+$/.test(fingerlingNursingPondId)) {
          params.nursing_pond_id = fingerlingNursingPondId
        }
        if (fingerlingGrowoutPondId && /^\d+$/.test(fingerlingGrowoutPondId)) {
          params.growout_pond_id = fingerlingGrowoutPondId
        }
        if (fingerlingBalance !== 'all') params.balance = fingerlingBalance
      }
    }

    if (BUSINESS_LINE_REPORT_IDS.has(reportId)) {
      let homeId: number | null = null
      try {
        const u = JSON.parse(localStorage.getItem('user') || '{}') as { home_station_id?: unknown }
        if (u?.home_station_id != null && String(u.home_station_id).trim() !== '') {
          homeId = Number(u.home_station_id)
        }
      } catch {
        /* ignore */
      }
      if (homeId == null) {
        params.business_segment = segmentForFetch
      }
    } else if (REPORTS_STATION_SCOPED.has(reportId)) {
      let homeId: number | null = null
      try {
        const u = JSON.parse(localStorage.getItem('user') || '{}') as { home_station_id?: unknown }
        if (u?.home_station_id != null && String(u.home_station_id).trim() !== '') {
          homeId = Number(u.home_station_id)
        }
      } catch {
        /* ignore */
      }
      const scopeKey = (opts?.siteScopeKey ?? reportStationId).trim()
      if (homeId == null && scopeKey) {
        const scope = parseReportSiteScopeKey(scopeKey)
        if (scope.kind === 'station') {
          params.station_id = String(scope.id)
        } else if (
          scope.kind === 'pond' &&
          (REPORTS_GL_POND_SCOPED.has(reportId) || REPORTS_SUBLEDGER_POND_SCOPED.has(reportId))
        ) {
          params.pond_id = String(scope.id)
        }
      }
    }

    if (reportId === 'loans-borrow-and-lent') {
      const strict = opts?.strictSiteOnly ?? loansStrictSiteOnly
      if (strict && params.station_id) {
        params.strict_site = 'true'
      }
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
      if (!token) {
        alert('Your session has expired. Please log in again.')
        router.push('/login')
        return
      }

      const response = await api.get(`/reports/${reportId}`, {
        params,
        timeout: REPORT_API_TIMEOUT_MS,
      })

      // Ensure we have valid data structure
      if (response.data) {
        setReportData(response.data)
        setSelectedReport(reportId)
      } else {
        throw new Error('Invalid response data')
      }
    } catch (error: any) {
      const reqUrl =
        error?.config?.baseURL && error?.config?.url
          ? `${String(error.config.baseURL).replace(/\/+$/, '')}/${String(error.config.url).replace(/^\/+/, '')}`
          : `${getApiBaseUrl().replace(/\/+$/, '')}/reports/${reportId}/`
      console.error('Error fetching report:', {
        reportId,
        url: reqUrl,
        status: error?.response?.status,
        detail: error?.response?.data?.detail,
        error,
      })

      // Stale super-admin company picker (invalid X-Selected-Company-Id) → clear and retry once
      if (error?.response?.status === 403 && typeof window !== 'undefined') {
        const detail = String(error?.response?.data?.detail ?? '')
        const isCompanyContext = detail.includes('Company context required')
        if (isCompanyContext) {
          try {
            const userStr = localStorage.getItem('user')
            if (userStr) {
              const u = JSON.parse(userStr)
              const role = (u?.role ?? '').toString().toLowerCase().replace(/[\s-]+/g, '_')
              if (role === 'super_admin' || role === 'superadmin') {
                localStorage.removeItem('superadmin_selected_company')
                const retry = await api.get(`/reports/${reportId}`, {
                  params,
                  timeout: REPORT_API_TIMEOUT_MS,
                })
                if (retry.data) {
                  setReportData(retry.data)
                  setSelectedReport(reportId)
                  return
                }
              }
            }
          } catch {
            /* fall through to alert below */
          }
        }
      }

      if (error?.response?.status === 401) {
        alert('You are not authorized or your session expired. Please log in again.')
        // Clear only auth tokens, preserve company/mode selection
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        localStorage.removeItem('user')
        router.push('/login')
        return
      }
      
      const backendDetail = String(error?.response?.data?.detail ?? '').trim()
      let errorMessage =
        backendDetail ||
        extractErrorMessage(
          error,
          'Could not load this report. Try again, use a shorter date range, or select All sites. If it persists, your server may need longer API timeouts.'
        )
      if (error?.response?.status === 404) {
        errorMessage =
          backendDetail === 'Unknown report' || backendDetail === ''
            ? `Report "${reportId}" is not registered on the API (${reqUrl}). ` +
              'Restart the Django server if you added this report recently, and confirm the frontend is calling your local API (http://localhost:8000/api in dev).'
            : `${backendDetail} (${reportId})`
      }
      alert(errorMessage)
      setReportData(null)
    } finally {
      setLoading(false)
    }
  }, [
    dateRange,
    router,
    itemScopeCategory,
    itemScopeItemIds,
    reportStationId,
    aquaculturePondId,
    aquacultureCycleId,
    aquacultureIncludeCycleBreakdown,
    fingerlingSearch,
    fingerlingSpecies,
    fingerlingMinCost,
    fingerlingMaxCost,
    fingerlingNursingPondId,
    fingerlingGrowoutPondId,
    fingerlingBalance,
    businessSegment,
    salesPurchaseDateRange,
    scrollReportPanelIntoView,
    loansStrictSiteOnly,
  ])

  const openEntityPlDetail = useCallback(
    (entityType: 'station' | 'pond', entityId: number) => {
      if (!entityId || entityId <= 0) return
      const scopeKey = entityType === 'pond' ? formatPondScopeKey(entityId) : String(entityId)
      persistReportStation(scopeKey)
      void fetchReport('income-statement', { siteScopeKey: scopeKey })
    },
    [persistReportStation, fetchReport],
  )

  useEffect(() => {
    if (!selectedReport || loading) return
    scrollReportPanelIntoView()
  }, [selectedReport, loading, scrollReportPanelIntoView])

  useCenterActiveListItem(
    reportListRef,
    '[data-report-selected="true"]',
    Boolean(selectedReport),
    [selectedReport, filteredReports, filterCategory]
  )

  const onSalesPurchasePresetChange = useCallback(
    (preset: SalesPurchasePeriodPreset) => {
      if (preset === 'custom') {
        setSalesPurchaseDatePreset('custom')
        persistSalesPurchasePeriod('custom', salesPurchaseDateRange)
        return
      }
      const nextRange = salesPurchaseRangeForPreset(preset)
      setSalesPurchaseDatePreset(preset)
      setSalesPurchaseDateRange(nextRange)
      persistSalesPurchasePeriod(preset, nextRange)
      if (selectedReport && SALES_PURCHASE_REPORT_IDS.has(selectedReport)) {
        void fetchReport(selectedReport, {
          businessSegment,
          salesPurchaseDateRange: nextRange,
        })
      }
    },
    [businessSegment, fetchReport, salesPurchaseDateRange, selectedReport]
  )

  const onSalesPurchaseDateChange = useCallback(
    (field: 'startDate' | 'endDate', value: string) => {
      const nextRange = {
        startDate: field === 'startDate' ? value : salesPurchaseDateRange.startDate,
        endDate: field === 'endDate' ? value : salesPurchaseDateRange.endDate,
      }
      const nextPreset = inferSalesPurchasePreset(nextRange)
      setSalesPurchaseDateRange(nextRange)
      setSalesPurchaseDatePreset(nextPreset)
      persistSalesPurchasePeriod(nextPreset, nextRange)
      if (salesPurchaseDebounceRef.current) {
        clearTimeout(salesPurchaseDebounceRef.current)
      }
      salesPurchaseDebounceRef.current = setTimeout(() => {
        if (selectedReport && BUSINESS_LINE_REPORT_IDS.has(selectedReport)) {
          void fetchReport(selectedReport, {
            businessSegment,
            salesPurchaseDateRange: nextRange,
          })
        }
      }, 500)
    },
    [businessSegment, fetchReport, salesPurchaseDateRange, selectedReport]
  )

  const onBusinessSegmentChange = useCallback(
    (segment: ReportBusinessSegment) => {
      setBusinessSegment(segment)
      try {
        localStorage.setItem(REPORT_BUSINESS_SEGMENT_STORAGE_KEY, segment)
      } catch {
        /* ignore */
      }
    if (selectedReport && BUSINESS_LINE_REPORT_IDS.has(selectedReport)) {
      void fetchReport(selectedReport, { businessSegment: segment })
    }
    },
    [fetchReport, selectedReport]
  )

  const deepLinkReportKeyRef = useRef<string | null>(null)
  const aquacultureFilterSigRef = useRef<string>('')

  useEffect(() => {
    aquacultureFilterSigRef.current = ''
  }, [selectedReport])

  useEffect(() => {
    if (!selectedReport || !String(selectedReport).startsWith('aquaculture-')) return
    if (selectedReport === 'aquaculture-pl-management') return
    const sig = `${effectiveAquaculturePondId}|${aquacultureCycleId}|${aquacultureIncludeCycleBreakdown ? '1' : '0'}`
    if (aquacultureFilterSigRef.current === '') {
      aquacultureFilterSigRef.current = sig
      return
    }
    if (aquacultureFilterSigRef.current === sig) return
    aquacultureFilterSigRef.current = sig
    void fetchReport(selectedReport)
  }, [
    effectiveAquaculturePondId,
    aquacultureCycleId,
    aquacultureIncludeCycleBreakdown,
    selectedReport,
    fetchReport,
  ])

  useEffect(() => {
    if (!reportRbacHydrated) return
    const reportParam = searchParams.get('report')
    if (!reportParam) return
    const cat = searchParams.get('category')
    if (
      cat === 'aquaculture' ||
      cat === 'mix' ||
      cat === 'all' ||
      cat === 'financial' ||
      cat === 'analytical' ||
      cat === 'operational' ||
      cat === 'inventory'
    ) {
      setFilterCategory(cat)
    }
    const linkKey = `${reportParam}|${cat ?? ''}`
    if (deepLinkReportKeyRef.current === linkKey) return
    const segParam = searchParams.get('business_segment')
    if (segParam) {
      setBusinessSegment(parseReportBusinessSegment(segParam))
    }
    const archiveStart = (searchParams.get('start_date') || '').trim().slice(0, 10)
    const archiveEnd = (searchParams.get('end_date') || '').trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(archiveStart) && /^\d{4}-\d{2}-\d{2}$/.test(archiveEnd)) {
      setDateRange({ startDate: archiveStart, endDate: archiveEnd })
      if (SALES_PURCHASE_REPORT_IDS.has(reportParam as ReportType)) {
        setSalesPurchaseDateRange({ startDate: archiveStart, endDate: archiveEnd })
        setSalesPurchaseDatePreset(inferSalesPurchasePreset({ startDate: archiveStart, endDate: archiveEnd }))
      }
    }
    const archivePond = (searchParams.get('pond_id') || '').trim()
    if (/^\d+$/.test(archivePond)) setAquaculturePondId(archivePond)

    const isKnownReport =
      reportParam === 'analytics-kpi' ||
      reportParam === 'aquaculture-pl-management' ||
      isApiBackedReportId(reportParam)
    if (isKnownReport) {
      deepLinkReportKeyRef.current = linkKey
      void fetchReport(reportParam as ReportType)
    }
  }, [searchParams, reportRbacHydrated, fetchReport])

  const applyReportSiteScopeChange = useCallback(
    (v: string) => {
      persistReportStation(v)
      const scope = parseReportSiteScopeKey(v)
      if (scope.kind === 'pond') {
        setAquaculturePondId(String(scope.id))
        setAquacultureCycleId('')
      } else {
        setAquaculturePondId('')
        setAquacultureCycleId('')
      }
      if (!selectedReport) return
      if (selectedReport === 'analytics-kpi') {
        setReportData({ _analytics: true as const })
        return
      }
      if (selectedReport === 'aquaculture-pl-management') {
        setReportData({ _aquaculturePlManagement: true as const })
        return
      }
      if (
        REPORTS_STATION_SCOPED.has(selectedReport) ||
        String(selectedReport).startsWith('aquaculture-')
      ) {
        void fetchReport(selectedReport, { siteScopeKey: v })
      }
    },
    [persistReportStation, selectedReport, fetchReport]
  )
  
  // Debounced date change handler for all period-based reports
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const handleReportDateChange = useCallback((field: 'startDate' | 'endDate' | 'range', value: string, reportId?: string) => {
    // All reports now use date range
    const targetReportId = (reportId || selectedReport) as ReportType

    // `range` carries both bounds as "start|end" (used by the quick-preset buttons).
    const newDateRange =
      field === 'range'
        ? { startDate: value.split('|')[0] ?? '', endDate: value.split('|')[1] ?? '' }
        : {
            startDate: field === 'startDate' ? value : dateRange.startDate,
            endDate: field === 'endDate' ? value : dateRange.endDate,
          }

    // Update state immediately for UI responsiveness
    setDateRange(newDateRange)

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Presets apply instantly; manual date edits are debounced to avoid request spam.
    const refetch = () => {
      if (targetReportId && selectedReport === targetReportId) {
        fetchReport(targetReportId, { dateRangeOverride: newDateRange })
      }
    }
    if (field === 'range') {
      refetch()
    } else {
      debounceTimerRef.current = setTimeout(refetch, 500)
    }
  }, [dateRange, fetchReport, selectedReport])

  const printReport = () => {
    if (!reportData || !selectedReport) return

    const reportTitle = filteredReports.find(r => r.id === selectedReport)?.title || selectedReport
    const siteScopeForPrint = getReportScopeForExport(
      selectedReport,
      reportData,
      reportStationList,
      userHasHomeStation,
      homeStationMeta.id,
      homeStationMeta.name,
      reportStationId,
      aquaculturePonds
    )
    const companyName = resolveReportCompanyName()
    const branding: PrintBranding = reportPrintBranding
      ? { ...reportPrintBranding, companyName: companyName || reportPrintBranding.companyName }
      : { companyName, companyAddress: undefined, stationName: '' }

    // Generate HTML content from report data
    let contentHTML = ''
    
    // Add summary if available
    if (reportData.summary && Object.keys(reportData.summary).length > 0 && !SUMMARY_EXCLUDED_REPORTS.includes(selectedReport)) {
      contentHTML += '<div class="summary"><h2>Summary</h2><table>'
      Object.entries(reportData.summary).forEach(([key, value]) => {
        const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
        const formattedValue = typeof value === 'number' 
          ? (key.includes('amount') || key.includes('value') || key.includes('sales') ? formatCurrency(Number(value)) : Number(value).toLocaleString())
          : String(value)
        contentHTML += `<tr><td><strong>${formattedKey}:</strong></td><td>${formattedValue}</td></tr>`
      })
      contentHTML += '</table></div>'
    }
    
    // Generate table based on report type
    if (selectedReport === 'trial-balance' && reportData.accounts) {
      contentHTML += '<h2>Accounts</h2><table><thead><tr><th>Account Code</th><th>Account Name</th><th>Type</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead><tbody>'
      reportData.accounts.forEach((acc: any) => {
        contentHTML += `<tr><td>${acc.account_code || ''}</td><td>${acc.account_name || ''}</td><td>${acc.account_type || ''}</td><td style="text-align:right">${formatCurrency(acc.debit || 0)}</td><td style="text-align:right">${formatCurrency(acc.credit || 0)}</td><td style="text-align:right">${formatCurrency(acc.balance || 0)}</td></tr>`
      })
      contentHTML += `<tfoot><tr><td colspan="3"><strong>Totals:</strong></td><td style="text-align:right"><strong>${formatCurrency(reportData.total_debit || 0)}</strong></td><td style="text-align:right"><strong>${formatCurrency(reportData.total_credit || 0)}</strong></td><td style="text-align:right"><strong>${formatCurrency((reportData.total_debit || 0) - (reportData.total_credit || 0))}</strong></td></tr></tfoot></tbody></table>`
    } else if (selectedReport === 'balance-sheet') {
      const sections = [
        { title: 'Assets', data: reportData.assets },
        { title: 'Liabilities', data: reportData.liabilities },
        { title: 'Equity', data: reportData.equity }
      ]
      sections.forEach(section => {
        if (section.data?.accounts?.length > 0) {
          contentHTML += `<h2>${section.title}</h2><p><strong>Total: ${formatCurrency(section.data.total || 0)}</strong></p><table><thead><tr><th>Account Code</th><th>Account Name</th><th style="text-align:right">Balance</th></tr></thead><tbody>`
          section.data.accounts.forEach((acc: any) => {
            contentHTML += `<tr><td>${acc.account_code || ''}</td><td>${acc.account_name || ''}</td><td style="text-align:right">${formatCurrency(acc.balance || 0)}</td></tr>`
          })
          contentHTML += `<tfoot><tr><td colspan="2"><strong>Sub-total — ${section.title}</strong></td><td style="text-align:right"><strong>${formatCurrency(section.data.total || 0)}</strong></td></tr></tfoot></tbody></table>`
        }
      })
    } else if (selectedReport === 'income-statement') {
      const sections = [
        { title: 'Income', data: reportData.income },
        { title: 'Cost of Goods Sold', data: reportData.cost_of_goods_sold },
        { title: 'Expenses', data: reportData.expenses }
      ]
      sections.forEach(section => {
        if (section.data?.accounts?.length > 0) {
          contentHTML += `<h2>${section.title}</h2><p><strong>Total: ${formatCurrency(section.data.total || 0)}</strong></p><table><thead><tr><th>Account Code</th><th>Account Name</th><th style="text-align:right">Balance</th></tr></thead><tbody>`
          section.data.accounts.forEach((acc: any) => {
            contentHTML += `<tr><td>${acc.account_code || ''}</td><td>${acc.account_name || ''}</td><td style="text-align:right">${formatCurrency(acc.balance || 0)}</td></tr>`
          })
          contentHTML += `<tfoot><tr><td colspan="2"><strong>Sub-total — ${section.title}</strong></td><td style="text-align:right"><strong>${formatCurrency(section.data.total || 0)}</strong></td></tr></tfoot></tbody></table>`
        }
      })
      contentHTML += `<div class="summary"><h2>Summary</h2><p><strong>Gross Profit:</strong> ${formatCurrency(reportData.gross_profit || 0)}</p><p><strong>Net Income:</strong> ${formatCurrency(reportData.net_income || 0)}</p></div>`
    } else if (selectedReport === 'liabilities-detail' && reportData.accounts) {
      contentHTML +=
        '<h2>Liabilities (GL)</h2><table><thead><tr><th>Code</th><th>Account</th><th>Type</th><th style="text-align:right">Balance</th><th>Account id</th></tr></thead><tbody>'
      reportData.accounts.forEach((acc: any) => {
        contentHTML += `<tr><td>${acc.account_code || ''}</td><td>${acc.account_name || ''}</td><td>${acc.account_type || ''}</td><td style="text-align:right">${formatCurrency(acc.balance || 0)}</td><td>${acc.account_id ?? ''}</td></tr>`
      })
      contentHTML += `</tbody><tfoot><tr><td colspan="3"><strong>Total</strong></td><td style="text-align:right"><strong>${formatCurrency(reportData.total_liabilities || 0)}</strong></td><td></td></tr></tfoot></table>`
    } else if (selectedReport === 'loan-receivable-gl' && reportData.accounts) {
      contentHTML +=
        '<h2>Loan receivable (GL)</h2><table><thead><tr><th>Code</th><th>Account</th><th>Sub-type</th><th style="text-align:right">Balance</th><th>Account id</th></tr></thead><tbody>'
      reportData.accounts.forEach((acc: any) => {
        contentHTML += `<tr><td>${acc.account_code || ''}</td><td>${acc.account_name || ''}</td><td>${acc.account_sub_type || ''}</td><td style="text-align:right">${formatCurrency(acc.balance || 0)}</td><td>${acc.account_id ?? ''}</td></tr>`
      })
      contentHTML += `</tbody><tfoot><tr><td colspan="3"><strong>Total</strong></td><td style="text-align:right"><strong>${formatCurrency(reportData.total_loan_receivable_gl || 0)}</strong></td><td></td></tr></tfoot></table>`
    } else if (selectedReport === 'loan-payable-gl' && reportData.accounts) {
      contentHTML +=
        '<h2>Loan payable (GL)</h2><table><thead><tr><th>Code</th><th>Account</th><th>Sub-type</th><th style="text-align:right">Balance</th><th>Account id</th></tr></thead><tbody>'
      reportData.accounts.forEach((acc: any) => {
        contentHTML += `<tr><td>${acc.account_code || ''}</td><td>${acc.account_name || ''}</td><td>${acc.account_sub_type || ''}</td><td style="text-align:right">${formatCurrency(acc.balance || 0)}</td><td>${acc.account_id ?? ''}</td></tr>`
      })
      contentHTML += `</tbody><tfoot><tr><td colspan="3"><strong>Total</strong></td><td style="text-align:right"><strong>${formatCurrency(reportData.total_loan_payable_gl || 0)}</strong></td><td></td></tr></tfoot></table>`
    } else if (selectedReport === 'loans-borrow-and-lent') {
      const sm = reportData.summary || {}
      contentHTML += `<h2>Summary</h2><p>Outstanding borrowed: ${formatCurrency(sm.outstanding_borrowed_principal ?? 0)} (${sm.borrowed_count ?? 0} facilities)</p>`
      contentHTML += `<p>Outstanding lent: ${formatCurrency(sm.outstanding_lent_principal ?? 0)} (${sm.lent_count ?? 0} facilities)</p>`
      contentHTML += `<p>Period disbursements: ${formatCurrency(sm.period_disbursements_total ?? 0)}</p>`
      contentHTML += `<p>Period repayments: ${formatCurrency(sm.period_repayments_total ?? 0)}</p>`
      const mkTable = (title: string, rows: any[]) => {
        let h = `<h3>${title}</h3><table><thead><tr><th>Loan</th><th>Party</th><th>Status</th><th style="text-align:right">Outstanding</th><th style="text-align:right">Period disb.</th><th style="text-align:right">Period pmt</th></tr></thead><tbody>`
        rows.forEach((row: any) => {
          h += `<tr><td>${row.loan_no || ''}</td><td>${row.counterparty_name || ''}</td><td>${row.status || ''}</td><td style="text-align:right">${formatCurrency(row.outstanding_principal ?? 0)}</td><td style="text-align:right">${formatCurrency(row.period_disbursements ?? 0)}</td><td style="text-align:right">${formatCurrency(row.period_repayments ?? 0)}</td></tr>`
        })
        h += '</tbody></table>'
        return h
      }
      contentHTML += mkTable('Borrowed', reportData.borrowed || [])
      contentHTML += mkTable('Lent', reportData.lent || [])
    } else if (
      (selectedReport === 'customer-balances' && reportData.customers) ||
      (selectedReport === 'vendor-balances' && reportData.vendors)
    ) {
      const entries =
        selectedReport === 'customer-balances'
          ? reportData.customers || []
          : reportData.vendors || []
      const type = selectedReport === 'customer-balances' ? 'Customer' : 'Vendor'
      contentHTML += `<h2>${type} Balances</h2><table><thead><tr><th>${type} #</th><th>${type} Name</th><th>Email</th><th>Phone</th><th style="text-align:right">Balance</th></tr></thead><tbody>`
      entries.forEach((entry: any) => {
        contentHTML += `<tr><td>${entry.customer_number || entry.vendor_number || ''}</td><td>${entry.display_name || entry.company_name || ''}</td><td>${entry.email || '—'}</td><td>${entry.phone || '—'}</td><td style="text-align:right">${formatCurrency(Math.abs(Number(entry.balance || 0)))}</td></tr>`
      })
      const posTot = selectedReport === 'customer-balances' ? reportData.total_ar : reportData.total_ap
      const netTot = reportData.total_net_balance
      contentHTML += `<tfoot><tr><td colspan="4" style="text-align:right"><strong>Sub-total — outstanding (${selectedReport === 'customer-balances' ? 'AR' : 'AP'})</strong></td><td style="text-align:right"><strong>${formatCurrency(Number(posTot ?? 0))}</strong></td></tr>`
      contentHTML += `<tr><td colspan="4" style="text-align:right"><strong>Total — net balance</strong></td><td style="text-align:right"><strong>${formatCurrency(Number(netTot ?? 0))}</strong></td></tr></tfoot></tbody></table>`
    } else if (selectedReport === 'meter-readings' && reportData.meters) {
      contentHTML += '<h2>Meter Details</h2><table><thead><tr><th>Meter Number</th><th>Meter Name</th><th style="text-align:right">Opening</th><th style="text-align:right">Closing</th><th style="text-align:right">Dispensed</th><th style="text-align:right">Sales</th><th style="text-align:right">Liters</th><th style="text-align:right">Amount</th></tr></thead><tbody>'
      reportData.meters.forEach((meter: any) => {
        contentHTML += `<tr><td>${meter.meter_number || ''}</td><td>${meter.meter_name || ''}</td><td style="text-align:right">${formatNumber(Number(meter.opening_reading || 0))}L</td><td style="text-align:right">${formatNumber(Number(meter.closing_reading || 0))}L</td><td style="text-align:right">${formatNumber(Number(meter.period_dispensed || 0))}L</td><td style="text-align:right">${meter.total_sales || 0}</td><td style="text-align:right">${formatNumber(Number(meter.total_liters || 0))}L</td><td style="text-align:right">${formatCurrency(meter.total_amount || 0)}</td></tr>`
      })
      const ms = reportData.summary || {}
      contentHTML += `<tfoot><tr><td colspan="5" style="text-align:right"><strong>Totals</strong></td><td style="text-align:right"><strong>${ms.total_sales ?? ''}</strong></td><td style="text-align:right"><strong>${formatNumber(Number(ms.total_liters_dispensed ?? 0))}L</strong></td><td style="text-align:right"><strong>${formatCurrency(ms.total_amount ?? 0)}</strong></td></tr></tfoot></tbody></table>`
    } else if (selectedReport === 'sales-by-nozzle' && reportData.nozzles) {
      contentHTML += '<h2>Sales by Nozzle</h2><table><thead><tr><th>Nozzle</th><th>Product</th><th>Station</th><th style="text-align:right">Transactions</th><th style="text-align:right">Liters</th><th style="text-align:right">Amount</th><th style="text-align:right">Avg Sale</th></tr></thead><tbody>'
      reportData.nozzles.forEach((nozzle: any) => {
        contentHTML += `<tr><td>${nozzle.nozzle_name || nozzle.nozzle_number || ''}</td><td>${nozzle.product_name || ''}</td><td>${nozzle.station_name || ''}</td><td style="text-align:right">${nozzle.total_transactions || 0}</td><td style="text-align:right">${formatNumber(Number(nozzle.total_liters || 0))}L</td><td style="text-align:right">${formatCurrency(nozzle.total_amount || 0)}</td><td style="text-align:right">${formatCurrency(nozzle.average_sale_amount || 0)}</td></tr>`
      })
      const ns = reportData.summary || {}
      contentHTML += `<tfoot><tr><td colspan="3" style="text-align:right"><strong>Totals</strong></td><td style="text-align:right"><strong>${ns.total_transactions ?? ''}</strong></td><td style="text-align:right"><strong>${formatNumber(Number(ns.total_liters ?? 0))}L</strong></td><td style="text-align:right"><strong>${formatCurrency(ns.total_amount ?? 0)}</strong></td><td>—</td></tr></tfoot></tbody></table>`
    } else if (selectedReport === 'sales-by-station' && reportData.rows) {
      contentHTML += '<h2>Sales by station</h2><table><thead><tr><th>Station</th><th style="text-align:right">Invoices</th><th style="text-align:right">Total</th></tr></thead><tbody>'
      const srows: any[] = reportData.rows || []
      srows.forEach((r: any) => {
        contentHTML += `<tr><td>${escapeHtml(String(r.station_name || ''))}</td><td style="text-align:right">${r.invoice_count ?? 0}</td><td style="text-align:right">${formatCurrency(r.total ?? 0)}</td></tr>`
      })
      const st = srows.reduce((s: number, r: any) => s + Number(r.total ?? 0), 0)
      const ic = srows.reduce((s: number, r: any) => s + Number(r.invoice_count ?? 0), 0)
      contentHTML += `<tfoot><tr><td style="text-align:right"><strong>Total</strong></td><td style="text-align:right"><strong>${ic}</strong></td><td style="text-align:right"><strong>${formatCurrency(st)}</strong></td></tr></tfoot></tbody></table>`
    } else if (selectedReport === 'sales-by-products' && (reportData.cash_products || reportData.credit_products)) {
      const renderProductSection = (title: string, rows: any[]) => {
        contentHTML += `<h2>${escapeHtml(title)}</h2><table><thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Unit</th><th style="text-align:right">Lines</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit cost</th><th style="text-align:right">Avg price</th><th style="text-align:right">Revenue</th><th style="text-align:right">Cost</th><th style="text-align:right">Profit</th></tr></thead><tbody>`
        rows.forEach((r: any) => {
          contentHTML += `<tr><td>${escapeHtml(String(r.sku || ''))}</td><td>${escapeHtml(String(r.name || ''))}</td><td>${escapeHtml(String(r.reporting_category || ''))}</td><td>${escapeHtml(String(r.unit || ''))}</td><td style="text-align:right">${r.line_count ?? 0}</td><td style="text-align:right">${formatNumber(Number(r.quantity ?? 0), 2)}</td><td style="text-align:right">${formatCurrency(r.unit_cost ?? 0)}</td><td style="text-align:right">${formatCurrency(r.avg_unit_price ?? 0)}</td><td style="text-align:right">${formatCurrency(r.revenue ?? 0)}</td><td style="text-align:right">${formatCurrency(r.total_cost ?? 0)}</td><td style="text-align:right">${formatCurrency(r.profit ?? 0)}</td></tr>`
        })
        const sq = rows.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0)
        const sr = rows.reduce((s: number, r: any) => s + Number(r.revenue ?? 0), 0)
        const sc = rows.reduce((s: number, r: any) => s + Number(r.total_cost ?? 0), 0)
        const sp = rows.reduce((s: number, r: any) => s + Number(r.profit ?? 0), 0)
        const sl = rows.reduce((s: number, r: any) => s + Number(r.line_count ?? 0), 0)
        contentHTML += `<tfoot><tr><td colspan="4" style="text-align:right"><strong>Subtotal</strong></td><td style="text-align:right"><strong>${sl}</strong></td><td style="text-align:right"><strong>${formatNumber(sq, 2)}</strong></td><td colspan="2"></td><td style="text-align:right"><strong>${formatCurrency(sr)}</strong></td><td style="text-align:right"><strong>${formatCurrency(sc)}</strong></td><td style="text-align:right"><strong>${formatCurrency(sp)}</strong></td></tr></tfoot></tbody></table>`
      }
      renderProductSection('Cash products', reportData.cash_products || [])
      renderProductSection('Credit products', reportData.credit_products || [])
      const sum = reportData.summary || {}
      contentHTML += `<table><tfoot><tr><td colspan="4" style="text-align:right"><strong>Grand total</strong></td><td style="text-align:right"><strong>${sum.total_line_count ?? 0}</strong></td><td style="text-align:right"><strong>${formatNumber(Number(sum.grand_quantity ?? 0), 2)}</strong></td><td colspan="2"></td><td style="text-align:right"><strong>${formatCurrency(sum.grand_revenue ?? 0)}</strong></td><td style="text-align:right"><strong>${formatCurrency(sum.grand_total_cost ?? 0)}</strong></td><td style="text-align:right"><strong>${formatCurrency(sum.grand_profit ?? 0)}</strong></td></tr></tfoot></table>`
    } else if (selectedReport === 'sales-report' && (reportData.cash_customers || reportData.credit_customers)) {
      const renderSalesReportSection = (title: string, rows: any[]) => {
        contentHTML += `<h2>${escapeHtml(title)}</h2><table><thead><tr><th>Customer #</th><th>Customer</th><th style="text-align:right">Invoices</th><th style="text-align:right">Total</th></tr></thead><tbody>`
        rows.forEach((r: any) => {
          contentHTML += `<tr><td>${escapeHtml(String(r.customer_number || ''))}</td><td>${escapeHtml(String(r.display_name || ''))}</td><td style="text-align:right">${r.invoice_count ?? 0}</td><td style="text-align:right">${formatCurrency(r.total ?? 0)}</td></tr>`
        })
        const st = rows.reduce((s: number, r: any) => s + Number(r.total ?? 0), 0)
        const ic = rows.reduce((s: number, r: any) => s + Number(r.invoice_count ?? 0), 0)
        contentHTML += `<tfoot><tr><td colspan="2" style="text-align:right"><strong>Subtotal</strong></td><td style="text-align:right"><strong>${ic}</strong></td><td style="text-align:right"><strong>${formatCurrency(st)}</strong></td></tr></tfoot></tbody></table>`
      }
      renderSalesReportSection('Cash customers', reportData.cash_customers || [])
      renderSalesReportSection('Credit customers', reportData.credit_customers || [])
      const sum = reportData.summary || {}
      contentHTML += `<table><tfoot><tr><td colspan="2" style="text-align:right"><strong>Grand total sales</strong></td><td style="text-align:right"><strong>${sum.total_invoices ?? 0}</strong></td><td style="text-align:right"><strong>${formatCurrency(sum.grand_total ?? 0)}</strong></td></tr></tfoot></table>`
    } else if (selectedReport === 'purchase-report' && (reportData.cash_vendors || reportData.credit_vendors)) {
      const renderPurchaseReportSection = (title: string, rows: any[]) => {
        contentHTML += `<h2>${escapeHtml(title)}</h2><table><thead><tr><th>Vendor #</th><th>Vendor</th><th style="text-align:right">Bills</th><th style="text-align:right">Total</th></tr></thead><tbody>`
        rows.forEach((r: any) => {
          contentHTML += `<tr><td>${escapeHtml(String(r.vendor_number || ''))}</td><td>${escapeHtml(String(r.display_name || ''))}</td><td style="text-align:right">${r.bill_count ?? 0}</td><td style="text-align:right">${formatCurrency(r.total ?? 0)}</td></tr>`
        })
        const st = rows.reduce((s: number, r: any) => s + Number(r.total ?? 0), 0)
        const bc = rows.reduce((s: number, r: any) => s + Number(r.bill_count ?? 0), 0)
        contentHTML += `<tfoot><tr><td colspan="2" style="text-align:right"><strong>Subtotal</strong></td><td style="text-align:right"><strong>${bc}</strong></td><td style="text-align:right"><strong>${formatCurrency(st)}</strong></td></tr></tfoot></tbody></table>`
      }
      renderPurchaseReportSection('Cash vendors', reportData.cash_vendors || [])
      renderPurchaseReportSection('Credit vendors', reportData.credit_vendors || [])
      const sum = reportData.summary || {}
      contentHTML += `<p><strong>Grand total:</strong> ${formatCurrency(sum.grand_total ?? 0)} (${sum.total_bills ?? 0} bill portions)</p>`
    } else if (selectedReport === 'tank-inventory' && reportData.inventory) {
      contentHTML += '<h2>Tank Inventory</h2><table><thead><tr><th>Tank</th><th>Station</th><th>Product</th><th style="text-align:right">Capacity (L)</th><th style="text-align:right">Stock (L)</th><th style="text-align:right">Fill %</th><th>Needs Refill</th></tr></thead><tbody>'
      reportData.inventory.forEach((tank: any) => {
        contentHTML += `<tr><td>${tank.tank_name || ''}</td><td>${tank.station_name || ''}</td><td>${tank.product_name || ''}</td><td style="text-align:right">${Number(tank.capacity || 0).toLocaleString()}</td><td style="text-align:right">${Number(tank.current_stock || 0).toLocaleString()}</td><td style="text-align:right">${formatNumber(Number(tank.fill_percentage || 0))}%</td><td>${tank.needs_refill ? 'Yes' : 'No'}</td></tr>`
      })
      const inv = reportData.inventory || []
      const tc = inv.reduce((s: number, t: any) => s + Number(t.capacity || 0), 0)
      const ts = inv.reduce((s: number, t: any) => s + Number(t.current_stock || 0), 0)
      contentHTML += `<tfoot><tr><td colspan="3" style="text-align:right"><strong>Totals</strong></td><td style="text-align:right"><strong>${tc.toLocaleString()}</strong></td><td style="text-align:right"><strong>${ts.toLocaleString()}</strong></td><td colspan="2"></td></tr></tfoot></tbody></table>`
    } else if (selectedReport === 'inventory-sku-valuation' && reportData.rows) {
      const rows: any[] = reportData.rows || []
      contentHTML += '<h2>SKU details</h2><table><thead><tr><th>SKU</th><th>Item</th><th>Category</th><th>Unit</th><th style="text-align:right">On hand</th><th style="text-align:right">Cost value</th><th style="text-align:right">List value</th><th style="text-align:right">Period qty</th><th style="text-align:right">Period rev</th><th style="text-align:right">Units/day</th><th style="text-align:right">Days cover</th><th>Status</th></tr></thead><tbody>'
      rows.forEach((r: any) => {
        const dc = r.days_of_cover == null ? '—' : String(r.days_of_cover)
        contentHTML += `<tr><td>${escapeHtml(String(r.sku || ''))}</td><td>${escapeHtml(String(r.name || ''))}</td><td>${escapeHtml(String(r.reporting_category || ''))}</td><td>${escapeHtml(String(r.unit || ''))}</td><td style="text-align:right">${r.quantity_on_hand != null ? formatNumber(Number(r.quantity_on_hand)) : ''}</td><td style="text-align:right">${formatCurrency(r.extended_cost_value)}</td><td style="text-align:right">${formatCurrency(r.extended_list_value)}</td><td style="text-align:right">${r.period_quantity_sold != null ? formatNumber(Number(r.period_quantity_sold)) : ''}</td><td style="text-align:right">${formatCurrency(r.period_revenue)}</td><td style="text-align:right">${r.velocity_per_day != null ? formatNumber(Number(r.velocity_per_day), 2) : ''}</td><td style="text-align:right">${escapeHtml(dc)}</td><td>${escapeHtml(String(r.stock_status || ''))}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'item-master-by-category' && (reportData.by_category || reportData.rows)) {
      const byC: any[] = reportData.by_category || []
      contentHTML += '<h2>By category</h2><table><thead><tr><th>Category</th><th style="text-align:right">Items</th><th style="text-align:right">On hand</th><th style="text-align:right">Cost value</th><th style="text-align:right">List value</th></tr></thead><tbody>'
      byC.forEach((c: any) => {
        contentHTML += `<tr><td>${escapeHtml(String(c.reporting_category || ''))}</td><td style="text-align:right">${c.item_count ?? 0}</td><td style="text-align:right">${formatNumber(c.quantity_on_hand, 2)}</td><td style="text-align:right">${formatCurrency(c.extended_cost_value)}</td><td style="text-align:right">${formatCurrency(c.extended_list_value)}</td></tr>`
      })
      contentHTML += '</tbody></table>'
      const rows: any[] = reportData.rows || []
      contentHTML += '<h2>Items</h2><table><thead><tr><th>SKU</th><th>Name</th><th>Category</th><th style="text-align:right">On hand</th><th style="text-align:right">Cost value</th><th style="text-align:right">List value</th></tr></thead><tbody>'
      rows.forEach((r: any) => {
        contentHTML += `<tr><td>${escapeHtml(String(r.sku || ''))}</td><td>${escapeHtml(String(r.name || ''))}</td><td>${escapeHtml(String(r.reporting_category || ''))}</td><td style="text-align:right">${formatNumber(r.quantity_on_hand, 2)}</td><td style="text-align:right">${formatCurrency(r.extended_cost_value)}</td><td style="text-align:right">${formatCurrency(r.extended_list_value)}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'item-sales-by-category' && reportData.rows) {
      const cr: any[] = reportData.rows || []
      contentHTML += '<h2>Sales by category</h2><table><thead><tr><th>Category</th><th style="text-align:right">Lines</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody>'
      cr.forEach((c: any) => {
        contentHTML += `<tr><td>${escapeHtml(String(c.reporting_category || ''))}</td><td style="text-align:right">${c.line_count ?? 0}</td><td style="text-align:right">${formatNumber(c.total_quantity, 2)}</td><td style="text-align:right">${formatCurrency(c.total_revenue)}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'item-purchases-by-category' && reportData.rows) {
      const cr: any[] = reportData.rows || []
      contentHTML +=
        '<h2>Purchases by category</h2><table><thead><tr><th>Category</th><th style="text-align:right">Lines</th><th style="text-align:right">Qty</th><th style="text-align:right">Purchase amount</th></tr></thead><tbody>'
      cr.forEach((c: any) => {
        contentHTML += `<tr><td>${escapeHtml(String(c.reporting_category || ''))}</td><td style="text-align:right">${c.line_count ?? 0}</td><td style="text-align:right">${formatNumber(c.total_quantity, 2)}</td><td style="text-align:right">${formatCurrency(c.total_purchase_amount)}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'item-sales-custom' && reportData.rows) {
      const cr: any[] = reportData.rows || []
      contentHTML += '<h2>Item sales (filtered)</h2><table><thead><tr><th>SKU</th><th>Item</th><th>Category</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th><th style="text-align:right">Margin %</th></tr></thead><tbody>'
      cr.forEach((r: any) => {
        const m = r.gross_margin_pct == null ? '—' : String(r.gross_margin_pct)
        contentHTML += `<tr><td>${escapeHtml(String(r.sku || ''))}</td><td>${escapeHtml(String(r.name || ''))}</td><td>${escapeHtml(String(r.reporting_category || ''))}</td><td style="text-align:right">${formatNumber(r.period_quantity_sold, 2)}</td><td style="text-align:right">${formatCurrency(r.period_revenue)}</td><td style="text-align:right">${escapeHtml(m)}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'item-purchases-custom' && reportData.rows) {
      const cr: any[] = reportData.rows || []
      contentHTML +=
        '<h2>Item purchases (filtered)</h2><table><thead><tr><th>SKU</th><th>Item</th><th>Category</th><th style="text-align:right">Qty</th><th style="text-align:right">Amount</th><th style="text-align:right">Avg unit</th></tr></thead><tbody>'
      cr.forEach((r: any) => {
        const au = r.avg_purchase_unit_cost == null ? '—' : String(r.avg_purchase_unit_cost)
        contentHTML += `<tr><td>${escapeHtml(String(r.sku || ''))}</td><td>${escapeHtml(String(r.name || ''))}</td><td>${escapeHtml(String(r.reporting_category || ''))}</td><td style="text-align:right">${formatNumber(r.period_quantity_purchased, 2)}</td><td style="text-align:right">${formatCurrency(r.period_purchase_amount)}</td><td style="text-align:right">${escapeHtml(au)}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'item-stock-movement' && reportData.rows) {
      const cr: any[] = reportData.rows || []
      contentHTML +=
        '<h2>Stock movement (purchases vs sales)</h2><table><thead><tr><th>SKU</th><th>Item</th><th>Category</th><th style="text-align:right">Qty in</th><th style="text-align:right">Purchase</th><th style="text-align:right">Qty out</th><th style="text-align:right">Sales</th><th style="text-align:right">Net qty</th></tr></thead><tbody>'
      cr.forEach((r: any) => {
        contentHTML += `<tr><td>${escapeHtml(String(r.sku || ''))}</td><td>${escapeHtml(String(r.name || ''))}</td><td>${escapeHtml(String(r.reporting_category || ''))}</td><td style="text-align:right">${formatNumber(r.quantity_purchased, 2)}</td><td style="text-align:right">${formatCurrency(r.purchase_amount)}</td><td style="text-align:right">${formatNumber(r.quantity_sold, 2)}</td><td style="text-align:right">${formatCurrency(r.sales_revenue)}</td><td style="text-align:right">${formatNumber(r.net_quantity_in, 2)}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'item-velocity-analysis' && reportData.rows) {
      const cr: any[] = reportData.rows || []
      contentHTML +=
        '<h2>Fast & slow movers (sales)</h2><table><thead><tr><th>Tier</th><th>SKU</th><th>Item</th><th>On hand</th><th>Sold qty</th><th>Vel/day</th><th>Rank</th></tr></thead><tbody>'
      cr.forEach((r: any) => {
        contentHTML += `<tr><td>${escapeHtml(String(r.movement_tier || ''))}</td><td>${escapeHtml(String(r.sku || ''))}</td><td>${escapeHtml(String(r.name || ''))}</td><td style="text-align:right">${formatNumber(r.quantity_on_hand, 2)}</td><td style="text-align:right">${formatNumber(r.period_quantity_sold, 2)}</td><td style="text-align:right">${formatNumber(r.velocity_per_day, 2)}</td><td style="text-align:right">${r.velocity_rank ?? '—'}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'item-purchase-velocity-analysis' && reportData.rows) {
      const cr: any[] = reportData.rows || []
      contentHTML +=
        '<h2>Fast & slow purchases</h2><table><thead><tr><th>Tier</th><th>SKU</th><th>Item</th><th>On hand</th><th>Purch qty</th><th>Purch / day</th><th>Rank</th></tr></thead><tbody>'
      cr.forEach((r: any) => {
        contentHTML += `<tr><td>${escapeHtml(String(r.movement_tier || ''))}</td><td>${escapeHtml(String(r.sku || ''))}</td><td>${escapeHtml(String(r.name || ''))}</td><td style="text-align:right">${formatNumber(r.quantity_on_hand, 2)}</td><td style="text-align:right">${formatNumber(r.period_quantity_purchased, 2)}</td><td style="text-align:right">${formatNumber(r.purchase_velocity_per_day, 2)}</td><td style="text-align:right">${r.velocity_rank ?? '—'}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'shift-summary' && reportData.sessions) {
      contentHTML += '<h2>Session Details</h2><table><thead><tr><th>Cashier</th><th>Station</th><th>Opened</th><th>Closed</th><th style="text-align:right">Transactions</th><th style="text-align:right">Sales</th><th style="text-align:right">Liters</th><th style="text-align:right">Cash Expected</th><th style="text-align:right">Cash Counted</th><th style="text-align:right">Variance</th><th>Status</th></tr></thead><tbody>'
      reportData.sessions.forEach((session: any) => {
        const openedDate = formatDate(session.opened_at, true)
        const closedDate = session.closed_at ? formatDate(session.closed_at, true) : '—'
        contentHTML += `<tr><td>${session.cashier_name || ''}</td><td>${session.station_name || ''}</td><td>${openedDate}</td><td>${closedDate}</td><td style="text-align:right">${session.transaction_count || 0}</td><td style="text-align:right">${formatCurrency(session.total_sales || 0)}</td><td style="text-align:right">${formatNumber(Number(session.total_liters || 0))}L</td><td style="text-align:right">${formatCurrency(session.cash_expected || 0)}</td><td style="text-align:right">${formatCurrency(session.cash_counted || 0)}</td><td style="text-align:right">${formatCurrency(session.variance || 0)}</td><td>${session.status || ''}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'tank-dip-register' && reportData.entries) {
      contentHTML += '<h2>Tank Dip Register</h2><table><thead><tr><th>#</th><th>Date</th><th>Station</th><th>Tank</th><th>Product</th><th style="text-align:right">Book (L)</th><th style="text-align:right">Stick (L)</th><th style="text-align:right">Variance (L)</th><th style="text-align:right">% Cap</th><th style="text-align:right">Est. value</th><th>Notes</th></tr></thead><tbody>'
      ;(reportData.entries as any[]).forEach((row: any, idx: number) => {
        const d = row.dip_date ? formatDate(row.dip_date) : ''
        const book = row.book_before_liters != null ? formatNumber(Number(row.book_before_liters)) : '—'
        const varL = row.variance_liters != null ? formatNumber(Number(row.variance_liters)) : '—'
        const pct = row.variance_pct_of_capacity != null ? `${formatNumber(Number(row.variance_pct_of_capacity))}%` : '—'
        const val = row.variance_value_estimate != null ? formatCurrency(row.variance_value_estimate) : '—'
        contentHTML += `<tr><td>${idx + 1}</td><td>${d}</td><td>${row.station_name || ''}</td><td>${row.tank_name || ''}</td><td>${row.product_name || ''}</td><td style="text-align:right">${book}</td><td style="text-align:right">${formatNumber(Number(row.measured_liters || 0))}</td><td style="text-align:right">${varL}</td><td style="text-align:right">${pct}</td><td style="text-align:right">${val}</td><td>${(row.notes || '').replace(/</g, '')}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'tank-dip-variance' && reportData.dips) {
      contentHTML += '<h2>Dip Reading Details</h2><table><thead><tr><th>Date</th><th>Tank</th><th>Product</th><th style="text-align:right">System Qty (L)</th><th style="text-align:right">Measured Qty (L)</th><th style="text-align:right">Variance (L)</th><th style="text-align:right">Value</th><th>Type</th><th>Recorded By</th></tr></thead><tbody>'
      reportData.dips.forEach((dip: any) => {
        const dr = dip.reading_date || dip.dip_date
        const date = dr ? formatDate(dr) : '—'
        const sys = Number(dip.system_quantity ?? dip.book_volume ?? 0)
        const meas = Number(dip.measured_quantity ?? dip.dip_volume ?? 0)
        const vq = Number(dip.variance_quantity ?? dip.variance ?? 0)
        const vt = dip.variance_type || (vq > 0 ? 'GAIN' : vq < 0 ? 'LOSS' : 'EVEN')
        contentHTML += `<tr><td>${date}</td><td>${dip.tank_name || ''}</td><td>${dip.product_name || ''}</td><td style="text-align:right">${formatNumber(sys)}</td><td style="text-align:right">${formatNumber(meas)}</td><td style="text-align:right">${vt === 'GAIN' ? '+' : ''}${formatNumber(vq)}</td><td style="text-align:right">${formatCurrency(dip.variance_value)}</td><td>${vt}</td><td>${dip.recorded_by || '—'}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'daily-summary' && reportData) {
      contentHTML += buildDailySummaryPrintHtml(reportData as Record<string, unknown>)
    } else if (selectedReport === 'fuel-sales' && reportData) {
      contentHTML += '<h2>Fuel sales (invoice fuel lines)</h2><table><tbody>'
      contentHTML += `<tr><td><strong>Fuel line count</strong></td><td>${reportData.total_sales ?? 0}</td></tr>`
      contentHTML += `<tr><td><strong>Invoices with fuel</strong></td><td>${reportData.invoice_count ?? 0}</td></tr>`
      contentHTML += `<tr><td><strong>Total liters</strong></td><td>${formatNumber(Number(reportData.total_quantity_liters ?? 0))}</td></tr>`
      contentHTML += `<tr><td><strong>Total amount</strong></td><td>${formatCurrency(reportData.total_amount)}</td></tr>`
      contentHTML += `<tr><td><strong>Average per fuel line</strong></td><td>${formatCurrency(reportData.average_sale_amount)}</td></tr>`
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'aquaculture-pond-sales-comprehensive' && reportData) {
      const sm = reportData.summary || {}
      contentHTML += '<h2>Summary (BDT)</h2><table><tbody>'
      contentHTML += `<tr><td><strong>Registered pond income</strong></td><td>${formatCurrency(sm.fish_total_amount_bdt ?? 0)}</td></tr>`
      contentHTML += `<tr><td><strong>Pond POS (non-fuel lines)</strong></td><td>${formatCurrency(sm.pos_non_fuel_total_amount_bdt ?? 0)}</td></tr>`
      contentHTML += `<tr><td><strong>Combined</strong></td><td>${formatCurrency(sm.combined_total_amount_bdt ?? 0)}</td></tr>`
      contentHTML += '</tbody></table>'
      const byInc: any[] = Array.isArray(sm.fish_by_income_type) ? sm.fish_by_income_type : []
      if (byInc.length) {
        contentHTML +=
          '<h2>Registered income by type</h2><table><thead><tr><th>Type</th><th style="text-align:right">Lines</th><th style="text-align:right">Amount</th></tr></thead><tbody>'
        byInc.forEach((r: any) => {
          contentHTML += `<tr><td>${escapeHtml(String(r.income_type_label || r.income_type || ''))}</td><td style="text-align:right">${r.line_count ?? 0}</td><td style="text-align:right">${formatCurrency(r.amount_bdt ?? 0)}</td></tr>`
        })
        contentHTML += '</tbody></table>'
      }
      const fish = reportData.fish_sales || {}
      const fg: any[] = Array.isArray(fish.groups) ? fish.groups : []
      contentHTML += '<h2>A. Registered pond sales</h2>'
      fg.forEach((g: any) => {
        contentHTML += `<h3>${escapeHtml(String(g.pond_name || ''))}</h3><table><thead><tr><th>Date</th><th>Type</th><th>Species</th><th style="text-align:right">Kg</th><th style="text-align:right">Amount</th><th>Buyer</th></tr></thead><tbody>`
        ;(g.lines || []).forEach((ln: any) => {
          contentHTML += `<tr><td>${ln.sale_date || ''}</td><td>${escapeHtml(String(ln.income_type_label || ''))}</td><td>${escapeHtml(String(ln.fish_species_label || ''))}</td><td style="text-align:right">${ln.weight_kg ?? ''}</td><td style="text-align:right">${formatCurrency(Number(ln.total_amount ?? 0))}</td><td>${escapeHtml(String(ln.buyer_name || ''))}</td></tr>`
        })
        contentHTML += `</tbody><tfoot><tr><td colspan="4" style="text-align:right"><strong>Sub-total</strong></td><td style="text-align:right"><strong>${formatCurrency(Number(g.subtotal_amount ?? 0))}</strong></td><td></td></tr></tfoot></table>`
      })
      const pos = reportData.pos_shop_sales || {}
      const pg: any[] = Array.isArray(pos.groups) ? pos.groups : []
      contentHTML += '<h2>B. Pond POS (non-fuel lines)</h2>'
      pg.forEach((g: any) => {
        contentHTML += `<h3>${escapeHtml(String(g.pond_name || ''))}</h3><table><thead><tr><th>Date</th><th>Invoice</th><th>Station</th><th>Item</th><th>POS</th><th style="text-align:right">Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>`
        ;(g.lines || []).forEach((ln: any) => {
          contentHTML += `<tr><td>${ln.invoice_date || ''}</td><td>${escapeHtml(String(ln.invoice_number || ''))}</td><td>${escapeHtml(String(ln.station_name || ''))}</td><td>${escapeHtml(String(ln.item_name || ''))}</td><td>${escapeHtml(String(ln.pos_category || ''))}</td><td style="text-align:right">${ln.quantity ?? ''}</td><td style="text-align:right">${formatCurrency(Number(ln.amount ?? 0))}</td></tr>`
        })
        contentHTML += `</tbody><tfoot><tr><td colspan="6" style="text-align:right"><strong>Sub-total</strong></td><td style="text-align:right"><strong>${formatCurrency(Number(g.subtotal_amount ?? 0))}</strong></td></tr></tfoot></table>`
      })
    } else if (
      EXTRA_FINANCIAL_REPORT_IDS.includes(
        selectedReport as (typeof EXTRA_FINANCIAL_REPORT_IDS)[number],
      )
    ) {
      const extraPrint = buildExtraFinancialPrintHtml(
        selectedReport,
        reportData as Record<string, unknown>,
      )
      contentHTML += extraPrint ?? buildGenericPrintHtml(reportData as Record<string, unknown>) ?? '<p>Report data not available for printing in this format.</p>'
    } else if (String(selectedReport).startsWith('aquaculture-')) {
      const aqPrint = buildAquaculturePrintHtml(
        selectedReport,
        reportData as Record<string, unknown>,
      )
      contentHTML +=
        aqPrint ??
        buildGenericPrintHtml(reportData as Record<string, unknown>) ??
        '<p>Report data not available for printing in this format.</p>'
    } else {
      contentHTML +=
        buildGenericPrintHtml(reportData as Record<string, unknown>) ??
        '<p>Report data not available for printing in this format.</p>'
    }

    const periodLine =
      reportData.period &&
      typeof reportData.period.start_date === 'string' &&
      typeof reportData.period.end_date === 'string'
        ? `<strong>Period:</strong> ${escapeHtml(reportData.period.start_date)} to ${escapeHtml(reportData.period.end_date)}`
        : ''
    const siteScopeLine = siteScopeForPrint
      ? `${escapeHtml(siteScopeForPrint.prefix)}: ${escapeHtml(siteScopeForPrint.headline)} — ${escapeHtml(siteScopeForPrint.detail)}`
      : ''

    const ok = printDocument({
      title: reportTitle,
      branding,
      bodyHtml: `
          <h1>${escapeHtml(reportTitle)}</h1>
          <div class="period">
            <strong>Generated:</strong> ${escapeHtml(formatDate(new Date(), true))}<br>
            ${periodLine}
            ${siteScopeLine ? `<br><strong>Scope:</strong> ${siteScopeLine}` : ''}
          </div>
          ${contentHTML}
        `,
    })
    if (!ok && typeof window !== 'undefined') {
      window.alert('Printing was blocked. Allow pop-ups for this site and try again.')
    }
  }

  const downloadReport = (format: 'json' | 'csv' = 'json') => {
    if (!reportData || !selectedReport) return
    
    const reportTitle = filteredReports.find(r => r.id === selectedReport)?.title || selectedReport
    const fileName = `${reportTitle.replace(/\s+/g, '_')}_${
      selectedReport && SALES_PURCHASE_REPORT_IDS.has(selectedReport)
        ? salesPurchaseDateRange.endDate
        : dateRange.endDate
    }`
    
    if (format === 'json') {
      const dataStr = JSON.stringify(reportData, null, 2)
      const dataBlob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(dataBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName}.json`
      link.click()
      URL.revokeObjectURL(url)
    } else if (format === 'csv') {
      // Try to export table data as CSV
      let csvContent = ''
      
      // Add header with metadata
      const companyName = resolveReportCompanyName()
      csvContent += `${reportTitle}\n`
      csvContent += `Company: ${companyName}\n`
      csvContent += `Generated: ${formatDate(new Date(), true)}\n`
      if (reportData.period) {
        csvContent += `Period: ${reportData.period.start_date} to ${reportData.period.end_date}\n`
      }
      const siteScopeCsv = getReportScopeForExport(
        selectedReport,
        reportData,
        reportStationList,
        userHasHomeStation,
        homeStationMeta.id,
        homeStationMeta.name,
        reportStationId,
        aquaculturePonds
      )
      if (siteScopeCsv) {
        csvContent += `${siteScopeCsv.prefix}: ${siteScopeCsv.headline} — ${siteScopeCsv.detail}\n`
      }
      csvContent += '\n'
      
      // Add summary if available
      if (reportData.summary && Object.keys(reportData.summary).length > 0) {
        csvContent += 'Summary\n'
        Object.entries(reportData.summary).forEach(([key, value]) => {
          csvContent += `${key.replace(/_/g, ' ')},${value}\n`
        })
        csvContent += '\n'
      }
      
      // Helper function to escape CSV values
      const escapeCsv = (value: any): string => {
        if (value === null || value === undefined) return ''
        const str = String(value).replace(/"/g, '""')
        return `"${str}"`
      }
      
      // Export based on report type
      if (selectedReport === 'trial-balance' && reportData.accounts) {
        csvContent += 'Account Code,Account Name,Type,Debit,Credit,Balance\n'
        reportData.accounts.forEach((acc: any) => {
          csvContent += `${escapeCsv(acc.account_code)},${escapeCsv(acc.account_name)},${escapeCsv(acc.account_type)},${acc.debit || 0},${acc.credit || 0},${acc.balance || 0}\n`
        })
      } else if (selectedReport === 'customer-balances' && reportData.customers) {
        csvContent += 'Customer Number,Customer Name,Email,Phone,Balance\n'
        reportData.customers.forEach((cust: any) => {
          csvContent += `${escapeCsv(cust.customer_number)},${escapeCsv(cust.display_name || cust.company_name)},${escapeCsv(cust.email)},${escapeCsv(cust.phone)},${cust.balance || 0}\n`
        })
      } else if (selectedReport === 'vendor-balances' && reportData.vendors) {
        csvContent += 'Vendor Number,Vendor Name,Email,Phone,Balance\n'
        reportData.vendors.forEach((vend: any) => {
          csvContent += `${escapeCsv(vend.vendor_number)},${escapeCsv(vend.display_name || vend.company_name)},${escapeCsv(vend.email)},${escapeCsv(vend.phone)},${vend.balance || 0}\n`
        })
      } else if (selectedReport === 'meter-readings' && reportData.meters) {
        csvContent += 'Meter Number,Meter Name,Opening Reading,Closing Reading,Period Dispensed,Total Sales,Total Liters,Total Amount\n'
        reportData.meters.forEach((meter: any) => {
          csvContent += `${escapeCsv(meter.meter_number)},${escapeCsv(meter.meter_name)},${meter.opening_reading || 0},${meter.closing_reading || 0},${meter.period_dispensed || 0},${meter.total_sales || 0},${meter.total_liters || 0},${meter.total_amount || 0}\n`
        })
      } else if (selectedReport === 'sales-by-nozzle' && reportData.nozzles) {
        csvContent += 'Nozzle,Product,Station,Transactions,Liters,Amount,Avg Sale\n'
        reportData.nozzles.forEach((nozzle: any) => {
          csvContent += `${escapeCsv(nozzle.nozzle_name || nozzle.nozzle_number)},${escapeCsv(nozzle.product_name)},${escapeCsv(nozzle.station_name)},${nozzle.total_transactions || 0},${nozzle.total_liters || 0},${nozzle.total_amount || 0},${nozzle.average_sale_amount || 0}\n`
        })
      } else if (selectedReport === 'sales-by-station' && reportData.rows) {
        csvContent += 'Station,Invoices,Total\n'
        const srows: any[] = reportData.rows || []
        srows.forEach((r: any) => {
          csvContent += `${escapeCsv(r.station_name)},${r.invoice_count ?? 0},${r.total ?? 0}\n`
        })
      } else if (selectedReport === 'sales-by-products' && (reportData.cash_products || reportData.credit_products)) {
        const exportProductSection = (section: string, rows: any[]) => {
          csvContent += `\n${section}\n`
          csvContent += 'SKU,Product,Category,Unit,Lines,Qty,Unit cost,Avg price,Revenue,Total cost,Profit\n'
          rows.forEach((r: any) => {
            csvContent += [
              escapeCsv(r.sku),
              escapeCsv(r.name),
              escapeCsv(r.reporting_category),
              escapeCsv(r.unit),
              r.line_count ?? 0,
              r.quantity ?? 0,
              r.unit_cost ?? 0,
              r.avg_unit_price ?? 0,
              r.revenue ?? 0,
              r.total_cost ?? 0,
              r.profit ?? 0,
            ].join(',')
            csvContent += '\n'
          })
        }
        exportProductSection('Cash products', reportData.cash_products || [])
        exportProductSection('Credit products', reportData.credit_products || [])
        const sum = reportData.summary || {}
        csvContent += `\nGrand total,,,,${sum.total_line_count ?? 0},${sum.grand_quantity ?? 0},,,${sum.grand_revenue ?? 0},${sum.grand_total_cost ?? 0},${sum.grand_profit ?? 0}\n`
      } else if (selectedReport === 'sales-report' && (reportData.cash_customers || reportData.credit_customers)) {
        const exportSalesSection = (section: string, rows: any[]) => {
          csvContent += `\n${section}\n`
          csvContent += 'Customer #,Customer,Invoices,Total\n'
          rows.forEach((r: any) => {
            csvContent += `${escapeCsv(r.customer_number)},${escapeCsv(r.display_name)},${r.invoice_count ?? 0},${r.total ?? 0}\n`
          })
        }
        exportSalesSection('Cash customers', reportData.cash_customers || [])
        exportSalesSection('Credit customers', reportData.credit_customers || [])
        const sum = reportData.summary || {}
        csvContent += `\nGrand total sales,,${sum.total_invoices ?? 0},${sum.grand_total ?? 0}\n`
      } else if (selectedReport === 'purchase-report' && (reportData.cash_vendors || reportData.credit_vendors)) {
        const exportPurchaseSection = (section: string, rows: any[]) => {
          csvContent += `\n${section}\n`
          csvContent += 'Vendor #,Vendor,Bills,Total\n'
          rows.forEach((r: any) => {
            csvContent += `${escapeCsv(r.vendor_number)},${escapeCsv(r.display_name)},${r.bill_count ?? 0},${r.total ?? 0}\n`
          })
        }
        exportPurchaseSection('Cash vendors', reportData.cash_vendors || [])
        exportPurchaseSection('Credit vendors', reportData.credit_vendors || [])
      } else if (selectedReport === 'tank-inventory' && reportData.inventory) {
        csvContent += 'Tank,Station,Product,Capacity (L),Current Stock (L),Fill %,Needs Refill\n'
        reportData.inventory.forEach((tank: any) => {
          csvContent += `${escapeCsv(tank.tank_name)},${escapeCsv(tank.station_name)},${escapeCsv(tank.product_name)},${tank.capacity || 0},${tank.current_stock || 0},${formatAmountPlain(Number(tank.fill_percentage || 0), 2)},${tank.needs_refill ? 'Yes' : 'No'}\n`
        })
      } else if (selectedReport === 'inventory-sku-valuation' && reportData.rows) {
        csvContent +=
          'SKU,Name,Reporting category,Unit,On hand,Unit cost,Cost value,List value,Period qty,Period rev,Units per day,Days cover,Status\n'
        const rows: any[] = reportData.rows || []
        rows.forEach((r: any) => {
          csvContent += [
            escapeCsv(r.sku),
            escapeCsv(r.name),
            escapeCsv(r.reporting_category),
            escapeCsv(r.unit),
            r.quantity_on_hand ?? '',
            r.unit_cost ?? '',
            r.extended_cost_value ?? '',
            r.extended_list_value ?? '',
            r.period_quantity_sold ?? '',
            r.period_revenue ?? '',
            r.velocity_per_day ?? '',
            r.days_of_cover == null ? '' : r.days_of_cover,
            escapeCsv(r.stock_status),
          ].join(',')
          csvContent += '\n'
        })
      } else if (selectedReport === 'item-master-by-category' && reportData.rows) {
        csvContent +=
          'SKU,Name,Reporting category,POS category,Item type,Active,On hand,Cost value,List value\n'
        const rows: any[] = reportData.rows || []
        rows.forEach((r: any) => {
          csvContent += [
            escapeCsv(r.sku),
            escapeCsv(r.name),
            escapeCsv(r.reporting_category),
            escapeCsv(r.pos_category),
            escapeCsv(r.item_type),
            r.is_active ? 'yes' : 'no',
            r.quantity_on_hand ?? '',
            r.extended_cost_value ?? '',
            r.extended_list_value ?? '',
          ].join(',')
          csvContent += '\n'
        })
      } else if (selectedReport === 'item-sales-by-category' && reportData.rows) {
        csvContent += 'Category,Invoice lines,Distinct products,Quantity,Revenue\n'
        const cr: any[] = reportData.rows || []
        cr.forEach((c: any) => {
          csvContent += [
            escapeCsv(c.reporting_category),
            c.line_count ?? '',
            c.distinct_items ?? '',
            c.total_quantity ?? '',
            c.total_revenue ?? '',
          ].join(',')
          csvContent += '\n'
        })
      } else if (selectedReport === 'item-purchases-by-category' && reportData.rows) {
        csvContent += 'Category,Bill lines,Distinct products,Quantity,Purchase amount\n'
        const cr: any[] = reportData.rows || []
        cr.forEach((c: any) => {
          csvContent += [
            escapeCsv(c.reporting_category),
            c.line_count ?? '',
            c.distinct_items ?? '',
            c.total_quantity ?? '',
            c.total_purchase_amount ?? '',
          ].join(',')
          csvContent += '\n'
        })
      } else if (selectedReport === 'item-sales-custom' && reportData.rows) {
        csvContent +=
          'SKU,Name,Reporting category,POS,Period quantity,Revenue,Est COGS,Margin %\n'
        const cr: any[] = reportData.rows || []
        cr.forEach((r: any) => {
          csvContent += [
            escapeCsv(r.sku),
            escapeCsv(r.name),
            escapeCsv(r.reporting_category),
            escapeCsv(r.pos_category),
            r.period_quantity_sold ?? '',
            r.period_revenue ?? '',
            r.est_cogs ?? '',
            r.gross_margin_pct == null ? '' : r.gross_margin_pct,
          ].join(',')
          csvContent += '\n'
        })
      } else if (selectedReport === 'item-purchases-custom' && reportData.rows) {
        csvContent += 'SKU,Name,Reporting category,POS,Period qty purchased,Purchase amount,Avg unit cost\n'
        const cr: any[] = reportData.rows || []
        cr.forEach((r: any) => {
          csvContent += [
            escapeCsv(r.sku),
            escapeCsv(r.name),
            escapeCsv(r.reporting_category),
            escapeCsv(r.pos_category),
            r.period_quantity_purchased ?? '',
            r.period_purchase_amount ?? '',
            r.avg_purchase_unit_cost == null ? '' : r.avg_purchase_unit_cost,
          ].join(',')
          csvContent += '\n'
        })
      } else if (selectedReport === 'item-stock-movement' && reportData.rows) {
        csvContent +=
          'SKU,Name,Reporting category,Qty in (bills),Purchase amount,Qty out (invoices),Sales amount,Net qty in\n'
        const cr: any[] = reportData.rows || []
        cr.forEach((r: any) => {
          csvContent += [
            escapeCsv(r.sku),
            escapeCsv(r.name),
            escapeCsv(r.reporting_category),
            r.quantity_purchased ?? '',
            r.purchase_amount ?? '',
            r.quantity_sold ?? '',
            r.sales_revenue ?? '',
            r.net_quantity_in ?? '',
          ].join(',')
          csvContent += '\n'
        })
      } else if (selectedReport === 'item-velocity-analysis' && reportData.rows) {
        csvContent +=
          'Movement tier,SKU,Name,Category,On hand,Period quantity sold,Revenue,Velocity per day,Rank\n'
        const cr: any[] = reportData.rows || []
        cr.forEach((r: any) => {
          csvContent += [
            escapeCsv(r.movement_tier),
            escapeCsv(r.sku),
            escapeCsv(r.name),
            escapeCsv(r.reporting_category),
            r.quantity_on_hand ?? '',
            r.period_quantity_sold ?? '',
            r.period_revenue ?? '',
            r.velocity_per_day ?? '',
            r.velocity_rank ?? '',
          ].join(',')
          csvContent += '\n'
        })
      } else if (selectedReport === 'item-purchase-velocity-analysis' && reportData.rows) {
        csvContent +=
          'Movement tier,SKU,Name,Category,On hand,Period quantity purchased,Purchase amount,Purchase velocity per day,Rank\n'
        const cr: any[] = reportData.rows || []
        cr.forEach((r: any) => {
          csvContent += [
            escapeCsv(r.movement_tier),
            escapeCsv(r.sku),
            escapeCsv(r.name),
            escapeCsv(r.reporting_category),
            r.quantity_on_hand ?? '',
            r.period_quantity_purchased ?? '',
            r.period_purchase_amount ?? '',
            r.purchase_velocity_per_day ?? '',
            r.velocity_rank ?? '',
          ].join(',')
          csvContent += '\n'
        })
      } else if (selectedReport === 'shift-summary' && reportData.sessions) {
        csvContent += 'Cashier,Station,Opened,Closed,Status,Transactions,Sales,Liters,Cash Expected,Cash Counted,Variance\n'
        reportData.sessions.forEach((session: any) => {
          csvContent += `${escapeCsv(session.cashier_name)},${escapeCsv(session.station_name)},${escapeCsv(session.opened_at)},${escapeCsv(session.closed_at || '')},${escapeCsv(session.status)},${session.transaction_count || 0},${session.total_sales || 0},${session.total_liters || 0},${session.cash_expected || 0},${session.cash_counted || 0},${session.variance || 0}\n`
        })
      } else if (selectedReport === 'tank-dip-register' && reportData.entries) {
        csvContent +=
          'Line,Date,Station,Tank,Product,Book (L),Stick (L),Variance (L),% Capacity,Est Value,Water (L),Notes\n'
        ;(reportData.entries as any[]).forEach((row: any, idx: number) => {
          csvContent += `${idx + 1},${escapeCsv(row.dip_date)},${escapeCsv(row.station_name)},${escapeCsv(row.tank_name)},${escapeCsv(row.product_name)},${row.book_before_liters ?? ''},${row.measured_liters ?? 0},${row.variance_liters ?? ''},${row.variance_pct_of_capacity ?? ''},${row.variance_value_estimate ?? ''},${row.water_level_liters ?? ''},${escapeCsv(row.notes || '')}\n`
        })
      } else if (selectedReport === 'tank-dip-variance' && reportData.dips) {
        csvContent += 'Date,Tank,Product,System Qty (L),Measured Qty (L),Variance (L),Value,Type,Recorded By\n'
        reportData.dips.forEach((dip: any) => {
          const dr = dip.reading_date || dip.dip_date
          const sys = dip.system_quantity ?? dip.book_volume ?? 0
          const meas = dip.measured_quantity ?? dip.dip_volume ?? 0
          const vq = dip.variance_quantity ?? dip.variance ?? 0
          const vt = dip.variance_type || (Number(vq) > 0 ? 'GAIN' : Number(vq) < 0 ? 'LOSS' : 'EVEN')
          csvContent += `${escapeCsv(dr)},${escapeCsv(dip.tank_name)},${escapeCsv(dip.product_name)},${sys},${meas},${vq},${dip.variance_value ?? 0},${escapeCsv(vt)},${escapeCsv(dip.recorded_by || '')}\n`
        })
      } else if (selectedReport === 'balance-sheet') {
        csvContent += 'Section,Account Code,Account Name,Balance\n'
        if (reportData.assets?.accounts) {
          reportData.assets.accounts.forEach((acc: any) => {
            csvContent += `Assets,${escapeCsv(acc.account_code)},${escapeCsv(acc.account_name)},${acc.balance || 0}\n`
          })
        }
        if (reportData.liabilities?.accounts) {
          reportData.liabilities.accounts.forEach((acc: any) => {
            csvContent += `Liabilities,${escapeCsv(acc.account_code)},${escapeCsv(acc.account_name)},${acc.balance || 0}\n`
          })
        }
        if (reportData.equity?.accounts) {
          reportData.equity.accounts.forEach((acc: any) => {
            csvContent += `Equity,${escapeCsv(acc.account_code)},${escapeCsv(acc.account_name)},${acc.balance || 0}\n`
          })
        }
      } else if (selectedReport === 'income-statement') {
        csvContent += 'Section,Account Code,Account Name,Balance\n'
        if (reportData.income?.accounts) {
          reportData.income.accounts.forEach((acc: any) => {
            csvContent += `Income,${escapeCsv(acc.account_code)},${escapeCsv(acc.account_name)},${acc.balance || 0}\n`
          })
        }
        if (reportData.cost_of_goods_sold?.accounts) {
          reportData.cost_of_goods_sold.accounts.forEach((acc: any) => {
            csvContent += `Cost of Goods Sold,${escapeCsv(acc.account_code)},${escapeCsv(acc.account_name)},${acc.balance || 0}\n`
          })
        }
        if (reportData.expenses?.accounts) {
          reportData.expenses.accounts.forEach((acc: any) => {
            csvContent += `Expenses,${escapeCsv(acc.account_code)},${escapeCsv(acc.account_name)},${acc.balance || 0}\n`
          })
        }
        csvContent += `\nGross Profit,${reportData.gross_profit || 0}\n`
        csvContent += `Net Income,${reportData.net_income || 0}\n`
      } else if (selectedReport === 'liabilities-detail' && reportData.accounts) {
        csvContent += 'Account id,Code,Name,Type,Balance\n'
        reportData.accounts.forEach((acc: any) => {
          csvContent += `${acc.account_id ?? ''},${escapeCsv(acc.account_code)},${escapeCsv(acc.account_name)},${escapeCsv(acc.account_type)},${acc.balance ?? 0}\n`
        })
        csvContent += `Total,,,,${reportData.total_liabilities ?? 0}\n`
      } else if (selectedReport === 'loan-receivable-gl' && reportData.accounts) {
        csvContent += 'Account id,Code,Name,Sub-type,Balance\n'
        reportData.accounts.forEach((acc: any) => {
          csvContent += `${acc.account_id ?? ''},${escapeCsv(acc.account_code)},${escapeCsv(acc.account_name)},${escapeCsv(acc.account_sub_type)},${acc.balance ?? 0}\n`
        })
        csvContent += `Total,,,,${reportData.total_loan_receivable_gl ?? 0}\n`
      } else if (selectedReport === 'loan-payable-gl' && reportData.accounts) {
        csvContent += 'Account id,Code,Name,Sub-type,Balance\n'
        reportData.accounts.forEach((acc: any) => {
          csvContent += `${acc.account_id ?? ''},${escapeCsv(acc.account_code)},${escapeCsv(acc.account_name)},${escapeCsv(acc.account_sub_type)},${acc.balance ?? 0}\n`
        })
        csvContent += `Total,,,,${reportData.total_loan_payable_gl ?? 0}\n`
      } else if (selectedReport === 'loans-borrow-and-lent') {
        csvContent += 'Direction,Loan no,Party,Status,Outstanding,Period disb,Period pmt,Principal GL,Settlement GL,Interest GL,Accrual GL\n'
        const dump = (dir: string, rows: any[]) => {
          rows.forEach((row: any) => {
            csvContent += [
              dir,
              escapeCsv(row.loan_no),
              escapeCsv(row.counterparty_name),
              escapeCsv(row.status),
              row.outstanding_principal ?? 0,
              row.period_disbursements ?? 0,
              row.period_repayments ?? 0,
              row.principal_account_id ?? '',
              row.settlement_account_id ?? '',
              row.interest_account_id ?? '',
              row.interest_accrual_account_id ?? '',
            ].join(',')
            csvContent += '\n'
          })
        }
        dump('borrowed', reportData.borrowed || [])
        dump('lent', reportData.lent || [])
      } else if (selectedReport === 'daily-summary') {
        csvContent += buildDailySummaryCsv(reportData as Record<string, unknown>)
      } else if (selectedReport === 'fuel-sales') {
        csvContent += 'Metric,Value\n'
        csvContent += `Fuel line count,${reportData.total_sales ?? 0}\n`
        csvContent += `Invoices with fuel,${reportData.invoice_count ?? 0}\n`
        csvContent += `Total liters,${reportData.total_quantity_liters ?? 0}\n`
        csvContent += `Total amount,${reportData.total_amount ?? 0}\n`
        csvContent += `Average per fuel line,${reportData.average_sale_amount ?? 0}\n`
      } else if (
        EXTRA_FINANCIAL_REPORT_IDS.includes(
          selectedReport as (typeof EXTRA_FINANCIAL_REPORT_IDS)[number],
        )
      ) {
        const extraCsv = buildExtraFinancialReportCsv(
          selectedReport,
          reportData as Record<string, unknown>,
        )
        if (extraCsv) csvContent += extraCsv
      } else if (String(selectedReport).startsWith('aquaculture-')) {
        csvContent += 'Aquaculture report (BDT).\n'
        if (reportData.summary && typeof reportData.summary === 'object') {
          csvContent += 'Summary\n'
          Object.entries(reportData.summary as Record<string, unknown>).forEach(([k, v]) => {
            csvContent += `${k},${v}\n`
          })
        }
        if (selectedReport === 'aquaculture-pond-pl' && Array.isArray(reportData.ponds)) {
          csvContent +=
            '\nPond,Revenue,Feed consumption,Medicine consumption,Other consumption,Fry/fingerling,Lease,Salaries & payroll,Other operating,Total costs,Net profit\n'
          ;(reportData.ponds as any[]).forEach((p: any) => {
            csvContent += [
              escapeCsv(p.pond_name),
              p.revenue,
              p.feed_consumption_cost ?? '',
              p.medicine_consumption_cost ?? '',
              p.other_consumption_cost ?? '',
              p.fry_fingerling_cost ?? '',
              p.lease_cost ?? '',
              p.salaries_and_payroll_cost ?? '',
              p.other_operating_expenses ?? '',
              p.total_costs ?? p.expense_total ?? '',
              p.net_profit ?? p.profit ?? '',
            ].join(',')
            csvContent += '\n'
          })
          const tt = reportData.totals || {}
          csvContent += [
            'Total',
            tt.revenue ?? '',
            tt.feed_consumption_cost ?? '',
            tt.medicine_consumption_cost ?? '',
            tt.other_consumption_cost ?? '',
            tt.fry_fingerling_cost ?? '',
            tt.lease_cost ?? '',
            tt.salaries_and_payroll_cost ?? '',
            tt.other_operating_expenses ?? '',
            tt.total_costs_and_expenses ?? tt.total_costs ?? '',
            tt.net_profit ?? tt.profit ?? '',
          ].join(',')
          csvContent += '\n'
        }
        const groupsCsv =
          selectedReport === 'aquaculture-feed-medicine-consumption'
            ? buildFeedMedicineConsumptionCsv(reportData as Record<string, unknown>)
            : buildAquacultureGroupsCsv(reportData as Record<string, unknown>)
        if (groupsCsv) csvContent += `\n${groupsCsv}`
        if (selectedReport === 'aquaculture-pond-sales-comprehensive' && reportData && typeof reportData === 'object') {
          const rd = reportData as Record<string, unknown>
          const fish = rd.fish_sales as Record<string, unknown> | undefined
          const pos = rd.pos_shop_sales as Record<string, unknown> | undefined
          if (fish) {
            csvContent += '\n--- Fish sales ---\n'
            csvContent += buildAquacultureGroupsCsv(fish)
          }
          if (pos) {
            csvContent += '\n--- Pond POS (non-fuel) ---\n'
            csvContent += buildAquacultureGroupsCsv(pos)
          }
        }
        const aqGenericCsv = buildGenericTabularCsv(reportData as Record<string, unknown>)
        if (aqGenericCsv) csvContent += `\n${aqGenericCsv}`
      } else {
        const genericCsv = buildGenericTabularCsv(reportData as Record<string, unknown>)
        if (genericCsv) {
          csvContent += genericCsv
        } else {
          const dataStr = JSON.stringify(reportData, null, 2)
          const dataBlob = new Blob([dataStr], { type: 'application/json' })
          const url = URL.createObjectURL(dataBlob)
          const link = document.createElement('a')
          link.href = url
          link.download = `${fileName}.json`
          link.click()
          URL.revokeObjectURL(url)
          return
        }
      }

      const dataBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(dataBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName}.csv`
      link.click()
      URL.revokeObjectURL(url)
    }
  }


  return (
    <ReportDrillProvider
      scope={{
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        siteScopeKey: reportStationId,
      }}
    >
    <div className="flex h-screen page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto app-scroll-pad">
        <AquaculturePageShell
          flush
          showBackLink={false}
          titleId="reports-title"
          eyebrow={pageMeta.eyebrow}
          eyebrowIcon={BarChart3}
          title={pageMeta.title}
          titleIcon={BarChart3}
          description={pageMeta.description ?? undefined}
          maxWidthClass="w-full"
          contentClassName="mt-4 space-y-4"
          actions={
            userRole !== 'cashier' ? (
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['all', 'All Reports'],
                    ['mix', 'Mix — Fuel & Aquaculture'],
                    ['financial', 'Financial'],
                    ['operational', 'Operational'],
                    ['inventory', 'Inventory'],
                    ['analytical', 'Analytical'],
                  ] as const
                ).map(([cat, label]) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFilterCategory(cat)}
                    className={filterCategory === cat ? AQ_HERO_BTN_PRIMARY : AQ_HERO_BTN_GHOST}
                  >
                    {label}
                  </button>
                ))}
                {showAquacultureReports ? (
                  <button
                    type="button"
                    onClick={() => setFilterCategory('aquaculture')}
                    className={
                      filterCategory === 'aquaculture' ? AQ_HERO_BTN_PRIMARY : AQ_HERO_BTN_GHOST
                    }
                  >
                    Aquaculture
                  </button>
                ) : null}
              </div>
            ) : null
          }
        >
          {userRole != null &&
            userRole !== 'operator' &&
            userRole !== 'pump_attendant' &&
            (reportStationList.length > 0 || showPondsInSiteScope) &&
            !(selectedReport && BUSINESS_LINE_REPORT_IDS.has(selectedReport)) && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-medium text-foreground">Site scope (operations, inventory, and GL)</p>
                    {userHasHomeStation ? (
                      <p className="text-muted-foreground">Limited to your assigned site.</p>
                    ) : (
                      <p className="text-muted-foreground">
                        Filter by one <strong>fuel station</strong>, <strong>shop hub (no fuel)</strong>, or{' '}
                        <strong>pond</strong>. <strong>All</strong> = company-wide totals plus per-entity breakdowns.
                      </p>
                    )}
                  </div>
                </div>
                {userHasHomeStation ? null : (
                  <div className="flex flex-col gap-1 sm:items-end">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-foreground/85" htmlFor="report-station-scope">
                        Site
                      </label>
                      <ReportSiteScopeSelect
                        id="report-station-scope"
                        value={reportStationId}
                        onChange={applyReportSiteScopeChange}
                        stations={reportStationList}
                        ponds={aquaculturePonds}
                        className="min-w-[16rem] rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground sm:text-right">
                      Saved in this browser · refreshes the open report
                    </p>
                  </div>
                )}
              </div>
            )}

          <div className="flex min-h-0 w-full min-w-0 flex-col gap-6 lg:max-h-[calc(100dvh-11rem)] lg:flex-row lg:items-stretch lg:gap-6 xl:gap-8">
            {/* Report list: fixed max width; main pane uses flex-1 for full usable width (especially for Analytics) */}
            <aside
              ref={reportListRef}
              className="w-full min-w-0 shrink-0 space-y-3 lg:max-h-full lg:max-w-[20rem] lg:overflow-y-auto lg:overscroll-y-contain lg:pr-1 xl:max-w-[22rem]"
            >
              {filteredReports.map((report) => {
                const Icon = report.icon
                const isSelected = selectedReport === report.id
                return (
                  <button
                    key={report.id}
                    type="button"
                    data-report-id={report.id}
                    data-report-selected={isSelected ? 'true' : undefined}
                    onClick={() => void fetchReport(report.id)}
                    disabled={loading}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      isSelected
                        ? 'border-teal-500 bg-accent ring-2 ring-teal-500/20'
                        : 'border-border bg-white hover:border-primary/30 hover:shadow-sm'
                    } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-start space-x-3">
                      <div className={`p-2 rounded-lg ${
                        isSelected ? 'bg-blue-100' : 'bg-muted'
                      }`}>
                        <Icon className={`h-5 w-5 ${
                          isSelected ? 'text-primary' : 'text-muted-foreground'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground">{report.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1">{report.description}</p>
                        <span className={`inline-block mt-2 text-xs px-2 py-1 rounded-full ${
                          report.category === 'financial' ? 'bg-success/15 text-success' :
                          report.category === 'operational' ? 'bg-blue-100 text-primary' :
                          report.category === 'inventory' ? 'bg-amber-100 text-warning-foreground' :
                          report.category === 'aquaculture' ? 'bg-cyan-100 text-cyan-800' :
                          'bg-purple-100 text-purple-700'
                        }`}>
                          {report.category.charAt(0).toUpperCase() + report.category.slice(1)}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </aside>

            {/* Report Display — flex-1 so charts and tables use the full right-hand workspace */}
            <div
              ref={reportDisplayRef}
              id="report-display-panel"
              className="min-h-0 w-full min-w-0 flex-1 scroll-mt-4 lg:max-h-full lg:overflow-y-auto lg:overscroll-y-contain"
            >
              <div className="min-h-[600px] w-full min-w-0 max-w-full rounded-lg border border-border bg-white">
                {loading ? (
                  <div className="flex h-[600px] items-center justify-center">
                    <div className="text-center">
                      <RefreshCw className="mx-auto mb-4 h-12 w-12 animate-spin text-primary" />
                      <p className="text-muted-foreground">Loading report...</p>
                    </div>
                  </div>
                ) : selectedReport === 'analytics-kpi' && reportData && '_analytics' in reportData && reportData._analytics ? (
                  <div className="w-full min-w-0 p-0">
                    <FinancialAnalyticsPanel embedInReports reportStationKey={reportStationId} />
                  </div>
                ) : selectedReport === 'aquaculture-pl-management' &&
                  reportData &&
                  '_aquaculturePlManagement' in reportData &&
                  reportData._aquaculturePlManagement ? (
                  <div className="w-full min-w-0 p-0">
                    <AquaculturePlManagementPanel
                      embedInReports
                      reportStationKey={reportStationId}
                      reportDateRange={dateRange}
                      reportAquaculturePondId={aquaculturePondId}
                      onReportDateChange={handleReportDateChange}
                    />
                  </div>
                ) : selectedReport && reportData ? (
                  <div className="p-6">
                    {/* Report Header */}
                    <div className="flex items-center justify-between mb-6 pb-4 border-b">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">
                      {filteredReports.find(r => r.id === selectedReport)?.title}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Generated on {formatDate(new Date())}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={printReport}
                      className="flex items-center space-x-2 px-4 py-2 bg-success text-white rounded-lg hover:bg-success/90 transition-colors"
                      title="Print Report"
                    >
                      <Printer className="h-4 w-4" />
                      <span>Print</span>
                    </button>
                    <button
                      onClick={() => downloadReport('json')}
                      className="erp-btn-secondary flex items-center space-x-2 bg-muted-foreground text-primary-foreground transition-colors"
                      title="Export as JSON"
                    >
                      <Download className="h-4 w-4" />
                      <span>JSON</span>
                    </button>
                    <button
                      onClick={() => downloadReport('csv')}
                      className="erp-btn-primary flex items-center space-x-2 transition-colors"
                      title="Export as CSV"
                    >
                      <Download className="h-4 w-4" />
                      <span>CSV</span>
                    </button>
                  </div>
                    </div>

                    {reportSiteScope && (
                      <div className="mb-6 flex gap-3 rounded-lg border border-warning/30/90 bg-warning/10/95 px-4 py-3 text-sm text-warning-foreground shadow-sm dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground dark:text-amber-300" />
                        <div>
                          <p className="font-semibold text-warning-foreground dark:text-amber-50">{reportSiteScope.headline}</p>
                          <p className="mt-0.5 text-warning-foreground/90 dark:text-amber-200/90">{reportSiteScope.detail}</p>
                        </div>
                      </div>
                    )}

                    {selectedReport &&
                      String(selectedReport).startsWith('aquaculture-') &&
                      userRole !== 'cashier' && (
                        <div className="mb-6 rounded-lg border border-cyan-200 bg-cyan-50/90 px-4 py-3 text-sm text-cyan-950 shadow-sm">
                          <p className="font-semibold text-cyan-900">Aquaculture filters</p>
                          <p className="mt-1 text-cyan-800/90">
                            Amounts in BDT — refresh after changing filters.
                            {pondLockedBySiteScope ? (
                              <span className="ml-1 font-medium">Pond is set by Site scope above.</span>
                            ) : null}
                          </p>
                          <div className="mt-3 flex flex-wrap items-end gap-3">
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-medium text-cyan-900" htmlFor="aq-report-pond">
                                Pond (optional)
                              </label>
                              <select
                                id="aq-report-pond"
                                value={effectiveAquaculturePondId}
                                disabled={pondLockedBySiteScope}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setAquaculturePondId(v)
                                  setAquacultureCycleId('')
                                }}
                                className="erp-field min-w-[12rem] rounded-md px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-muted"
                              >
                                <option value="">All ponds</option>
                                {aquaculturePonds.map((p) => (
                                  <option key={p.id} value={String(p.id)}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {selectedReport === 'aquaculture-pond-pl' && (
                              <>
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-medium text-cyan-900" htmlFor="aq-report-cycle">
                                    Production cycle (optional)
                                  </label>
                                  <select
                                    id="aq-report-cycle"
                                    value={aquacultureCycleId}
                                    onChange={(e) => setAquacultureCycleId(e.target.value)}
                                    disabled={!effectiveAquaculturePondId}
                                    className="min-w-[12rem] rounded-md border border-cyan-300 bg-white px-2 py-1.5 text-sm disabled:opacity-50"
                                  >
                                    <option value="">All cycles (pond scope)</option>
                                    {aquacultureCycles.map((c) => (
                                      <option key={c.id} value={String(c.id)}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <label className="flex items-center gap-2 text-xs font-medium text-cyan-900">
                                  <input
                                    type="checkbox"
                                    checked={aquacultureIncludeCycleBreakdown}
                                    onChange={(e) => setAquacultureIncludeCycleBreakdown(e.target.checked)}
                                    className="rounded border-cyan-400"
                                  />
                                  Include cycle breakdown (when not filtering by one cycle)
                                </label>
                              </>
                            )}
                            {selectedReport === 'aquaculture-fingerling-transfers' && (
                              <>
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-medium text-cyan-900" htmlFor="fl-report-search">
                                    Search
                                  </label>
                                  <input
                                    id="fl-report-search"
                                    type="search"
                                    value={fingerlingSearch}
                                    onChange={(e) => setFingerlingSearch(e.target.value)}
                                    placeholder="Pond, species, batch, memo…"
                                    className="erp-field min-w-[14rem] rounded-md px-2 py-1.5 text-sm"
                                  />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-medium text-cyan-900" htmlFor="fl-report-species">
                                    Species
                                  </label>
                                  <select
                                    id="fl-report-species"
                                    value={fingerlingSpecies}
                                    onChange={(e) => setFingerlingSpecies(e.target.value)}
                                    className="erp-field min-w-[10rem] rounded-md px-2 py-1.5 text-sm"
                                  >
                                    <option value="">All species</option>
                                    <option value="tilapia">Tilapia</option>
                                    <option value="pangas">Pangas</option>
                                    <option value="rui">Rui</option>
                                    <option value="koi">Koi</option>
                                    <option value="other">Other</option>
                                  </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-medium text-cyan-900" htmlFor="fl-nursing-pond">
                                    Nursing pond
                                  </label>
                                  <select
                                    id="fl-nursing-pond"
                                    value={fingerlingNursingPondId}
                                    onChange={(e) => setFingerlingNursingPondId(e.target.value)}
                                    className="erp-field min-w-[12rem] rounded-md px-2 py-1.5 text-sm"
                                  >
                                    <option value="">All nursing</option>
                                    {aquaculturePonds
                                      .filter((p) => (p.pond_role || '').toLowerCase() === 'nursing')
                                      .map((p) => (
                                        <option key={`n-${p.id}`} value={String(p.id)}>
                                          {p.name}
                                        </option>
                                      ))}
                                  </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-medium text-cyan-900" htmlFor="fl-growout-pond">
                                    Receiving pond
                                  </label>
                                  <select
                                    id="fl-growout-pond"
                                    value={fingerlingGrowoutPondId}
                                    onChange={(e) => setFingerlingGrowoutPondId(e.target.value)}
                                    className="erp-field min-w-[12rem] rounded-md px-2 py-1.5 text-sm"
                                  >
                                    <option value="">All grow-out</option>
                                    {aquaculturePonds
                                      .filter((p) => {
                                        const r = (p.pond_role || 'grow_out').toLowerCase()
                                        return r !== 'nursing'
                                      })
                                      .map((p) => (
                                        <option key={`g-${p.id}`} value={String(p.id)}>
                                          {p.name}
                                        </option>
                                      ))}
                                  </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-medium text-cyan-900" htmlFor="fl-min-cost">
                                    Min cost (BDT)
                                  </label>
                                  <input
                                    id="fl-min-cost"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={fingerlingMinCost}
                                    onChange={(e) => setFingerlingMinCost(e.target.value)}
                                    placeholder="0"
                                    className="erp-field w-[8rem] rounded-md px-2 py-1.5 text-sm tabular-nums"
                                  />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-medium text-cyan-900" htmlFor="fl-max-cost">
                                    Max cost (BDT)
                                  </label>
                                  <input
                                    id="fl-max-cost"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={fingerlingMaxCost}
                                    onChange={(e) => setFingerlingMaxCost(e.target.value)}
                                    placeholder="Any"
                                    className="erp-field w-[8rem] rounded-md px-2 py-1.5 text-sm tabular-nums"
                                  />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-medium text-cyan-900" htmlFor="fl-balance">
                                    Balance
                                  </label>
                                  <select
                                    id="fl-balance"
                                    value={fingerlingBalance}
                                    onChange={(e) =>
                                      setFingerlingBalance(e.target.value as 'all' | 'balanced' | 'unbalanced')
                                    }
                                    className="erp-field min-w-[10rem] rounded-md px-2 py-1.5 text-sm"
                                  >
                                    <option value="all">All transfers</option>
                                    <option value="balanced">Balanced only</option>
                                    <option value="unbalanced">Unbalanced only</option>
                                  </select>
                                </div>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => selectedReport && void fetchReport(selectedReport)}
                              className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800"
                            >
                              Refresh report
                            </button>
                          </div>
                        </div>
                      )}

                    {/* Report Content */}
                    <div className="space-y-6">
                      {/* Summary Section */}
                      {reportData.summary &&
                        (!selectedReport || !SUMMARY_EXCLUDED_REPORTS.includes(selectedReport)) ? (
                        <div>
                          <h3 className="text-lg font-semibold text-foreground mb-3">Summary</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {Object.entries(reportData.summary as Record<string, unknown>).map(([key, value], idx) => {
                              const summaryEntryKey = `${idx}-${key}`
                              const colorClasses = [
                                'from-accent to-blue-100 border-primary/25 text-primary',
                                'from-green-50 to-green-100 border-success/25 text-success',
                                'from-purple-50 to-purple-100 border-purple-200 text-purple-600',
                                'from-accent to-accent border-primary/25 text-primary',
                                'from-pink-50 to-pink-100 border-pink-200 text-pink-600',
                                'from-yellow-50 to-yellow-100 border-yellow-200 text-yellow-600'
                              ]
                              const colorClass = colorClasses[idx % colorClasses.length]
                              const iconColors = [
                                'bg-blue-200 text-primary',
                                'bg-green-200 text-success',
                                'bg-purple-200 text-purple-600',
                                'bg-accent text-primary',
                                'bg-pink-200 text-pink-600',
                                'bg-yellow-200 text-yellow-600'
                              ]
                              const iconColor = iconColors[idx % iconColors.length]
                              
                              return (
                                <div key={summaryEntryKey} className={`bg-gradient-to-br ${colorClass} border rounded-lg p-4 shadow-sm`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                      <p className={`text-xs uppercase tracking-wide font-medium ${colorClass.split(' ')[2]}`}>
                                  {key.replace(/_/g, ' ')}
                                </p>
                                      <p className={`text-xl font-bold mt-1 ${colorClass.split(' ')[2].replace('600', '900')}`}>
                                  {typeof value === 'number' ? (
                                    key.includes('percentage') ? `${formatNumber(Number(value))}%` :
                                    key.includes('amount') || key.includes('value') || key.includes('sales') || key.includes('expected') || key.includes('counted') ? 
                                            formatCurrency(value) :
                                          formatNumber(value, 0)
                                  ) : String(value)}
                                </p>
                              </div>
                                    <div className={`${iconColor} rounded-full p-2 ml-2`}>
                                      <BarChart3 className="h-4 w-4" />
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ) : null}

                      {/* Period Info - All period-based reports now have editable filters inside renderReportTable */}
                      {/* No separate period display needed here */}

                      {/* Table Data */}
                      {renderReportTable(
                        selectedReport,
                        reportData,
                        dateRange,
                        setDateRange,
                        fetchReport,
                        handleReportDateChange,
                        selectedReport && ITEM_SCOPED_REPORT_IDS.includes(selectedReport)
                          ? {
                              reportType: selectedReport,
                              category: itemScopeCategory,
                              onCategoryChange: onItemScopeCategoryChange,
                              selectedItemIds: itemScopeItemIds,
                              onToggleItem: toggleItemScopeId,
                              onSelectAllVisible: selectAllVisibleItemScope,
                              onClearItems: clearItemScopeSelection,
                              visibleItemOptions: itemScopeVisibleOptions,
                              categoryList: itemFilterCategoryList,
                              fetchReport,
                            }
                          : undefined,
                        BUSINESS_LINE_REPORT_IDS.has(selectedReport)
                          ? {
                              value: businessSegment,
                              onChange: onBusinessSegmentChange,
                              stations: reportStationList,
                              lockedSegment: lockedBusinessSegment,
                            }
                          : undefined,
                        SALES_PURCHASE_REPORT_IDS.has(selectedReport)
                          ? {
                              dateRange: salesPurchaseDateRange,
                              preset: salesPurchaseDatePreset,
                              onPresetChange: onSalesPurchasePresetChange,
                              onDateChange: onSalesPurchaseDateChange,
                            }
                          : undefined,
                        {
                          reportStationKey: reportStationId,
                          stations: reportStationList,
                          ponds: aquaculturePonds,
                          aquaculturePondId: effectiveAquaculturePondId,
                          onViewEntityPl: openEntityPlDetail,
                          onLoansStrictSiteChange:
                            selectedReport === 'loans-borrow-and-lent'
                              ? (strict) => {
                                  setLoansStrictSiteOnly(strict)
                                  void fetchReport('loans-borrow-and-lent', { strictSiteOnly: strict })
                                }
                              : undefined,
                        }
                      )}

                      {/* Alerts */}
                      {reportData.alerts && reportData.alerts.low_stock_tanks && reportData.alerts.low_stock_tanks.length > 0 && (
                        <div className="bg-destructive/5 border border-destructive/25 p-4 rounded-lg">
                          <h4 className="font-semibold text-destructive mb-2">⚠️ Low Stock Alerts</h4>
                          <ul className="space-y-1">
                            {reportData.alerts.low_stock_tanks.map((tank: any, idx: number) => (
                              <li key={idx} className="text-sm text-destructive">
                                {tank.tank_name} ({tank.product}): {formatNumber(Number(tank.fill_percentage))}% full
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[600px]">
                    <div className="text-center">
                      <FileText className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
                      <p className="text-muted-foreground text-lg">Select a report to view</p>
                      <p className="text-muted-foreground/70 text-sm mt-2">
                        Choose from the report cards on the left
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </AquaculturePageShell>
      </div>
    </div>
    </ReportDrillProvider>
  )
}

// Helper function to render editable period filter (for date range reports)
function renderPeriodFilter(
  period: { start_date?: string; end_date?: string },
  dateRange?: { startDate: string; endDate: string },
  reportType?: ReportType,
  onDateChange?: (field: 'startDate' | 'endDate' | 'range', value: string, reportId?: string) => void,
  description?: string
) {
  const currentStartDate = period?.start_date
    ? toDateInputValue(period.start_date)
    : (dateRange?.startDate || '')
  const currentEndDate = period?.end_date
    ? toDateInputValue(period.end_date)
    : (dateRange?.endDate || '')

  if (!currentStartDate && !currentEndDate) {
    return null
  }

  return (
    <PeriodFilter
      startDate={currentStartDate}
      endDate={currentEndDate}
      reportType={reportType}
      onDateChange={onDateChange}
      description={description || 'Data is filtered by this date range.'}
    />
  )
}

function renderItemScopeFilterPanel(
  reportType: ReportType,
  itemScope?: ItemScopeTableProps,
  options?: { panelTitle?: string; applyHint?: string },
) {
  if (!itemScope) return null
  const ic = itemScope
  return (
    <div className="rounded-xl border border-border bg-muted/50 p-4 shadow-sm">
      <p className="mb-3 text-sm font-medium text-foreground">
        {options?.panelTitle || 'Scope: category and products (optional)'}
      </p>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Category</label>
          <select
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
            value={ic.category}
            onChange={(e) => ic.onCategoryChange(e.target.value)}
          >
            <option value="">All categories</option>
            {ic.categoryList.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            {options?.applyHint ||
              'Narrow the product list. Leave empty to include every category.'}
          </p>
        </div>
        <div className="min-w-0 flex-[2]">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-medium uppercase text-muted-foreground">Item (multi-select)</label>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => ic.onSelectAllVisible()}
              >
                Select all in list
              </button>
              <span className="text-muted-foreground/40">|</span>
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground hover:underline"
                onClick={() => ic.onClearItems()}
              >
                Clear selection
              </button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-white p-2">
            {ic.visibleItemOptions.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">
                No products match this category. Clear category or add items in Products.
              </p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-1 md:grid-cols-2">
                {ic.visibleItemOptions.map((it) => {
                  const checked = ic.selectedItemIds.includes(it.id)
                  return (
                    <li key={it.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        id={`rpt-item-${reportType}-${it.id}`}
                        checked={checked}
                        onChange={() => ic.onToggleItem(it.id)}
                        className="h-4 w-4 rounded border-border"
                      />
                      <label
                        htmlFor={`rpt-item-${reportType}-${it.id}`}
                        className="flex-1 cursor-pointer truncate text-foreground"
                      >
                        <span className="font-mono text-xs text-muted-foreground">{it.item_number || it.id}</span> —{' '}
                        {it.name}
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {ic.selectedItemIds.length} selected. Leave all unchecked to include every product in the
            chosen category (or all products when category is empty).
          </p>
        </div>
        <div className="flex shrink-0 items-end">
          <button
            type="button"
            onClick={() => void ic.fetchReport(reportType)}
            className="erp-btn-primary rounded-md px-4 py-2.5 text-sm font-medium"
          >
            Apply filters
          </button>
        </div>
      </div>
    </div>
  )
}

function renderAquacultureFcrBlock(data: Record<string, unknown> | null | undefined) {
  const fcr = data?.fcr as Record<string, unknown> | undefined
  if (!fcr) return null
  const scoped = (fcr.scoped ?? fcr.portfolio) as Record<string, unknown> | undefined
  if (!scoped) return null
  const feed = Number(scoped.feed_kg ?? 0)
  const gain = Number(scoped.biomass_gain_kg ?? 0)
  const harvest = Number(scoped.harvest_kg ?? 0)
  const fcrBio = scoped.fcr_biomass != null ? Number(scoped.fcr_biomass) : null
  const fcrHar = scoped.fcr_harvest != null ? Number(scoped.fcr_harvest) : null
  if (feed <= 0 && gain <= 0 && harvest <= 0) return null
  return (
    <div className="rounded-lg border border-primary/25 bg-accent/50 px-4 py-3">
      <h4 className="text-sm font-semibold text-teal-950">Feed conversion (FCR) — period</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div>
          <span className="text-xs text-primary/80">Feed recorded</span>
          <p className="font-semibold tabular-nums text-teal-950">{feed > 0 ? `${formatNumber(feed, 2)} kg` : '—'}</p>
        </div>
        <div>
          <span className="text-xs text-primary/80">Biomass gain (sampling)</span>
          <p className="font-semibold tabular-nums text-teal-950">{gain > 0 ? `${formatNumber(gain, 2)} kg` : '—'}</p>
        </div>
        <div>
          <span className="text-xs text-primary/80">FCR (feed ÷ biomass gain)</span>
          <p className="font-semibold tabular-nums text-teal-950">
            {fcrBio != null && Number.isFinite(fcrBio) ? formatNumber(fcrBio, 2) : '—'}
          </p>
        </div>
        <div>
          <span className="text-xs text-primary/80">FCR (feed ÷ harvest kg)</span>
          <p className="font-semibold tabular-nums text-teal-950">
            {fcrHar != null && Number.isFinite(fcrHar) ? formatNumber(fcrHar, 2) : '—'}
          </p>
        </div>
      </div>
      {typeof fcr.methodology === 'string' ? (
        <p className="mt-2 text-[11px] leading-relaxed text-primary/70">{fcr.methodology}</p>
      ) : null}
    </div>
  )
}

const REPORT_PERIOD_DATE_INPUT_CLS =
  'px-3 py-1.5 border border-blue-300 rounded-md text-sm text-foreground/85 focus:outline-none focus:ring-2 focus:ring-ring focus:border-blue-500 bg-white shadow-sm min-w-[9.5rem]'

function PeriodFilter({
  startDate,
  endDate,
  reportType,
  onDateChange,
  description,
}: {
  startDate: string
  endDate: string
  reportType?: ReportType
  onDateChange?: (field: 'startDate' | 'endDate' | 'range', value: string, reportId?: string) => void
  description: string
}) {
  // Explicit "Custom" selection: the range can still match a preset (e.g. today),
  // so we track an intentional custom pick separately from range inference.
  const [explicitCustom, setExplicitCustom] = useState(false)

  // A new report resets the selection back to whatever its range implies.
  useEffect(() => {
    setExplicitCustom(false)
  }, [reportType])

  const activePreset = explicitCustom
    ? 'custom'
    : inferSalesPurchasePreset({ startDate, endDate })

  return (
    <div className="bg-blue-50 border border-primary/25 p-4 rounded-lg">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium text-primary whitespace-nowrap">
            Report Period:
          </label>
          <div className="flex flex-wrap gap-1.5">
            {SALES_PURCHASE_PERIOD_PRESETS.map((p) => {
              const isActive = activePreset === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (p.id === 'custom') {
                      setExplicitCustom(true)
                      return
                    }
                    setExplicitCustom(false)
                    const r = salesPurchaseRangeForPreset(p.id)
                    onDateChange?.('range', `${r.startDate}|${r.endDate}`, reportType)
                  }}
                  className={[
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-white shadow-sm'
                      : 'border border-primary/25 bg-white text-primary hover:bg-blue-100',
                  ].join(' ')}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-4 border-t border-blue-100 pt-3">
          <div className="flex items-center space-x-2 flex-wrap">
            <CompanyDateInput
              value={startDate}
              max={endDate || undefined}
              onChange={(iso) => {
                setExplicitCustom(true)
                onDateChange?.('startDate', iso, reportType)
              }}
              className={REPORT_PERIOD_DATE_INPUT_CLS}
            />
            <span className="text-sm text-primary font-medium">to</span>
            <CompanyDateInput
              value={endDate}
              min={startDate || undefined}
              max={localDateISO()}
              onChange={(iso) => {
                setExplicitCustom(true)
                onDateChange?.('endDate', iso, reportType)
              }}
              className={REPORT_PERIOD_DATE_INPUT_CLS}
            />
          </div>
          <p className="text-xs text-primary mt-2 md:mt-0">
            {description}
          </p>
        </div>
      </div>
    </div>
  )
}

// Helper function to render editable single date filter (for single-date reports)
function renderDateFilter(
  date: string | undefined,
  dateRange?: { startDate: string; endDate: string },
  reportType?: ReportType,
  onDateChange?: (field: 'startDate' | 'endDate', value: string, reportId?: string) => void,
  label?: string,
  description?: string
) {
  const currentDate = date ? toDateInputValue(date) : (dateRange?.endDate || '')
  
  const defaultLabel = "Report Date:"
  const defaultDescription = "Data is filtered by this date."
  const displayLabel = label || defaultLabel
  const displayDescription = description || defaultDescription
  
  if (!currentDate) {
    return null
  }
  
  return (
    <div className="bg-blue-50 border border-primary/25 p-4 rounded-lg">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center space-x-3 flex-wrap">
          <label className="text-sm font-medium text-primary whitespace-nowrap">
            {displayLabel}
          </label>
          <div className="flex items-center space-x-2">
            <CompanyDateInput
              value={currentDate}
              max={localDateISO()}
              onChange={(iso) => onDateChange?.('endDate', iso, reportType)}
              className={REPORT_PERIOD_DATE_INPUT_CLS}
            />
          </div>
        </div>
        <p className="text-xs text-primary mt-2 md:mt-0">
          {displayDescription}
        </p>
      </div>
    </div>
  )
}

/** Opens Chart of Accounts with the account statement for this GL id (`?ledger=`). */
function GlLedgerIconLink({
  accountId,
  label,
}: {
  accountId: number | null | undefined
  label: string
}) {
  if (accountId == null || !Number.isFinite(Number(accountId)) || Number(accountId) < 1) {
    return <span className="text-xs text-muted-foreground/40">—</span>
  }
  return (
    <Link
      href={`/chart-of-accounts?ledger=${accountId}`}
      className="inline-flex rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
      title={`${label} — GL ledger`}
      aria-label={`${label} — open general ledger`}
    >
      <BookOpen className="h-4 w-4 shrink-0" />
    </Link>
  )
}

function LoanFacilitiesTable({
  rows,
  tone,
  drillScope,
}: {
  rows: any[]
  tone: 'borrowed' | 'lent'
  drillScope?: import('@/components/reports/reportDrillResolver').ReportDrillScope
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/40">
          <tr>
            <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Loan</th>
            <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Party</th>
            <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Outstanding</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Period disb.</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Period pmt</th>
            <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground" colSpan={4}>
              GL ledgers
            </th>
          </tr>
          <tr className="border-t border-border/70 bg-muted/40/80">
            <th colSpan={6} />
            <th className="px-1 py-2 text-center text-[10px] font-normal text-muted-foreground">Principal</th>
            <th className="px-1 py-2 text-center text-[10px] font-normal text-muted-foreground">Settlement</th>
            <th className="px-1 py-2 text-center text-[10px] font-normal text-muted-foreground">Interest</th>
            <th className="px-1 py-2 text-center text-[10px] font-normal text-muted-foreground">Accrual</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-white">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                No {tone === 'borrowed' ? 'borrowed' : 'lent'} facilities in this scope.
              </td>
            </tr>
          ) : (
            rows.map((row: any) => (
              <tr key={row.id} className="hover:bg-muted/40">
                <td className="max-w-[14rem] px-3 py-3 align-top">
                  <div className="flex items-start gap-2">
                    <Link
                      href="/loans"
                      className="mt-0.5 shrink-0 text-muted-foreground/70 hover:text-primary"
                      title="Open loans workspace"
                      aria-label="Open loans"
                    >
                      <Landmark className="h-4 w-4" />
                    </Link>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{row.loan_no}</p>
                      {row.title ? <p className="truncate text-xs text-muted-foreground">{row.title}</p> : null}
                      {row.deal_reference ? <p className="text-xs text-muted-foreground/70">Ref: {row.deal_reference}</p> : null}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 align-top text-sm text-foreground">
                  <span className="font-medium">{row.counterparty_name || '—'}</span>
                  {row.counterparty_code ? (
                    <span className="ml-1 font-mono text-xs text-muted-foreground">({row.counterparty_code})</span>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {row.product_type} · {row.banking_model}
                  </p>
                </td>
                <td className="whitespace-nowrap px-3 py-3 align-top text-sm capitalize text-foreground/85">{row.status}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                  <ReportAmountCell amount={row.outstanding_principal} row={row} field="outstanding_principal" scope={drillScope} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-sm tabular-nums text-foreground">
                  <ReportAmountCell amount={row.period_disbursements} row={row} field="period_disbursements" scope={drillScope} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-sm tabular-nums text-foreground">
                  <ReportAmountCell amount={row.period_repayments} row={row} field="period_repayments" scope={drillScope} />
                </td>
                <td className="px-1 py-2 text-center align-middle">
                  <GlLedgerIconLink accountId={row.principal_account_id} label="Principal" />
                </td>
                <td className="px-1 py-2 text-center align-middle">
                  <GlLedgerIconLink accountId={row.settlement_account_id} label="Settlement (bank/cash)" />
                </td>
                <td className="px-1 py-2 text-center align-middle">
                  <GlLedgerIconLink accountId={row.interest_account_id} label="Interest income/expense" />
                </td>
                <td className="px-1 py-2 text-center align-middle">
                  <GlLedgerIconLink accountId={row.interest_accrual_account_id} label="Accrued interest" />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function renderReportTable(
  reportType: ReportType,
  data: any,
  dateRange?: { startDate: string; endDate: string },
  setDateRange?: (range: { startDate: string; endDate: string }) => void,
  fetchReport?: (reportId: ReportType) => Promise<void>,
  handleReportDateChange?: (field: 'startDate' | 'endDate' | 'range', value: string, reportId?: string) => void,
  itemScope?: ItemScopeTableProps,
  businessSegmentProps?: BusinessSegmentTableProps,
  salesPurchasePeriodProps?: SalesPurchasePeriodTableProps,
  scopeLabels?: ReportScopeTableProps
) {
  const reportLang = getTenantLocaleConfig().language
  const rt = (key: Parameters<typeof i18nT>[0]) => i18nT(key, reportLang)
  const pondTotal = (singleName?: string | null) =>
    scopeLabels
      ? resolveReportTotalLabel(
          'pond',
          scopeLabels.reportStationKey,
          scopeLabels.stations,
          scopeLabels.ponds,
          { aquaculturePondId: scopeLabels.aquaculturePondId, singleName }
        )
      : singleName
        ? `Total — ${singleName}`
        : 'Total — all ponds'

  const grandPondTotal = (singleName?: string | null) =>
    scopeLabels
      ? resolveGrandTotalLabel(
          'pond',
          scopeLabels.reportStationKey,
          scopeLabels.stations,
          scopeLabels.ponds,
          { aquaculturePondId: scopeLabels.aquaculturePondId, singleName }
        )
      : singleName
        ? `Grand total — ${singleName}`
        : 'Grand total — all ponds'

  const period = data?.period || {}
  const periodDateRange = salesPurchasePeriodProps?.dateRange ?? dateRange
  const hasPeriod =
    REPORTS_WITH_PERIOD.has(reportType) &&
    (period.start_date ||
      period.end_date ||
      periodDateRange?.startDate ||
      periodDateRange?.endDate)

  const reportDrillScope = () => {
    const site = parseReportSiteScopeKey(scopeLabels?.reportStationKey || '')
    return {
      startDate: period.start_date || dateRange?.startDate,
      endDate: period.end_date || dateRange?.endDate,
      stationId: site.kind === 'station' ? site.id : null,
      pondId: site.kind === 'pond' ? site.id : null,
      reportType,
    }
  }

  const Money = (amount: unknown, row?: Record<string, unknown>, field?: string) => (
    <ReportAmountCell amount={Number(amount ?? 0)} row={row} field={field} scope={reportDrillScope()} />
  )

  const MoneyBdt = (amount: unknown, row?: Record<string, unknown>, field?: string) => (
    <ReportAmountCell amount={Number(amount ?? 0)} row={row} field={field} scope={reportDrillScope()} currency="BDT" />
  )

  if (EXTRA_FINANCIAL_REPORT_IDS.includes(reportType as (typeof EXTRA_FINANCIAL_REPORT_IDS)[number])) {
    const extra = renderExtraFinancialReport(reportType, data, {
      hasPeriod,
      renderPeriodFilter: (props) =>
        renderPeriodFilter(
          props.period,
          dateRange,
          reportType,
          handleReportDateChange,
          props.hint,
        ),
      period,
      dateRange,
      handleReportDateChange,
      onViewEntityPl: scopeLabels?.onViewEntityPl,
      drillScope: reportDrillScope(),
    })
    if (extra) return extra
  }
  
  // Meter Readings - Check this first to ensure it's caught
  if (reportType === 'meter-readings' && data && (data.meters || data.summary || data.period)) {
    const meters = Array.isArray(data.meters) ? data.meters : []
    const summary = data.summary || {}
    
    return (
      <div className="space-y-6">
        {/* Period Info - Editable inline date inputs */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          "Sales data is filtered by this date range. Meter readings show opening/closing readings for the period."
        )}

        {/* Summary Section */}
        {summary && Object.keys(summary).length > 0 && (
          <div>
            <h4 className="font-semibold text-foreground mb-3">Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-muted/40 to-muted border border-border rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Meters</p>
                <p className="text-xl font-bold text-foreground mt-1">{summary.total_meters || 0}</p>
              </div>
                  <div className="bg-muted rounded-full p-2 ml-2">
                    <Gauge className="h-4 w-4 text-muted-foreground" />
              </div>
              </div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 border border-success/25 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-success uppercase tracking-wide font-medium">Total Sales</p>
                    <p className="text-xl font-bold text-green-900 mt-1">{summary.total_sales || 0}</p>
                  </div>
                  <div className="bg-green-200 rounded-full p-2 ml-2">
                    <TrendingUp className="h-4 w-4 text-success" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-accent to-blue-100 border border-primary/25 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-primary uppercase tracking-wide font-medium">Total Liters Dispensed</p>
                    <p className="text-xl font-bold text-blue-900 mt-1">{formatNumber(Number(summary.total_liters_dispensed || 0))}L</p>
                  </div>
                  <div className="bg-blue-200 rounded-full p-2 ml-2">
                    <Droplet className="h-4 w-4 text-primary" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-purple-600 uppercase tracking-wide font-medium">Total Amount</p>
                    <p className="text-xl font-bold text-purple-900 mt-1">{Money(summary.total_amount, summary, "total_amount")}</p>
                  </div>
                  <div className="bg-purple-200 rounded-full p-2 ml-2">
                    <DollarSign className="h-4 w-4 text-purple-600" />
                  </div>
                </div>
              </div>
              {summary.average_sale !== undefined && (
                <div className="bg-gradient-to-br from-accent to-accent border border-primary/25 rounded-lg p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-primary uppercase tracking-wide font-medium">Average Sale</p>
                      <p className="text-xl font-bold text-foreground/85 mt-1">
                        {Money(summary.average_sale, summary, 'average_sale')}
                      </p>
                    </div>
                    <div className="bg-accent rounded-full p-2 ml-2">
                      <BarChart3 className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Meters Table */}
        <div>
          <h4 className="font-semibold text-foreground mb-3">Meter Details (Filtered by Date Range)</h4>
          {meters.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Meter Number</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Meter Name</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Opening Reading</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Closing Reading</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Period Dispensed</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Total Sales</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Sales Liters</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Sales Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {meters.map((meter: any, index: number) => {
                    const openingReading = Number(meter.opening_reading || 0)
                    const closingReading = Number(meter.closing_reading || meter.current_reading || 0)
                    const periodDispensed = Math.max(0, Number(meter.period_dispensed !== undefined ? meter.period_dispensed : (closingReading - openingReading)))
                    
                    return (
                      <tr
                        key={meter.id != null ? `meter-${meter.id}` : `meter-${index}-${String(meter.meter_number ?? '')}`}
                        className="hover:bg-muted/40"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-foreground">{meter.meter_number || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{meter.meter_name || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                          {formatNumber(openingReading)}L
                          {meter.opening_reading_date && (
                            <span className="block text-xs text-muted-foreground/70 mt-1">
                              {formatDate(meter.opening_reading_date)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                          {formatNumber(closingReading)}L
                          {meter.closing_reading_date && (
                            <span className="block text-xs text-muted-foreground/70 mt-1">
                              {formatDateOnly(meter.closing_reading_date)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-primary font-medium">
                          {formatNumber(periodDispensed)}L
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                          {meter.total_sales || 0}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                          {formatNumber(Number(meter.total_liters || 0))}L
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                          {Money(meter.total_amount, meter, "total_amount")}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            meter.is_active !== false ? 'bg-success/15 text-success' : 'bg-muted text-foreground'
                          }`}>
                            {meter.is_active !== false ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {meters.length > 0 && (
                  <tfoot className="bg-muted/40">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                        Totals
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                        {summary.total_sales ?? meters.reduce((s: number, m: any) => s + Number(m.total_sales ?? 0), 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                        {formatNumber(Number(summary.total_liters_dispensed ?? meters.reduce((s: number, m: any) => s + Number(m.total_liters ?? 0), 0)))}{' '}
                        L
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                        {Money(
                          Number(summary.total_amount ?? meters.reduce((s: number, m: any) => s + Number(m.total_amount ?? 0), 0)),
                          documentsTotalRow(meters, { title: 'Meter sales', entityType: 'customers' }),
                          'total_amount',
                        )}
                      </td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <div className="bg-muted/40 border border-border rounded-lg p-12 text-center">
              <div className="flex flex-col items-center">
                <BarChart3 className="h-16 w-16 text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground text-lg font-medium">No meter readings found</p>
                <p className="text-muted-foreground/70 text-sm mt-2">
                  Try adjusting the date range or check if meters are properly configured
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Daily Summary — fuel forecourt vs aquaculture shop hub
  if (reportType === 'daily-summary' && data) {
    const period = data?.period || {}
    const businessLines: any[] = Array.isArray(data.business_lines) ? data.business_lines : []
    const segmentLabel = data.business_segment_label as string | undefined
    const segmentStationNames = Array.isArray(data.business_segment_station_names)
      ? (data.business_segment_station_names as string[])
      : undefined

    const renderDailyLineBlock = (bl: any, key: string) => {
      const isFuel = bl.line === 'fuel'
      const sales = bl.sales || {}
      const shifts = bl.shifts || {}
      const dips = bl.dips || {}
      const tanks = Array.isArray(bl.tanks) ? bl.tanks : []
      const byFuel = bl.by_product_fuel || {}
      const byCat = bl.by_pos_category || {}
      const aq = bl.aquaculture || {}
      const stationLabel = Array.isArray(bl.station_names) && bl.station_names.length
        ? bl.station_names.join(', ')
        : bl.label || ''

      const kpiCards = isFuel
        ? [
            { label: 'Transactions', value: sales.total_transactions ?? 0, icon: BarChart3, color: 'blue' },
            { label: 'Fuel liters', value: `${formatNumber(Number(sales.total_liters ?? 0))} L`, icon: Droplet, color: 'blue' },
            { label: 'Fuel sales', money: true, amount: sales.fuel_amount ?? sales.total_amount, row: sales, field: 'fuel_amount', icon: DollarSign, color: 'green' },
            { label: 'Shop / other', money: true, amount: sales.shop_amount ?? 0, row: sales, field: 'shop_amount', icon: Package, color: 'purple' },
            { label: 'Cash sales', money: true, amount: sales.cash_sales_total ?? 0, row: sales, field: 'cash_sales_total', icon: Banknote, color: 'green' },
            { label: 'Shifts', value: shifts.total_shifts ?? 0, icon: Users, color: 'indigo' },
            { label: 'Cash variance', money: true, amount: shifts.total_cash_variance, row: shifts, field: 'total_cash_variance', icon: DollarSign, color: 'yellow' },
            { label: 'Dip readings', value: dips.total_readings ?? 0, icon: Calendar, color: 'pink' },
            { label: 'Dip variance', value: `${formatNumber(Number(dips.net_variance_liters ?? dips.net_variance ?? 0))} L`, icon: TrendingUp, color: 'red' },
          ]
        : [
            { label: 'Transactions', value: sales.total_transactions ?? 0, icon: BarChart3, color: 'teal' },
            { label: 'Shop sales', money: true, amount: sales.shop_amount ?? sales.total_amount, row: sales, field: 'shop_amount', icon: DollarSign, color: 'green' },
            { label: 'Cash (walk-in)', money: true, amount: sales.cash_sales_total ?? 0, row: sales, field: 'cash_sales_total', icon: Banknote, color: 'green' },
            { label: 'Credit (pond POS)', money: true, amount: sales.credit_sales_total ?? 0, row: sales, field: 'credit_sales_total', icon: CreditCard, color: 'amber' },
            { label: 'Pond POS invoices', value: aq.pond_pos_invoice_count ?? 0, icon: Fish, color: 'teal' },
            { label: 'Pond POS total', money: true, amount: aq.pond_pos_sales_total ?? 0, row: aq, field: 'pond_pos_sales_total', icon: Fish, color: 'teal' },
            { label: 'Average sale', money: true, amount: sales.average_sale, row: sales, field: 'average_sale', icon: TrendingUp, color: 'purple' },
          ]

      return (
        <div key={key} className="space-y-5 rounded-xl border border-border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 pb-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                {isFuel ? <Droplet className="h-5 w-5 text-amber-600" /> : <Fish className="h-5 w-5 text-primary" />}
                {bl.label || (isFuel ? 'Fuel Station' : 'Aquaculture shop')}
              </h3>
              {stationLabel ? (
                <p className="text-sm text-muted-foreground mt-0.5">{stationLabel}</p>
              ) : null}
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isFuel ? 'bg-amber-100 text-warning-foreground' : 'bg-teal-100 text-primary'
              }`}
            >
              {isFuel ? 'Forecourt & general retail' : 'Aquaculture products & pond POS'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {kpiCards.map((item) => {
              const colorMap: Record<string, string> = {
                blue: 'from-accent to-blue-100 border-primary/25 text-primary bg-blue-200',
                green: 'from-green-50 to-green-100 border-success/25 text-success bg-green-200',
                purple: 'from-purple-50 to-purple-100 border-purple-200 text-purple-600 bg-purple-200',
                indigo: 'from-accent to-accent border-primary/25 text-primary bg-accent',
                yellow: 'from-yellow-50 to-yellow-100 border-yellow-200 text-yellow-600 bg-yellow-200',
                pink: 'from-pink-50 to-pink-100 border-pink-200 text-pink-600 bg-pink-200',
                red: 'from-red-50 to-red-100 border-destructive/25 text-destructive bg-red-200',
                teal: 'from-teal-50 to-teal-100 border-primary/25 text-primary bg-teal-200',
                amber: 'from-amber-50 to-amber-100 border-warning/30 text-amber-600 bg-amber-200',
              }
              const colors = colorMap[item.color] || colorMap.blue
              const [gradient, border, text, bg] = colors.split(' ')
              const Icon = item.icon
              return (
                <div key={item.label} className={`bg-gradient-to-br ${gradient} ${border} border rounded-lg p-3 shadow-sm`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className={`text-xs uppercase tracking-wide font-medium ${text}`}>{item.label}</p>
                      <p className={`text-xl font-bold mt-1 ${text.replace('600', '900')}`}>{item.money ? Money(item.amount, item.row as Record<string, unknown>, item.field) : item.value}</p>
                    </div>
                    <div className={`${bg} rounded-full p-1.5`}>
                      <Icon className={`h-4 w-4 ${text}`} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {isFuel && Object.keys(byFuel).length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2">Fuel by product</h4>
              <div className="overflow-x-auto border border-border/70 rounded-lg">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Product</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Lines</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Liters</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {Object.entries(byFuel as Record<string, { line_count?: number; liters?: number; amount?: number }>).map(
                      ([name, m]) => (
                        <tr key={name}>
                          <td className="px-3 py-2 font-medium text-foreground">{name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.line_count ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(Number(m.liters ?? 0))} L</td>
                          <td className="px-3 py-2 text-right font-medium">{Money(m.amount ?? 0, sales, 'total_amount')}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!isFuel && Object.keys(byCat).length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2">Sales by product category (POS)</h4>
              <div className="overflow-x-auto border border-border/70 rounded-lg">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Category</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Lines</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Qty</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {Object.entries(byCat as Record<string, { line_count?: number; quantity?: number; amount?: number }>).map(
                      ([cat, m]) => (
                        <tr key={cat}>
                          <td className="px-3 py-2 font-medium text-foreground">{cat}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.line_count ?? 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(Number(m.quantity ?? 0))}</td>
                          <td className="px-3 py-2 text-right font-medium">{Money(m.amount ?? 0, sales, 'total_amount')}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {isFuel && tanks.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2">Tank levels</h4>
              <div className="overflow-x-auto border border-border/70 rounded-lg">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Tank</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Product</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Capacity</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Stock</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Fill %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {tanks.map((tank: any, idx: number) => (
                      <tr key={`${tank.tank_name}-${idx}`}>
                        <td className="px-3 py-2 font-medium text-foreground">{tank.tank_name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{tank.product}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(tank.capacity ?? 0).toLocaleString()} L</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(tank.current_stock ?? 0).toLocaleString()} L</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatNumber(Number(tank.fill_percentage ?? 0))}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="space-y-6">
        {businessSegmentProps ? (
          <BusinessSegmentFilter
            value={businessSegmentProps.value}
            onChange={businessSegmentProps.onChange}
            stations={businessSegmentProps.stations}
            lockedSegment={businessSegmentProps.lockedSegment}
            activeLabel={segmentLabel}
            activeStationNames={segmentStationNames}
            hint="Fuel Station = forecourt, tanks, dips, and general retail. Aquaculture = Premium Agro shop (feed, medicine, fish, pond POS)."
          />
        ) : null}

        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          'Operations and sales for invoice dates in this range (non-draft).'
        )}

        {businessLines.length > 1 ? (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">
            <span className="font-semibold text-foreground">Company total:</span>{' '}
            {Money(data.sales?.total_amount ?? 0, data.sales, 'total_amount')} across {data.sales?.total_transactions ?? 0} transactions
            {Number(data.sales?.total_liters ?? 0) > 0 ? (
              <span> · {formatNumber(Number(data.sales.total_liters))} L fuel</span>
            ) : null}
          </div>
        ) : null}

        {businessLines.length > 0 ? (
          businessLines.map((bl, idx) => renderDailyLineBlock(bl, `bl-${bl.line}-${idx}`))
        ) : (
          renderDailyLineBlock(
            {
              line: 'fuel',
              label: 'Operations',
              sales: data.sales || {},
              shifts: data.shifts || {},
              dips: data.dips || {},
              tanks: data.tanks || [],
              by_product_fuel: data.sales?.by_product || {},
              by_pos_category: {},
              aquaculture: {},
            },
            'legacy'
          )
        )}

        {data.accounting_note ? (
          <p className="text-xs text-muted-foreground border-t border-border/70 pt-3">{data.accounting_note}</p>
        ) : null}
      </div>
    )
  }

  // Trial Balance
  if (reportType === 'trial-balance' && data) {
    const accounts = Array.isArray(data.accounts) ? data.accounts : (Array.isArray(data) ? data : [])
    const period = data?.period || {}
    const totalDebit = data?.total_debit || 0
    const totalCredit = data?.total_credit || 0
    const tbDrill = accountsTotalRow(accounts, 'Trial balance')

    return (
      <div className="space-y-6">
        {/* Report Period - Date Range */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          "Trial balance shows account balances as of the end date."
        )}

        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <strong className="text-warning-foreground">Cash from POS:</strong> this report only lists accounts that had journal
          activity in the selected <strong>date range</strong>. If you do not see cash, extend the start date to include
          your sale days, then look for codes <span className="font-mono">1010</span>, <span className="font-mono">1020</span>{' '}
          (cash / undeposited), or <span className="font-mono">1120</span> (card). Detail:{' '}
          <span className="font-medium">Chart of accounts</span> → open that line → statement.
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-accent to-blue-100 border border-primary/25 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-primary uppercase tracking-wide font-medium">Total Debit</p>
                <p className="text-2xl font-bold text-blue-900 mt-1">
                  {Money(totalDebit, tbDrill, 'total_debit')}
            </p>
          </div>
              <div className="bg-blue-200 rounded-full p-2 ml-2">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 border border-success/25 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-success uppercase tracking-wide font-medium">Total Credit</p>
                <p className="text-2xl font-bold text-green-900 mt-1">
                  {Money(totalCredit, tbDrill, 'total_credit')}
                </p>
              </div>
              <div className="bg-green-200 rounded-full p-2 ml-2">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
            </div>
          </div>
        </div>

        {/* Accounts Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Account Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Account Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Type</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Debit</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Credit</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Balance</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border">
              {accounts.length > 0 ? (
                accounts.map((account: any, idx: number) => {
                  const glDrill = glAccountDrill(account, reportDrillScope())
                  return (
                  <tr key={idx}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">{account.account_code}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">{account.account_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{account.account_type}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-foreground">
                      <DrillAmount amount={account.debit} drill={glDrill} disabled={!account.debit} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-foreground">
                      <DrillAmount amount={account.credit} drill={glDrill} disabled={!account.credit} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-foreground">
                      <DrillAmount amount={account.balance} drill={glDrill} />
                    </td>
                  </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <BarChart3 className="h-12 w-12 text-muted-foreground/40 mb-3" />
                      <p className="text-muted-foreground font-medium">No accounts found</p>
                      <p className="text-muted-foreground/70 text-sm mt-1">Set up your chart of accounts to generate a trial balance</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {accounts.length > 0 && (
              <tfoot className="bg-muted/40">
                <tr>
                  <td colSpan={3} className="px-6 py-3 text-sm font-medium text-foreground text-right">
                    Totals:
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-foreground text-right">
                    {Money(totalDebit, tbDrill, 'total_debit')}
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-foreground text-right">
                    {Money(totalCredit, tbDrill, 'total_credit')}
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-foreground text-right">
                    {Money(totalDebit - totalCredit, tbDrill, 'balance')}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )
  }

  // Balance Sheet
  if (reportType === 'balance-sheet' && data) {
    const sections = [
      { title: 'Assets', payload: data.assets },
      { title: 'Liabilities', payload: data.liabilities },
      { title: 'Equity', payload: data.equity },
    ]
    const period = data?.period || {}
    const assetAccounts = data.assets?.accounts ?? []
    const liabilityAccounts = data.liabilities?.accounts ?? []
    const equityAccounts = data.equity?.accounts ?? []
    const leAccounts = [...liabilityAccounts, ...equityAccounts]

    return (
      <div className="space-y-6">
        {/* Report Period - Date Range */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          "Balance sheet shows account balances as of the end date."
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {sections.map(({ title, payload }) => (
            <div key={title} className="bg-white border border-border rounded-lg shadow-sm">
              <div className="p-4 border-b bg-muted/40">
                <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                <p className="text-sm font-medium text-foreground/85 mt-1">
                  Total: {Money(payload?.total, accountsTotalRow(payload?.accounts ?? [], title), 'total')}
                </p>
              </div>
              <div className="divide-y divide-border">
                {(payload?.accounts ?? []).length > 0 ? (
                  (payload?.accounts ?? []).map((account: any, accIdx: number) => {
                    const glDrill = glAccountDrill(account, reportDrillScope())
                    return (
                    <div
                      key={`${title}-${accIdx}-${account.account_code ?? 'acct'}`}
                      className={`px-4 py-3 flex justify-between hover:bg-muted/40 transition-colors ${
                        account.is_auto_plug
                          ? 'bg-warning/10/80 border-l-2 border-amber-500'
                          : account.is_rollup
                            ? 'bg-emerald-50/70 border-l-2 border-emerald-500'
                            : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{account.account_name}</p>
                        <p className="text-xs text-muted-foreground">{account.account_code}</p>
                      </div>
                      <p className="text-sm font-semibold text-foreground ml-4 whitespace-nowrap">
                        <DrillAmount amount={account.balance} drill={glDrill} />
                      </p>
                    </div>
                    )
                  })
                ) : (
                  <div className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <FileText className="h-12 w-12 text-muted-foreground/40 mb-3" />
                      <p className="text-muted-foreground font-medium">No {title.toLowerCase()} accounts found</p>
                      <p className="text-muted-foreground/70 text-sm mt-1">Set up {title.toLowerCase()} accounts in your chart of accounts</p>
                    </div>
                  </div>
                )}
                {(payload?.accounts ?? []).length > 0 && (
                  <div className="flex justify-between items-center px-4 py-3 bg-muted/40 border-t border-border">
                    <span className="text-sm font-semibold text-foreground">Sub-total — {title}</span>
                    <span className="text-sm font-bold tabular-nums text-foreground">
                      {Money(payload?.total, accountsTotalRow(payload?.accounts ?? [], title), 'total')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        
        {/* Cumulative P&L tied to BS (backend rolls unclosed income/COGS/expense into equity) */}
        {typeof data.net_income_cumulative === 'number' &&
          data.net_income_cumulative !== 0 &&
          (() => {
            const ni = Number(data.net_income_cumulative)
            const gain = ni >= 0
            return (
              <div
                className={`rounded-lg border px-4 py-3 text-sm ${
                  gain
                    ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
                    : 'border-rose-200 bg-rose-50/80 text-rose-900'
                }`}
              >
                <p className="font-semibold">
                  {gain ? 'Net profit' : 'Net loss'} (cumulative through period end, on balance sheet)
                </p>
                <p className="mt-1 tabular-nums text-lg font-bold">{Money(ni, accountsTotalRow(leAccounts, 'Cumulative net income'), 'total')}</p>
                <p className={`mt-1 text-xs ${gain ? 'text-emerald-800/90' : 'text-rose-800/90'}`}>
                  Included under Equity as &quot;Net income (cumulative P&L — unclosed to equity)&quot; so Assets
                  match Liabilities + Equity. After closing P&amp;L to Retained Earnings, this rollup is usually
                  unnecessary.
                </p>
              </div>
            )
          })()}

        {data.is_balanced === false && (
          <div className="rounded-lg border border-amber-300 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
            <p className="font-semibold">Balance sheet still not tied (rounding or unusual accounts)</p>
            <p className="mt-1">
              Assets − (Liabilities + Equity) ={' '}
              <span className="font-mono tabular-nums">
                {formatCurrency(data.assets_minus_liabilities_equity ?? 0)}
              </span>
            </p>
          </div>
        )}

        {typeof data.auto_plug_amount === 'number' &&
          Math.abs(Number(data.auto_plug_amount)) > 0.02 && (
            <div className="rounded-lg border border-amber-300 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
              <p className="font-semibold">Automatic tie-out line (Σ-ADJ)</p>
              <p className="mt-1">
                A small equity line of {formatCurrency(data.auto_plug_amount)} was added so totals match. Review
                inactive accounts, non-standard chart types, or one-sided opening balances if this amount is large.
              </p>
            </div>
          )}

        {data.is_balanced === true && (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            Assets equal Liabilities + Equity (within ৳0.02), including cumulative P&amp;L in equity
            {typeof data.auto_plug_amount === 'number' && Math.abs(Number(data.auto_plug_amount)) > 0.02
              ? ' and any Σ-ADJ tie-out.'
              : '.'}
          </div>
        )}

        {/* Balance Sheet Totals */}
        <div className="bg-white border-2 border-border rounded-lg p-6 shadow-sm">
          <div className="flex justify-between items-center">
            <p className="text-lg font-semibold text-foreground">Total Assets</p>
            <p className="text-lg font-bold text-foreground">
              {Money(data.assets?.total, accountsTotalRow(assetAccounts, 'Total assets'), 'total')}
            </p>
          </div>
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-border">
            <p className="text-lg font-semibold text-foreground">Total Liabilities & Equity</p>
            <p className="text-lg font-bold text-foreground">
              {Money(
                data.total_liabilities_and_equity,
                accountsTotalRow(leAccounts, 'Total liabilities & equity'),
                'total',
              )}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Income Statement
  if (reportType === 'income-statement' && data) {
    const blocks = [
      { title: 'Income', payload: data.income, accent: 'border-emerald-200 bg-emerald-50/50' },
      {
        title: 'Cost of Goods Sold',
        payload: data.cost_of_goods_sold,
        accent: 'border-warning/30 bg-warning/10/50',
      },
      { title: 'Expenses', payload: data.expenses, accent: 'border-border bg-muted/40' },
    ]
    const period = data?.period || {}
    const incomeTotal = Number(data.income?.total ?? 0)
    const cogsTotal = Number(data.cost_of_goods_sold?.total ?? 0)
    const expenseTotal = Number(data.expenses?.total ?? 0)
    const incomeAccounts = data.income?.accounts ?? []
    const cogsAccounts = data.cost_of_goods_sold?.accounts ?? []
    const expenseAccounts = data.expenses?.accounts ?? []
    const allPlAccounts = [...incomeAccounts, ...cogsAccounts, ...expenseAccounts]
    const plIncomeDrill = accountsTotalRow(incomeAccounts, 'Income')
    const plCogsDrill = accountsTotalRow(cogsAccounts, 'COGS')
    const plExpenseDrill = accountsTotalRow(expenseAccounts, 'Expenses')
    const plAllDrill = accountsTotalRow(allPlAccounts, 'Profit & Loss')

    return (
      <div className="space-y-8">
        {/* Report Period - Date Range */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          "P&L includes posted journal activity from start through end date (not opening balances on revenue/expense accounts)."
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-emerald-200 bg-white p-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Income</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-emerald-900">{Money(incomeTotal, plIncomeDrill, 'total')}</p>
          </div>
          <div className="rounded-lg border-2 border-amber-400 bg-warning/10 p-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-warning-foreground">COGS</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-warning-foreground">{Money(cogsTotal, plCogsDrill, 'total')}</p>
          </div>
          <div className="rounded-lg border border-green-300 bg-green-50 p-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-success">Gross profit</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-green-900">
              {Money(data.gross_profit, accountsTotalRow([...incomeAccounts, ...cogsAccounts], 'Gross profit'), 'total')}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-white p-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expenses</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{Money(expenseTotal, plExpenseDrill, 'total')}</p>
          </div>
          <div className="col-span-2 rounded-lg border border-blue-300 bg-blue-50 p-3 shadow-sm sm:col-span-1 lg:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Net income</p>
            <p
              className={`mt-1 text-lg font-bold tabular-nums ${
                Number(data.net_income ?? 0) >= 0 ? 'text-blue-900' : 'text-destructive'
              }`}
            >
              {Money(data.net_income, plAllDrill, 'total')}
            </p>
          </div>
        </div>

        {data.period_matches_cumulative_change === false && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
            <p className="font-semibold">Period net income vs cumulative P&L change</p>
            <p className="mt-1">
              This period&apos;s net ({formatCurrency(data.net_income)}) differs from the change in cumulative P&amp;L (
              {formatCurrency(data.cumulative_net_income_change)}) by{' '}
              {formatCurrency(data.cumulative_vs_period_difference)}. That usually means an opening balance on an
              income, COGS, or expense account, or activity dated outside the selected range.
            </p>
          </div>
        )}

        {data.filter_pond_id != null ? (
          <AquaculturePlConsumptionSection
            management={resolvePlMgmtSnapshot(
              data as Record<string, unknown>,
              undefined,
              Number(data.filter_pond_id),
            )}
            entityName={
              typeof data.filter_pond_name === 'string' ? String(data.filter_pond_name) : undefined
            }
          />
        ) : null}

        <div className="space-y-6">
          {blocks.map(({ title, payload, accent }) => (
            <div key={title} className={`rounded-lg border bg-white shadow-sm ${accent}`}>
              <div className="flex items-center justify-between border-b border-inherit p-4">
                <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                <span className="text-sm font-bold tabular-nums text-foreground">
                  {Money(payload?.total, accountsTotalRow(payload?.accounts ?? [], title), 'total')}
                </span>
              </div>
              <div className="divide-y divide-border">
                {(payload?.accounts ?? []).length > 0 ? (
                  (payload?.accounts ?? []).map((account: any, accIdx: number) => {
                    const glDrill = glAccountDrill(account, reportDrillScope())
                    return (
                    <div
                      key={`${title}-${accIdx}-${account.account_code ?? 'acct'}`}
                      className="flex justify-between px-4 py-3 transition-colors hover:bg-card/80"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{account.account_name}</p>
                        <p className="text-xs text-muted-foreground">{account.account_code}</p>
                      </div>
                      <p className="ml-4 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">
                        <DrillAmount amount={account.balance} drill={glDrill} />
                      </p>
                    </div>
                    )
                  })
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {title === 'Cost of Goods Sold' ? (
                      <>
                        <p className="font-medium text-warning-foreground">No COGS activity in this period</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          COGS comes from <strong>posted sales</strong> of inventory items (POS / invoices): Dr COGS /
                          Cr inventory at each item&apos;s <strong>unit cost</strong> × quantity. Assigning a COGS
                          account on the item alone does not create P&amp;L amounts — you need sales in this date
                          range and a non-zero cost on the product (Items → Cost). Use chart type{' '}
                          <strong>Cost of goods sold</strong> (5100 fuel, 5120 shop, 5200 shrinkage). After fixing
                          costs, run{' '}
                          <code className="rounded bg-muted px-1">
                            python manage.py backfill_invoice_cogs
                          </code>{' '}
                          for past invoices.
                        </p>
                      </>
                    ) : (
                      <>No {title.toLowerCase()} accounts with activity in this period</>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border bg-muted/50 px-4 py-3">
                  <span className="text-sm font-semibold text-foreground">Sub-total — {title}</span>
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {Money(payload?.total ?? 0, accountsTotalRow(payload?.accounts ?? [], title), 'total')}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary Totals */}
        {(() => {
          const grossProfit = Number(data.gross_profit ?? 0)
          const netIncome = Number(data.net_income ?? 0)
          const grossMargin = incomeTotal !== 0 ? (grossProfit / incomeTotal) * 100 : 0
          const netMargin = incomeTotal !== 0 ? (netIncome / incomeTotal) * 100 : 0

          return (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-green-50 to-card border-2 border-green-300 rounded-lg p-5 shadow-sm">
                  <p className="text-xs text-success uppercase tracking-wide font-semibold">Gross Profit</p>
                  <p className="text-2xl font-bold text-success mt-2">
                    {Money(grossProfit, accountsTotalRow([...incomeAccounts, ...cogsAccounts], 'Gross profit'), 'total')}
                  </p>
                  <p className="text-xs text-success mt-1">
                    Income − COGS · {grossMargin.toFixed(1)}% margin
                  </p>
                </div>
                <div className="bg-gradient-to-br from-accent to-card border-2 border-blue-300 rounded-lg p-5 shadow-sm">
                  <p className="text-xs text-primary uppercase tracking-wide font-semibold">Net Income</p>
                  <p className={`text-2xl font-bold mt-2 ${
                    netIncome >= 0 ? 'text-primary' : 'text-destructive'
                  }`}>
                    {Money(netIncome, plAllDrill, 'total')}
                  </p>
                  <p className="text-xs text-primary mt-1">
                    Gross Profit − Expenses
                  </p>
                </div>
                <div className={`bg-gradient-to-br ${
                  netMargin >= 0 ? 'from-accent' : 'from-red-50'
                } to-card border-2 ${
                  netMargin >= 0 ? 'border-primary/30' : 'border-destructive/30'
                } rounded-lg p-5 shadow-sm`}>
                  <p className={`text-xs uppercase tracking-wide font-semibold ${
                    netMargin >= 0 ? 'text-primary' : 'text-destructive'
                  }`}>Net Profit Margin</p>
                  <p className={`text-2xl font-bold mt-2 ${
                    netMargin >= 0 ? 'text-primary' : 'text-destructive'
                  }`}>
                    {netMargin.toFixed(1)}%
                  </p>
                  <p className={`text-xs mt-1 ${netMargin >= 0 ? 'text-primary' : 'text-destructive'}`}>
                    Net Income ÷ Income
                  </p>
                </div>
              </div>

              {/* Profit & Loss Breakdown (waterfall) */}
              <div className="bg-white border-2 border-border rounded-lg shadow-sm overflow-hidden">
                <div className="border-b border-border bg-muted/40 px-5 py-3">
                  <p className="text-sm font-semibold text-foreground">Profit &amp; Loss Breakdown</p>
                  <p className="text-xs text-muted-foreground mt-0.5">How net income is derived for this period</p>
                </div>
                <div className="divide-y divide-border/70">
                  <div className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm text-foreground/85">Income</span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {Money(incomeTotal, plIncomeDrill, 'total')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm text-foreground/85">Less: Cost of Goods Sold</span>
                    <span className="text-sm font-semibold tabular-nums text-warning-foreground">
                      ({Money(cogsTotal, plCogsDrill, 'total')})
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-5 py-3 bg-green-50/60">
                    <span className="text-sm font-semibold text-success">= Gross Profit</span>
                    <span className="text-sm font-bold tabular-nums text-success">
                      {Money(grossProfit, accountsTotalRow([...incomeAccounts, ...cogsAccounts], 'Gross profit'), 'total')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm text-foreground/85">Less: Operating Expenses</span>
                    <span className="text-sm font-semibold tabular-nums text-foreground/85">
                      ({Money(expenseTotal, plExpenseDrill, 'total')})
                    </span>
                  </div>
                  <div className={`flex items-center justify-between px-5 py-3 ${
                    netIncome >= 0 ? 'bg-blue-50/70' : 'bg-destructive/5/70'
                  }`}>
                    <span className={`text-sm font-bold ${netIncome >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      = Net Income
                    </span>
                    <span className={`text-base font-bold tabular-nums ${
                      netIncome >= 0 ? 'text-primary' : 'text-destructive'
                    }`}>
                      {Money(netIncome, plAllDrill, "total")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {Number(data.net_income ?? 0) < 0 && (
          <p className="text-sm text-muted-foreground max-w-3xl">
            Negative net usually means period COGS (fuel 5100, shrinkage 5200, shop 5120) or operating expenses
            exceed income for the selected dates. Widen the range, or run{' '}
            <code className="text-xs bg-muted px-1 rounded">python manage.py seed_master_full_demo --reset-demo-gl</code>{' '}
            on the server for Master Filling Station to reload large demo profit journals.
          </p>
        )}
      </div>
    )
  }

  // Liabilities (GL detail)
  if (reportType === 'liabilities-detail' && data) {
    const accounts: any[] = data.accounts || []
    const period = data?.period || {}
    return (
      <div className="space-y-6">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Liability balances are as of the report end date (same basis as the balance sheet liabilities section).'
          )}
        {data.accounting_note && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">{data.accounting_note}</p>
        )}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Account</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground w-24">
                  Ledger
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No liability accounts with a non-zero balance for this scope.
                  </td>
                </tr>
              ) : (
                accounts.map((acc: any, idx: number) => (
                  <tr key={`${acc.account_id}-${idx}`} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-foreground">{acc.account_code}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{acc.account_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">{acc.account_type}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {Money(acc.balance, acc, 'balance')}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <GlLedgerIconLink accountId={acc.account_id} label={acc.account_name || acc.account_code} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {accounts.length > 0 && (
              <tfoot className="bg-muted/40">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                    Total liabilities
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-foreground">
                    {Money(data.total_liabilities ?? 0, accountsTotalRow(accounts, 'Total liabilities'), 'total')}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )
  }

  // Loan receivable (GL)
  if (reportType === 'loan-receivable-gl' && data) {
    const accounts: any[] = data.accounts || []
    const period = data?.period || {}
    return (
      <div className="space-y-6">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Balances are as of the report end date for chart lines classified as loans receivable (principal).'
          )}
        {data.accounting_note && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">{data.accounting_note}</p>
        )}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Account</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Sub-type</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground w-24">
                  Ledger
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No loans-receivable GL accounts with a balance. Create a lent loan or chart lines with type loan (not
                    loan payable).
                  </td>
                </tr>
              ) : (
                accounts.map((acc: any, idx: number) => (
                  <tr key={`${acc.account_id}-${idx}`} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-foreground">{acc.account_code}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{acc.account_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">{acc.account_sub_type || '—'}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {Money(acc.balance, acc, 'balance')}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <GlLedgerIconLink accountId={acc.account_id} label={acc.account_name || acc.account_code} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {accounts.length > 0 && (
              <tfoot className="bg-muted/40">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                    Total loan receivable (GL)
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-foreground">
                    {Money(data.total_loan_receivable_gl ?? 0, accountsTotalRow(accounts, 'Loan receivable GL'), 'total')}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )
  }

  // Loan payable (GL)
  if (reportType === 'loan-payable-gl' && data) {
    const accounts: any[] = data.accounts || []
    const period = data?.period || {}
    return (
      <div className="space-y-6">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Balances are as of the report end date for chart lines classified as loans payable (principal).'
          )}
        {data.accounting_note && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">{data.accounting_note}</p>
        )}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Account</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Sub-type</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground w-24">
                  Ledger
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No loans-payable GL accounts with a balance. Create a borrowed loan or chart lines with type loan and
                    sub-type loan payable.
                  </td>
                </tr>
              ) : (
                accounts.map((acc: any, idx: number) => (
                  <tr key={`${acc.account_id}-${idx}`} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-foreground">{acc.account_code}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{acc.account_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">{acc.account_sub_type || '—'}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {Money(acc.balance, acc, 'balance')}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <GlLedgerIconLink accountId={acc.account_id} label={acc.account_name || acc.account_code} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {accounts.length > 0 && (
              <tfoot className="bg-muted/40">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                    Total loan payable (GL)
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-foreground">
                    {Money(data.total_loan_payable_gl ?? 0, accountsTotalRow(accounts, 'Loan payable GL'), 'total')}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )
  }

  // Loans — borrowed & lent
  if (reportType === 'loans-borrow-and-lent' && data) {
    const borrowed: any[] = data.borrowed || []
    const lent: any[] = data.lent || []
    const period = data?.period || {}
    const sm = data.summary || {}
    const borrowedDrill = loansTotalRow(borrowed, 'Borrowed facilities', [
      'outstanding_principal',
      'period_disbursements',
      'period_repayments',
    ])
    const lentDrill = loansTotalRow(lent, 'Lent facilities', [
      'outstanding_principal',
      'period_disbursements',
      'period_repayments',
    ])
    const allLoansDrill = loansTotalRow([...borrowed, ...lent], 'All loan facilities', [
      'outstanding_principal',
      'period_disbursements',
      'period_repayments',
    ])

    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Outstanding principal is current facility balance; disbursement and repayment columns are dated within the selected range.'
          )}
        {data.accounting_note && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">{data.accounting_note}</p>
        )}
        {data.filter_station_id != null && data.filter_station_id > 0 && scopeLabels?.onLoansStrictSiteChange && (
          <label className="flex items-center gap-2 text-sm text-foreground/85">
            <input
              type="checkbox"
              checked={Boolean(data.filter_strict_site)}
              onChange={(e) => scopeLabels.onLoansStrictSiteChange?.(e.target.checked)}
            />
            This site only (exclude company-wide loans)
          </label>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-rose-100 bg-rose-50/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">Outstanding borrowed</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-rose-950">
              {Money(sm.outstanding_borrowed_principal ?? 0, { ...sm, ...borrowedDrill }, 'outstanding_principal')}
            </p>
            <p className="mt-1 text-xs text-rose-800/80">{sm.borrowed_count ?? 0} facilities</p>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Outstanding lent</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-950">
              {Money(sm.outstanding_lent_principal ?? 0, { ...sm, ...lentDrill }, 'outstanding_principal')}
            </p>
            <p className="mt-1 text-xs text-emerald-800/80">{sm.lent_count ?? 0} facilities</p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Period disbursements</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-blue-950">
              {Money(sm.period_disbursements_total ?? 0, { ...sm, ...allLoansDrill }, 'period_disbursements')}
            </p>
          </div>
          <div className="rounded-lg border border-primary/15 bg-accent/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Period repayments</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
              {Money(sm.period_repayments_total ?? 0, { ...sm, ...allLoansDrill }, 'period_repayments')}
            </p>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-lg font-semibold text-foreground">Borrowed (you owe principal)</h3>
          <LoanFacilitiesTable rows={borrowed} tone="borrowed" drillScope={reportDrillScope()} />
        </div>
        <div>
          <h3 className="mb-3 text-lg font-semibold text-foreground">Lent (principal receivable)</h3>
          <LoanFacilitiesTable rows={lent} tone="lent" drillScope={reportDrillScope()} />
        </div>
      </div>
    )
  }

  // Fuel Sales
  if (reportType === 'fuel-sales' && data) {
    return (
      <div className="space-y-6">
        {/* Period Info - Editable inline date inputs */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          "Fuel sales data is filtered by this date range."
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Sales', value: data.total_sales ?? 0, format: 'number', icon: BarChart3, color: 'blue' },
            { label: 'Total Liters', value: Number(data.total_quantity_liters ?? 0), format: 'liters', icon: Droplet, color: 'green' },
            { label: 'Total Amount', value: Number(data.total_amount ?? 0), format: 'currency', icon: DollarSign, color: 'purple' },
            { label: 'Average Sale', value: Number(data.average_sale_amount ?? 0), format: 'currency', icon: TrendingUp, color: 'indigo' },
          ].map((item) => {
            const colorMap: Record<string, string> = {
              blue: 'from-accent to-blue-100 border-primary/25 text-primary bg-blue-200',
              green: 'from-green-50 to-green-100 border-success/25 text-success bg-green-200',
              purple: 'from-purple-50 to-purple-100 border-purple-200 text-purple-600 bg-purple-200',
              indigo: 'from-accent to-accent border-primary/25 text-primary bg-accent'
            }
            const colors = colorMap[item.color] || colorMap.blue
            const [gradient, border, text, bg] = colors.split(' ')
            const Icon = item.icon
            
            return (
              <div key={item.label} className={`bg-gradient-to-br ${gradient} ${border} border rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className={`text-xs uppercase tracking-wide font-medium ${text}`}>{item.label}</p>
                    <p className={`text-2xl font-bold mt-2 ${text.replace('600', '900')}`}>
                      {item.format === 'currency' ? Money(item.value, data, item.label === 'Total Amount' ? 'total_amount' : 'average_sale_amount') :
                 item.format === 'liters' ? `${formatNumber(item.value)} L` :
                       formatNumber(item.value, 0)}
              </p>
            </div>
                  <div className={`${bg} rounded-full p-2 ml-2`}>
                    <Icon className={`h-5 w-5 ${text}`} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        
        {data.total_sales === 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <p className="text-yellow-800 font-medium">No sales found for the selected date range</p>
            <p className="text-yellow-600 text-sm mt-1">Try adjusting the date range to see sales data</p>
          </div>
        )}
      </div>
    )
  }

  // Tank Inventory
  if (reportType === 'tank-inventory' && data) {
    const inventory = Array.isArray(data.inventory) ? data.inventory : (Array.isArray(data) ? data : [])
    const period = data?.period || {}
    const invSummary = data.summary || {}
    const totCap = inventory.reduce((s: number, t: any) => s + Number(t.capacity ?? 0), 0)
    const totStock = inventory.reduce((s: number, t: any) => s + Number(t.current_stock ?? 0), 0)

    return (
      <div className="space-y-6">
        {/* Report Period - Date Range */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          "Tank inventory shows current stock levels as of the end date."
        )}

        {(invSummary.total_capacity_liters != null || invSummary.tank_count != null) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tanks</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{invSummary.tank_count ?? inventory.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total capacity (L)</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{Number(invSummary.total_capacity_liters ?? totCap).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-lg border border-border bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total stock (L)</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{Number(invSummary.total_current_stock_liters ?? totStock).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Tank</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Station</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Product</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Capacity</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Current Stock</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Fill %</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Needs Refill</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border">
              {inventory.length > 0 ? (
                inventory.map((tank: any, idx: number) => (
                  <tr key={idx}>
                    <td className="px-4 py-3 text-sm text-foreground">{tank.tank_name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{tank.station_name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{tank.product_name}</td>
                    <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                      {Number(tank.capacity ?? 0).toLocaleString()} L
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                      {Number(tank.current_stock ?? 0).toLocaleString()} L
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-foreground">
                      {formatNumber(Number(tank.fill_percentage ?? 0))}%
                    </td>
                        <td className="px-4 py-3 text-sm text-right">
                      {tank.needs_refill ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success">
                          No
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <Package className="h-12 w-12 text-muted-foreground/40 mb-3" />
                      <p className="text-muted-foreground font-medium">No tank inventory found</p>
                      <p className="text-muted-foreground/70 text-sm mt-1">Set up tanks in your stations to track inventory</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {inventory.length > 0 && (
              <tfoot className="bg-muted/40">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                    {totCap.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                    {totStock.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td colSpan={2} className="px-4 py-3 text-sm text-muted-foreground" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )
  }

  // Inventory: valuation & velocity (SKU)
  if (reportType === 'inventory-sku-valuation' && data) {
    const period = data?.period || {}
    const filters = data?.filters || {}
    const rows: any[] = Array.isArray(data.rows) ? data.rows : []
    const s = data.summary || {}
    const selectedIds: number[] = (filters?.item_ids as number[] | undefined) || []
    const filterText = (filters?.category as string)
      ? `category = ${String(filters.category)}`
      : 'any category'
    const itemPart =
      selectedIds.length > 0
        ? `${selectedIds.length} selected product(s): #${selectedIds.join(', #')}`
        : 'all products in scope'
    const invTotalsRow = itemsTotalRow(rows, 'Inventory totals', [
      'extended_cost_value',
      'extended_list_value',
      'period_revenue',
      'total_cost_value',
      'total_list_value',
      'total_period_revenue',
    ])
    const statusLabel: Record<string, string> = {
      no_period_sales: 'No period sales',
      sold_out: 'Sold out (period)',
      static_stock: 'No movement',
      under_7d_cover: 'Under 7d cover',
      over_60d_cover: 'Over 60d cover',
      healthy: 'Balanced',
    }
    return (
      <div className="space-y-6">
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          'Period sales and velocity use invoice lines in this date range. On-hand values are current (as of now).',
        )}

        {renderItemScopeFilterPanel(reportType, itemScope, {
          panelTitle: 'Filters: category and item',
          applyHint: 'Optional — narrow SKUs before applying. Date range is set above.',
        })}

        {itemScope ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Active view:</span> {filterText}; {itemPart}.
          </p>
        ) : null}

        <div className="rounded-xl border border-border bg-gradient-to-br from-muted/40 to-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground">What this report shows</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-4xl leading-relaxed">
            Per-SKU view of <strong>stock on hand</strong> with <strong>cost basis</strong> and <strong>retail (list) extension</strong>,
            plus <strong>invoiced quantity and revenue</strong> in the period. <strong>Velocity</strong> is average units per day;
            <strong> days of cover</strong> estimates how long current stock lasts at that pace (where period sales exist).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'SKUs in scope', v: s.line_count ?? 0, fmt: 'n' as const },
            { label: 'Total on-hand (units)', v: s.total_qty_on_hand ?? 0, fmt: 'n' as const },
            { label: 'Total cost value', v: s.total_cost_value ?? 0, fmt: 'c' as const },
            { label: 'Total list value', v: s.total_list_value ?? 0, fmt: 'c' as const },
            { label: 'Period units sold', v: s.total_period_quantity_sold ?? 0, fmt: 'n' as const },
            { label: 'Period revenue', v: s.total_period_revenue ?? 0, fmt: 'c' as const },
            { label: 'List − cost (on hand)', v: s.implied_list_minus_cost ?? 0, fmt: 'c' as const },
            { label: 'Period days', v: s.period_days ?? 0, fmt: 'n' as const },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-lg border border-border bg-white px-4 py-3 shadow-sm"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {k.fmt === 'c'
                  ? Money(
                      Number(k.v) || 0,
                      { ...s, ...invTotalsRow },
                      k.label.includes('cost') && !k.label.includes('−')
                        ? 'total_cost_value'
                        : k.label.includes('list') && k.label.includes('−')
                          ? 'implied_list_minus_cost'
                          : k.label.includes('list')
                            ? 'total_list_value'
                            : k.label.includes('revenue')
                              ? 'total_period_revenue'
                              : 'total',
                    )
                  : formatNumber(Number(k.v) || 0, 2)}
              </p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">SKU</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Item</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">On hand</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Unit cost</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Cost value</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">List value</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Period qty</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Period revenue</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Units / day</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Days cover</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-muted-foreground">
                    No tracked inventory items found. Add products (inventory type) or record sales in the period.
                  </td>
                </tr>
              ) : (
                rows.map((r: any, idx: number) => (
                  <tr key={idx} className="hover:bg-muted/50">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">{r.sku || '—'}</td>
                    <td className="max-w-[200px] px-3 py-2 text-foreground">
                      <span className="line-clamp-2" title={r.name}>
                        {r.name}
                      </span>
                      {r.unit ? <span className="ml-1 text-xs text-muted-foreground">({r.unit})</span> : null}
                    </td>
                    <td className="px-3 py-2 text-foreground/85 max-w-[140px]">
                      <span className="line-clamp-2" title={r.reporting_category || '—'}>
                        {r.reporting_category || '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                      {formatNumber(r.quantity_on_hand, 2)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground/85">
                      {Money(r.unit_cost, r, "unit_cost")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-foreground">
                      {Money(r.extended_cost_value, r, "extended_cost_value")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                      {Money(r.extended_list_value, r, "extended_list_value")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                      {formatNumber(r.period_quantity_sold, 2)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                      {Money(r.period_revenue, r, "period_revenue")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground/85">
                      {formatNumber(r.velocity_per_day, 2)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                      {r.days_of_cover == null ? '—' : `${r.days_of_cover} d`}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {statusLabel[r.stock_status] || r.stock_status}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-muted">
                <tr>
                  <td colSpan={3} className="px-3 py-2.5 text-right text-xs font-bold uppercase text-foreground/85">
                    Totals
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                    {formatNumber(Number(s.total_qty_on_hand ?? 0), 2)}
                  </td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right font-semibold text-foreground">
                    {Money(Number(s.total_cost_value ?? 0), { ...s, ...invTotalsRow }, 'total_cost_value')}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-foreground">
                    {Money(Number(s.total_list_value ?? 0), { ...s, ...invTotalsRow }, 'total_list_value')}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                    {formatNumber(Number(s.total_period_quantity_sold ?? 0), 2)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-foreground">
                    {Money(Number(s.total_period_revenue ?? 0), { ...s, ...invTotalsRow }, 'total_period_revenue')}
                  </td>
                  <td colSpan={3} className="px-3 py-2.5" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {data.accounting_note ? (
          <p className="text-xs text-muted-foreground max-w-4xl leading-relaxed border-t border-border/70 pt-3">
            {data.accounting_note}
          </p>
        ) : null}
      </div>
    )
  }

  // Item catalog (snapshot) by reporting category
  if (reportType === 'item-master-by-category' && data) {
    const period = data?.period || {}
    const byCat: any[] = Array.isArray(data.by_category) ? data.by_category : []
    const rows: any[] = Array.isArray(data.rows) ? data.rows : []
    const ms = data.summary || {}
    const catTotals = byCat.reduce(
      (acc, c) => ({
        items: acc.items + Number(c.item_count ?? 0),
        active: acc.active + Number(c.active_count ?? 0),
        qoh: acc.qoh + Number(c.quantity_on_hand ?? 0),
        cost: acc.cost + Number(c.extended_cost_value ?? 0),
        list: acc.list + Number(c.extended_list_value ?? 0),
      }),
      { items: 0, active: 0, qoh: 0, cost: 0, list: 0 }
    )
    const detailTotals = rows.reduce(
      (acc, r) => ({
        qoh: acc.qoh + Number(r.quantity_on_hand ?? 0),
        cost: acc.cost + Number(r.extended_cost_value ?? 0),
        list: acc.list + Number(r.extended_list_value ?? 0),
      }),
      { qoh: 0, cost: 0, list: 0 }
    )
    return (
      <div className="space-y-6">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Catalog is a live snapshot; dates label the printout only.',
          )}
        {period?.note ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10/80 px-4 py-3 text-sm text-warning-foreground">
            {String(period.note)} Dates below label the printout; stock is current.
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
          <h3 className="bg-muted px-3 py-2 text-sm font-semibold text-foreground">Summary by category</h3>
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Items</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Active</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">On hand (units)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Cost value</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">List value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70 bg-white">
              {byCat.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No items in the catalog.
                  </td>
                </tr>
              ) : (
                byCat.map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-muted/50">
                    <td className="px-3 py-2 font-medium text-foreground">{c.reporting_category}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.item_count ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.active_count ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.quantity_on_hand, 2)}</td>
                    <td className="px-3 py-2 text-right">{Money(c.extended_cost_value, c, "extended_cost_value")}</td>
                    <td className="px-3 py-2 text-right">{Money(c.extended_list_value, c, "extended_list_value")}</td>
                  </tr>
                ))
              )}
            </tbody>
            {byCat.length > 0 && (
              <tfoot className="bg-muted">
                <tr>
                  <td className="px-3 py-2 text-right text-xs font-bold uppercase text-foreground/85">Totals</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                    {ms.total_items != null ? ms.total_items : catTotals.items}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{catTotals.active}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                    {formatNumber(Number(ms.total_quantity_on_hand ?? catTotals.qoh), 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-foreground">
                    {Money(Number(ms.total_extended_cost_value ?? catTotals.cost), itemsTotalRow(rows, 'Catalog cost totals', ['extended_cost_value']), 'extended_cost_value')}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-foreground">
                    {Money(Number(ms.total_extended_list_value ?? catTotals.list), itemsTotalRow(rows, 'Catalog list totals', ['extended_list_value']), 'extended_list_value')}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
          <h3 className="bg-muted px-3 py-2 text-sm font-semibold text-foreground">All items (detail)</h3>
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">SKU</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">Name</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">POS</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">Type</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase text-muted-foreground">Active</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">On hand</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Cost value</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">List value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    No rows.
                  </td>
                </tr>
              ) : (
                rows.map((r: any, idx: number) => (
                  <tr key={idx} className="hover:bg-muted/50">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">{r.sku}</td>
                    <td className="max-w-[180px] px-3 py-2 text-foreground">
                      <span className="line-clamp-2" title={r.name}>
                        {r.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-warning-foreground/90 max-w-[120px]">
                      <span className="line-clamp-2" title={r.reporting_category}>
                        {r.reporting_category}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{r.pos_category}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{r.item_type}</td>
                    <td className="px-3 py-2 text-center">
                      {r.is_active ? (
                        <span className="text-xs text-success">Yes</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/70">No</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.quantity_on_hand, 2)}</td>
                    <td className="px-3 py-2 text-right">{Money(r.extended_cost_value, r, "extended_cost_value")}</td>
                    <td className="px-3 py-2 text-right">{Money(r.extended_list_value, r, "extended_list_value")}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-muted">
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-right text-xs font-bold uppercase text-foreground/85">
                    Totals
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                    {formatNumber(detailTotals.qoh, 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-foreground">{Money(detailTotals.cost, itemsTotalRow(rows, 'Item detail cost', ['extended_cost_value']), 'extended_cost_value')}</td>
                  <td className="px-3 py-2 text-right font-semibold text-foreground">{Money(detailTotals.list, itemsTotalRow(rows, 'Item detail list', ['extended_list_value']), 'extended_list_value')}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {data.accounting_note ? (
          <p className="text-xs text-muted-foreground max-w-4xl leading-relaxed border-t border-border/70 pt-3">
            {data.accounting_note}
          </p>
        ) : null}
      </div>
    )
  }

  if (reportType === 'item-sales-by-category' && data) {
    const period = data?.period || {}
    const catRows: any[] = Array.isArray(data.rows) ? data.rows : []
    const sm = data.summary || {}
    const subLines = catRows.reduce((s, c) => s + Number(c.line_count ?? 0), 0)
    const subDist = catRows.reduce((s, c) => s + Number(c.distinct_items ?? 0), 0)
    const subQty = catRows.reduce((s, c) => s + Number(c.total_quantity ?? 0), 0)
    const subRev = catRows.reduce((s, c) => s + Number(c.total_revenue ?? 0), 0)
    return (
      <div className="space-y-6">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Invoice lines in this date range; grouped by each product reporting category.',
          )}

        <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Inv. lines</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Products</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Quantity</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70 bg-white">
              {catRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No invoice lines with linked items in this period.
                  </td>
                </tr>
              ) : (
                catRows.map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-muted/50">
                    <td className="px-3 py-2 font-medium text-warning-foreground">{c.reporting_category}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{c.line_count ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{c.distinct_items ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.total_quantity, 2)}</td>
                    <td className="px-3 py-2 text-right font-medium">{Money(c.total_revenue, c, "total_revenue")}</td>
                  </tr>
                ))
              )}
            </tbody>
            {catRows.length > 0 && (
              <tfoot className="bg-muted">
                <tr>
                  <td className="px-3 py-2 text-right text-xs font-bold uppercase text-foreground/85">Totals</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{subLines}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{subDist}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                    {formatNumber(Number(sm.total_quantity ?? subQty), 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-foreground">
                    {Money(Number(sm.total_revenue ?? subRev), documentsTotalRow(catRows, { title: 'Sales by category', entityType: 'customers' }), 'total_revenue')}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {data.accounting_note ? (
          <p className="text-xs text-muted-foreground max-w-4xl leading-relaxed border-t border-border/70 pt-3">
            {data.accounting_note}
          </p>
        ) : null}
      </div>
    )
  }

  if (reportType === 'item-purchases-by-category' && data) {
    const period = data?.period || {}
    const catRows: any[] = Array.isArray(data.rows) ? data.rows : []
    const sm = data.summary || {}
    const subLines = catRows.reduce((s, c) => s + Number(c.line_count ?? 0), 0)
    const subDist = catRows.reduce((s, c) => s + Number(c.distinct_items ?? 0), 0)
    const subQty = catRows.reduce((s, c) => s + Number(c.total_quantity ?? 0), 0)
    const subAmt = catRows.reduce((s, c) => s + Number(c.total_purchase_amount ?? 0), 0)
    return (
      <div className="space-y-6">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Vendor bill lines in this date range; grouped by each product reporting category.',
          )}

        <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Bill lines</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Products</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Quantity</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Purchase amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70 bg-white">
              {catRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No bill lines with linked items in this period.
                  </td>
                </tr>
              ) : (
                catRows.map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-muted/50">
                    <td className="px-3 py-2 font-medium text-warning-foreground">{c.reporting_category}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{c.line_count ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{c.distinct_items ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.total_quantity, 2)}</td>
                    <td className="px-3 py-2 text-right font-medium">{Money(c.total_purchase_amount, c, "total_purchase_amount")}</td>
                  </tr>
                ))
              )}
            </tbody>
            {catRows.length > 0 && (
              <tfoot className="bg-muted">
                <tr>
                  <td className="px-3 py-2 text-right text-xs font-bold uppercase text-foreground/85">Totals</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{subLines}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{subDist}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                    {formatNumber(Number(sm.total_quantity ?? subQty), 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-foreground">
                    {Money(Number(sm.total_purchase_amount ?? subAmt), documentsTotalRow(catRows, { title: 'Purchases by category', entityType: 'vendors' }), 'total_purchase_amount')}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {data.accounting_note ? (
          <p className="text-xs text-muted-foreground max-w-4xl leading-relaxed border-t border-border/70 pt-3">
            {data.accounting_note}
          </p>
        ) : null}
      </div>
    )
  }

  if (
    (reportType === 'item-sales-custom' ||
      reportType === 'item-purchases-custom' ||
      reportType === 'item-stock-movement' ||
      reportType === 'item-velocity-analysis' ||
      reportType === 'item-purchase-velocity-analysis') &&
    data
  ) {
    const period = data?.period || {}
    const filters = data?.filters || {}
    const ic = itemScope

    const selectedIds: number[] = (filters?.item_ids as number[] | undefined) || []
    const filterText =
      (filters?.category as string) ? `category = ${String(filters.category)}` : 'any category'
    const itemPart =
      selectedIds.length > 0
        ? `${selectedIds.length} selected product(s): #${selectedIds.join(', #')}`
        : 'all products in scope (by category, or with activity)'

    return (
      <div className="space-y-6">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Choose a date range, set filters, then apply. Multi-select: pick products for custom sales, custom purchases, stock movement, sales velocity, and purchase velocity.',
          )}

        {renderItemScopeFilterPanel(reportType, ic, {
          applyHint: 'Narrow the checklist. Leave empty to see all products (still multi-selectable).',
        })}

        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Active view:</span> {filterText}; {itemPart}.
        </p>

        {reportType === 'item-sales-custom' ? (
          <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
            {(() => {
              const cRows: any[] = Array.isArray(data.rows) ? data.rows : []
              const sum = data.summary || {}
              const tq = Number(sum.total_quantity ?? cRows.reduce((s, r) => s + Number(r.period_quantity_sold ?? 0), 0))
              const tr = Number(sum.total_revenue ?? cRows.reduce((s, r) => s + Number(r.period_revenue ?? 0), 0))
              const tc = cRows.reduce((s, r) => s + Number(r.est_cogs ?? 0), 0)
              return (
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">SKU</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Item</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">POS</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Period qty</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Revenue</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Est. COGS</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70 bg-white">
                {cRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                      No rows for this selection. Try a wider range or different products.
                    </td>
                  </tr>
                ) : (
                  cRows.map((r: any, idx: number) => (
                    <tr key={idx} className="hover:bg-muted/50">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">{r.sku || '—'}</td>
                      <td className="max-w-[200px] px-3 py-2 text-foreground">
                        <span className="line-clamp-2" title={r.name}>
                          {r.name}
                        </span>
                        {r.unit ? <span className="ml-1 text-xs text-muted-foreground">({r.unit})</span> : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-warning-foreground/90 max-w-[120px] line-clamp-2">{r.reporting_category}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{r.pos_category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.period_quantity_sold, 2)}</td>
                      <td className="px-3 py-2 text-right font-medium">{Money(r.period_revenue, r, "period_revenue")}</td>
                      <td className="px-3 py-2 text-right text-foreground/85">{Money(r.est_cogs, r, 'est_cogs')}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {r.gross_margin_pct == null ? '—' : `${formatNumber(r.gross_margin_pct, 2)}%`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {cRows.length > 0 && (
                <tfoot className="bg-muted">
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold uppercase text-foreground/85">
                      Totals
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{formatNumber(tq, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-foreground">{Money(tr, itemsTotalRow(cRows, 'Item sales revenue', ['period_revenue']), 'period_revenue')}</td>
                    <td className="px-3 py-2 text-right font-semibold text-foreground">{Money(tc, itemsTotalRow(cRows, 'Item sales est. COGS', ['est_cogs']), 'est_cogs')}</td>
                    <td className="px-3 py-2" />
                  </tr>
                </tfoot>
              )}
            </table>
              );
            })()}
          </div>
        ) : null}

        {reportType === 'item-purchases-custom' ? (
          <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
            {(() => {
              const cRows: any[] = Array.isArray(data.rows) ? data.rows : []
              const sum = data.summary || {}
              const tq = Number(sum.total_quantity ?? cRows.reduce((s, r) => s + Number(r.period_quantity_purchased ?? 0), 0))
              const ta = Number(sum.total_purchase_amount ?? cRows.reduce((s, r) => s + Number(r.period_purchase_amount ?? 0), 0))
              return (
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">SKU</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Item</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">POS</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Period qty</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Purchase $</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Avg unit $</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70 bg-white">
                    {cRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                          No rows for this selection. Try a wider range or different products.
                        </td>
                      </tr>
                    ) : (
                      cRows.map((r: any, idx: number) => (
                        <tr key={idx} className="hover:bg-muted/50">
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">{r.sku || '—'}</td>
                          <td className="max-w-[200px] px-3 py-2 text-foreground">
                            <span className="line-clamp-2" title={r.name}>
                              {r.name}
                            </span>
                            {r.unit ? <span className="ml-1 text-xs text-muted-foreground">({r.unit})</span> : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-warning-foreground/90 max-w-[120px] line-clamp-2">
                            {r.reporting_category}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-xs">{r.pos_category}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatNumber(r.period_quantity_purchased, 2)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">{Money(r.period_purchase_amount, r, "period_purchase_amount")}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-foreground">
                            {r.avg_purchase_unit_cost == null ? '—' : Money(r.avg_purchase_unit_cost, r, 'avg_purchase_unit_cost')}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {cRows.length > 0 && (
                    <tfoot className="bg-muted">
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold uppercase text-foreground/85">
                          Totals
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{formatNumber(tq, 2)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-foreground">{Money(ta, itemsTotalRow(cRows, "Item purchases", ["period_purchase_amount"]), "period_purchase_amount")}</td>
                        <td className="px-3 py-2 text-sm text-muted-foreground">—</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )
            })()}
          </div>
        ) : null}

        {reportType === 'item-stock-movement' ? (
          <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
            {(() => {
              const cRows: any[] = Array.isArray(data.rows) ? data.rows : []
              const sum = data.summary || {}
              const tp = Number(sum.total_qty_purchased ?? cRows.reduce((s, r) => s + Number(r.quantity_purchased ?? 0), 0))
              const ts = Number(sum.total_qty_sold ?? cRows.reduce((s, r) => s + Number(r.quantity_sold ?? 0), 0))
              const tpa = Number(sum.total_purchase_amount ?? cRows.reduce((s, r) => s + Number(r.purchase_amount ?? 0), 0))
              const tsr = Number(sum.total_sales_revenue ?? cRows.reduce((s, r) => s + Number(r.sales_revenue ?? 0), 0))
              const tn = cRows.reduce((s, r) => s + Number(r.net_quantity_in ?? 0), 0)
              return (
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">SKU</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Item</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Qty in (bills)</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Purchase $</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Qty out (sales)</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Sales $</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Net qty (in−out)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70 bg-white">
                {cRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                      No data. Try a wider range or a category with bill and/or invoice lines.
                    </td>
                  </tr>
                ) : (
                  cRows.map((r: any, idx: number) => (
                    <tr key={idx} className="hover:bg-muted/50">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">{r.sku || '—'}</td>
                      <td className="max-w-[200px] px-3 py-2 text-foreground">
                        <span className="line-clamp-2" title={r.name}>
                          {r.name}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-warning-foreground/90 max-w-[120px] line-clamp-2">{r.reporting_category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.quantity_purchased, 2)}</td>
                      <td className="px-3 py-2 text-right text-foreground">{Money(r.purchase_amount, r, "purchase_amount")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.quantity_sold, 2)}</td>
                      <td className="px-3 py-2 text-right text-foreground">{Money(r.sales_revenue, r, "sales_revenue")}</td>
                      <td
                        className={`px-3 py-2 text-right font-medium tabular-nums ${
                          (r.net_quantity_in ?? 0) > 0
                            ? 'text-success'
                            : (r.net_quantity_in ?? 0) < 0
                              ? 'text-warning-foreground'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {formatNumber(r.net_quantity_in, 2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {cRows.length > 0 && (
                <tfoot className="bg-muted">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-xs font-bold uppercase text-foreground/85">
                      Totals
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{formatNumber(tp, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-foreground">{Money(tpa, itemsTotalRow(cRows, "Stock movement purchases", ["purchase_amount"]), "purchase_amount")}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{formatNumber(ts, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-foreground">{Money(tsr, itemsTotalRow(cRows, "Stock movement sales", ["sales_revenue"]), "sales_revenue")}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{formatNumber(tn, 2)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
              );
            })()}
          </div>
        ) : null}

        {reportType === 'item-velocity-analysis' ? (
          <div className="space-y-3">
            {data.summary && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                {[
                  { k: 'fast', label: 'Fast' },
                  { k: 'medium', label: 'Medium' },
                  { k: 'slow', label: 'Slow' },
                  { k: 'no_period_sales', label: 'No period sales' },
                ].map(({ k, label }) => (
                  <div
                    key={k}
                    className="rounded-lg border border-border bg-white px-3 py-2 text-center text-sm shadow-sm"
                  >
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-lg font-semibold text-foreground">{(data.summary as any)[k] ?? 0}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
              {(() => {
                const cRows: any[] = Array.isArray(data.rows) ? data.rows : []
                const tierOrder = ['fast', 'medium', 'slow', 'no_period_sales'] as const
                const tierClass = (t: string) => {
                  if (t === 'fast') return 'bg-emerald-100 text-emerald-900'
                  if (t === 'medium') return 'bg-amber-100 text-warning-foreground'
                  if (t === 'slow') return 'bg-orange-100 text-orange-950'
                  return 'bg-muted text-foreground/85'
                }
                const gt = cRows.reduce(
                  (a, r) => ({
                    ooh: a.ooh + Number(r.quantity_on_hand ?? 0),
                    pq: a.pq + Number(r.period_quantity_sold ?? 0),
                    rev: a.rev + Number(r.period_revenue ?? 0),
                  }),
                  { ooh: 0, pq: 0, rev: 0 }
                )
                return (
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Tier</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">SKU</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Item</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">On hand</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Sold qty</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Sales $</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Velocity / day</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Rank</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {cRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                        No products in scope. Adjust category or add items.
                      </td>
                    </tr>
                  ) : (
                    tierOrder.map((tier) => {
                      const tierRows = cRows.filter((r) => String(r.movement_tier || '') === tier)
                      if (tierRows.length === 0) return null
                      const st = tierRows.reduce(
                        (a, r) => ({
                          ooh: a.ooh + Number(r.quantity_on_hand ?? 0),
                          pq: a.pq + Number(r.period_quantity_sold ?? 0),
                          rev: a.rev + Number(r.period_revenue ?? 0),
                        }),
                        { ooh: 0, pq: 0, rev: 0 }
                      )
                      const label = String(tier).replace(/_/g, ' ')
                      return (
                        <Fragment key={tier}>
                          {tierRows.map((r: any, idx: number) => (
                            <tr key={`${tier}-${idx}`} className="hover:bg-muted/50">
                              <td className="whitespace-nowrap px-3 py-2">
                                <span
                                  className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tierClass(r.movement_tier || '')}`}
                                >
                                  {String(r.movement_tier || '').replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">{r.sku || '—'}</td>
                              <td className="max-w-[200px] px-3 py-2 text-foreground">
                                <span className="line-clamp-2" title={r.name}>
                                  {r.name}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs text-warning-foreground/90 max-w-[120px] line-clamp-2">{r.reporting_category}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.quantity_on_hand, 2)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.period_quantity_sold, 2)}</td>
                              <td className="px-3 py-2 text-right text-foreground">{Money(r.period_revenue, r, "period_revenue")}</td>
                              <td className="px-3 py-2 text-right text-foreground">{formatNumber(r.velocity_per_day, 2)}</td>
                              <td className="px-3 py-2 text-right text-muted-foreground">{r.velocity_rank || '—'}</td>
                            </tr>
                          ))}
                          <tr className="bg-muted/90">
                            <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">
                              Sub-total — {label}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">
                              {formatNumber(st.ooh, 2)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">
                              {formatNumber(st.pq, 2)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-semibold text-foreground">{Money(st.rev, itemsTotalRow(cRows, "Category revenue", ["period_revenue"]), "period_revenue")}</td>
                            <td colSpan={2} className="px-3 py-2 text-xs text-muted-foreground">
                              {tierRows.length} SKU{tierRows.length === 1 ? '' : 's'}
                            </td>
                          </tr>
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
                {cRows.length > 0 && (
                  <tfoot className="bg-muted/80">
                    <tr>
                      <td colSpan={4} className="px-3 py-2.5 text-right text-xs font-bold uppercase text-foreground">
                        Total — all tiers
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{formatNumber(gt.ooh, 2)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{formatNumber(gt.pq, 2)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-foreground">{Money(gt.rev, itemsTotalRow(cRows, "Grand revenue", ["period_revenue"]), "period_revenue")}</td>
                      <td colSpan={2} className="px-3 py-2.5" />
                    </tr>
                  </tfoot>
                )}
              </table>
                );
              })()}
            </div>
          </div>
        ) : null}

        {reportType === 'item-purchase-velocity-analysis' ? (
          <div className="space-y-3">
            {data.summary && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                {[
                  { k: 'fast', label: 'Fast' },
                  { k: 'medium', label: 'Medium' },
                  { k: 'slow', label: 'Slow' },
                  { k: 'no_period_purchases', label: 'No period purchases' },
                ].map(({ k, label }) => (
                  <div
                    key={k}
                    className="rounded-lg border border-border bg-white px-3 py-2 text-center text-sm shadow-sm"
                  >
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-lg font-semibold text-foreground">{(data.summary as any)[k] ?? 0}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
              {(() => {
                const cRows: any[] = Array.isArray(data.rows) ? data.rows : []
                const tierOrder = ['fast', 'medium', 'slow', 'no_period_purchases'] as const
                const tierClass = (t: string) => {
                  if (t === 'fast') return 'bg-emerald-100 text-emerald-900'
                  if (t === 'medium') return 'bg-amber-100 text-warning-foreground'
                  if (t === 'slow') return 'bg-orange-100 text-orange-950'
                  return 'bg-muted text-foreground/85'
                }
                const gt = cRows.reduce(
                  (a, r) => ({
                    ooh: a.ooh + Number(r.quantity_on_hand ?? 0),
                    pq: a.pq + Number(r.period_quantity_purchased ?? 0),
                    pam: a.pam + Number(r.period_purchase_amount ?? 0),
                  }),
                  { ooh: 0, pq: 0, pam: 0 }
                )
                return (
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Tier</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">SKU</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Item</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">On hand</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Purch. qty</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Purch. $</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Purch. / day</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Rank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70 bg-white">
                      {cRows.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                            No products in scope. Adjust category or add items.
                          </td>
                        </tr>
                      ) : (
                        tierOrder.map((tier) => {
                          const tierRows = cRows.filter((r) => String(r.movement_tier || '') === tier)
                          if (tierRows.length === 0) return null
                          const st = tierRows.reduce(
                            (a, r) => ({
                              ooh: a.ooh + Number(r.quantity_on_hand ?? 0),
                              pq: a.pq + Number(r.period_quantity_purchased ?? 0),
                              pam: a.pam + Number(r.period_purchase_amount ?? 0),
                            }),
                            { ooh: 0, pq: 0, pam: 0 }
                          )
                          const label = String(tier).replace(/_/g, ' ')
                          return (
                            <Fragment key={tier}>
                              {tierRows.map((r: any, idx: number) => (
                                <tr key={`${tier}-${idx}`} className="hover:bg-muted/50">
                                  <td className="whitespace-nowrap px-3 py-2">
                                    <span
                                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tierClass(r.movement_tier || '')}`}
                                    >
                                      {String(r.movement_tier || '').replace(/_/g, ' ')}
                                    </span>
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">{r.sku || '—'}</td>
                                  <td className="max-w-[200px] px-3 py-2 text-foreground">
                                    <span className="line-clamp-2" title={r.name}>
                                      {r.name}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-warning-foreground/90 max-w-[120px] line-clamp-2">
                                    {r.reporting_category}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.quantity_on_hand, 2)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {formatNumber(r.period_quantity_purchased, 2)}
                                  </td>
                                  <td className="px-3 py-2 text-right text-foreground">
                                    {Money(r.period_purchase_amount, r, "period_purchase_amount")}
                                  </td>
                                  <td className="px-3 py-2 text-right text-foreground">
                                    {formatNumber(r.purchase_velocity_per_day, 2)}
                                  </td>
                                  <td className="px-3 py-2 text-right text-muted-foreground">{r.velocity_rank || '—'}</td>
                                </tr>
                              ))}
                              <tr className="bg-muted/90">
                                <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">
                                  Sub-total — {label}
                                </td>
                                <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">
                                  {formatNumber(st.ooh, 2)}
                                </td>
                                <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">
                                  {formatNumber(st.pq, 2)}
                                </td>
                                <td className="px-3 py-2 text-right text-xs font-semibold text-foreground">{Money(st.pam, itemsTotalRow(cRows, "Category purchases", ["period_purchase_amount"]), "period_purchase_amount")}</td>
                                <td colSpan={2} className="px-3 py-2 text-xs text-muted-foreground">
                                  {tierRows.length} SKU{tierRows.length === 1 ? '' : 's'}
                                </td>
                              </tr>
                            </Fragment>
                          )
                        })
                      )}
                    </tbody>
                    {cRows.length > 0 && (
                      <tfoot className="bg-muted/80">
                        <tr>
                          <td colSpan={4} className="px-3 py-2.5 text-right text-xs font-bold uppercase text-foreground">
                            Total — all tiers
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{formatNumber(gt.ooh, 2)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{formatNumber(gt.pq, 2)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-foreground">{Money(gt.pam, itemsTotalRow(cRows, "Grand purchases", ["period_purchase_amount"]), "period_purchase_amount")}</td>
                          <td colSpan={2} className="px-3 py-2.5" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )
              })()}
            </div>
          </div>
        ) : null}

        {data.accounting_note ? (
          <p className="text-xs text-muted-foreground max-w-4xl leading-relaxed border-t border-border/70 pt-3">
            {data.accounting_note}
          </p>
        ) : null}
      </div>
    )
  }

  // Sales by Nozzle
  if (reportType === 'sales-by-nozzle' && data) {
    const summary = data.summary || {}
    const nozzles = data.nozzles || []

    return (
      <div className="space-y-6">
        {/* Period Info - Editable inline date inputs */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          "Nozzle sales data is filtered by this date range."
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: 'Total Nozzles', value: summary.total_nozzles ?? 0, icon: Package, color: 'blue' },
            { label: 'Total Transactions', value: summary.total_transactions ?? 0, icon: BarChart3, color: 'green' },
            { label: 'Total Liters', value: `${formatNumber(Number(summary.total_liters ?? 0))} L`, icon: Droplet, color: 'purple' },
            { label: 'Total Amount', money: true, amount: summary.total_amount, row: summary, field: 'total_amount', icon: DollarSign, color: 'indigo' },
            { label: 'Average Sale', money: true, amount: summary.average_sale_amount, row: summary, field: 'average_sale_amount', icon: TrendingUp, color: 'pink' },
          ].map((item) => {
            const colorMap: Record<string, string> = {
              blue: 'from-accent to-blue-100 border-primary/25 text-primary bg-blue-200',
              green: 'from-green-50 to-green-100 border-success/25 text-success bg-green-200',
              purple: 'from-purple-50 to-purple-100 border-purple-200 text-purple-600 bg-purple-200',
              indigo: 'from-accent to-accent border-primary/25 text-primary bg-accent',
              pink: 'from-pink-50 to-pink-100 border-pink-200 text-pink-600 bg-pink-200'
            }
            const colors = colorMap[item.color] || colorMap.blue
            const [gradient, border, text, bg] = colors.split(' ')
            const Icon = item.icon
            
            return (
              <div key={item.label} className={`bg-gradient-to-br ${gradient} ${border} border rounded-lg p-4 shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className={`text-xs uppercase tracking-wide font-medium ${text}`}>{item.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${text.replace('600', '900')}`}>{item.money ? Money(item.amount, item.row as Record<string, unknown>, item.field) : item.value}</p>
            </div>
                  <div className={`${bg} rounded-full p-2 ml-2`}>
                    <Icon className={`h-5 w-5 ${text}`} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Nozzle</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Product</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Station</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Transactions</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Liters</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Amount</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Avg Sale</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border">
              {nozzles.length > 0 ? (
                nozzles.map((nozzle: any, idx: number) => (
                  <tr
                    key={nozzle.id != null ? `nozzle-${nozzle.id}` : `nozzle-${idx}-${String(nozzle.nozzle_number ?? '')}`}
                    className="hover:bg-muted/40"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{nozzle.nozzle_name || nozzle.nozzle_number || 'N/A'}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{nozzle.product_name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{nozzle.station_name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-sm text-right text-muted-foreground">{nozzle.total_transactions || 0}</td>
                    <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                      {formatNumber(Number(nozzle.total_liters ?? 0))} L
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                      {Money(nozzle.total_amount, nozzle, "total_amount")}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                      {Money(nozzle.average_sale_amount, nozzle, "average_sale_amount")}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <Package className="h-12 w-12 text-muted-foreground/40 mb-3" />
                      <p className="text-muted-foreground font-medium">No sales data found</p>
                      <p className="text-muted-foreground/70 text-sm mt-1">Try adjusting the date range or check if sales have been recorded</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {nozzles.length > 0 && (
              <tfoot className="bg-muted/40">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                    {summary.total_transactions ?? nozzles.reduce((s: number, n: any) => s + Number(n.total_transactions ?? 0), 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                    {formatNumber(Number(summary.total_liters ?? nozzles.reduce((s: number, n: any) => s + Number(n.total_liters ?? 0), 0)))} L
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                    {Money(Number(summary.total_amount ?? nozzles.reduce((s: number, n: any) => s + Number(n.total_amount ?? 0), 0)), documentsTotalRow(nozzles, { title: 'Nozzle sales', entityType: 'customers' }), 'total_amount')}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )
  }

  // Sales by station (invoice totals by selling station)
  if (reportType === 'sales-by-station' && data) {
    const summary = data.summary || {}
    const rows = Array.isArray(data.rows) ? data.rows : []
    const totalInv = rows.reduce((s: number, r: any) => s + Number(r.invoice_count ?? 0), 0)
    const totalAmt = rows.reduce((s: number, r: any) => s + Number(r.total ?? 0), 0)
    const stationGrandDrill = documentsTotalRow(rows, {
      title: 'Sales by station',
      entityType: 'customers',
      field: 'grand_total',
    })
    const summaryRow = { ...summary, ...stationGrandDrill }

    return (
      <div className="space-y-6">
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          'Invoice totals are included for invoice dates in this range (non-draft).'
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Stations with sales', value: summary.stations_with_sales ?? '—', icon: MapPin, color: 'teal' },
            { label: 'Invoices in period', value: summary.total_invoices ?? totalInv, icon: FileText, color: 'blue' },
            { label: 'Total amount', amount: summary.grand_total ?? totalAmt, field: 'grand_total', icon: DollarSign, color: 'indigo', money: true },
          ].map((item) => {
            const colorMap: Record<string, string> = {
              teal: 'from-teal-50 to-teal-100 border-primary/25 text-primary bg-teal-200',
              blue: 'from-accent to-blue-100 border-primary/25 text-primary bg-blue-200',
              indigo: 'from-accent to-accent border-primary/25 text-primary bg-accent',
            }
            const colors = colorMap[item.color] || colorMap.teal
            const [gradient, border, text, bg] = colors.split(' ')
            const Icon = item.icon
            return (
              <div key={item.label} className={`bg-gradient-to-br ${gradient} ${border} border rounded-lg p-4 shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className={`text-xs uppercase tracking-wide font-medium ${text}`}>{item.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${text.replace('600', '900')}`}>
                      {'money' in item && item.money
                        ? Money(item.amount ?? 0, summaryRow, item.field || 'total')
                        : (item.value ?? item.amount ?? '—')}
                    </p>
                  </div>
                  <div className={`${bg} rounded-full p-2 ml-2`}>
                    <Icon className={`h-5 w-5 ${text}`} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Station</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Invoices</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Total</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border">
              {rows.length > 0 ? (
                rows.map((r: any, idx: number) => (
                  <tr
                    key={r.station_id != null ? `st-${r.station_id}` : `st-row-${idx}-${String(r.station_name ?? '')}`}
                    className="hover:bg-muted/40"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{r.station_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-foreground">{r.invoice_count ?? 0}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                      {Money(r.total ?? 0, r, "total")}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-muted-foreground">
                    No invoices in this range with a station attached.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-muted/40">
                <tr>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">Totals</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                    {totalInv}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                    {Money(totalAmt, summaryRow, 'grand_total')}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )
  }

  // Sales by Products (cash vs credit, cost & profit)
  if (reportType === 'sales-by-products' && data) {
    const summary = data.summary || {}
    const cashRows = Array.isArray(data.cash_products) ? data.cash_products : []
    const creditRows = Array.isArray(data.credit_products) ? data.credit_products : []

    const renderProductTable = (title: string, rows: any[], titleClass: string) => {
      const subLines = rows.reduce((s: number, r: any) => s + Number(r.line_count ?? 0), 0)
      const subQty = rows.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0)
      const subRev = rows.reduce((s: number, r: any) => s + Number(r.revenue ?? 0), 0)
      const subCost = rows.reduce((s: number, r: any) => s + Number(r.total_cost ?? 0), 0)
      const subProfit = rows.reduce((s: number, r: any) => s + Number(r.profit ?? 0), 0)
      return (
        <div className="space-y-3">
          <h3 className={`text-sm font-semibold uppercase tracking-wide ${titleClass}`}>{title}</h3>
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">SKU</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Unit</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Lines</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Unit cost</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Avg price</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Revenue</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Cost</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Profit</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-border">
                {rows.length > 0 ? (
                  rows.map((r: any, idx: number) => (
                    <tr
                      key={r.item_id != null ? `prod-${r.item_id}` : `prod-row-${idx}`}
                      className="hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 text-sm text-muted-foreground">{r.sku || '—'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{r.name || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{r.reporting_category || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{r.unit || '—'}</td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums text-foreground">{r.line_count ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums text-foreground">
                        {formatNumber(Number(r.quantity ?? 0), 2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums text-foreground">
                        {Money(r.unit_cost ?? 0, r, 'unit_cost')}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums text-foreground">
                        {Money(r.avg_unit_price ?? 0, r, 'avg_unit_price')}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                        {Money(r.revenue ?? 0, r, 'revenue')}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums text-foreground">
                        {Money(r.total_cost ?? 0, r, 'total_cost')}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-emerald-800">
                        {Money(r.profit ?? 0, r, 'profit')}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                      No product sales in this section for the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="bg-muted/40">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                      Subtotal
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {subLines}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {formatNumber(subQty, 2)}
                    </td>
                    <td colSpan={2} />
                    <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                      {Money(subRev, documentsTotalRow(rows, { title, entityType: 'customers' }), 'revenue')}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                      {Money(subCost, documentsTotalRow(rows, { title: `${title} cost`, entityType: 'customers' }), 'total_cost')}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-emerald-900">
                      {Money(subProfit, documentsTotalRow(rows, { title: `${title} profit`, entityType: 'customers' }), 'profit')}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-6">
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          'Invoice line totals by product for invoice dates in this range (non-draft).'
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Cash revenue', amount: summary.cash_revenue, sub: `${summary.cash_line_count ?? 0} lines · profit ${formatCurrency(Number(summary.cash_profit ?? 0))}`, icon: Banknote, color: 'green' },
            { label: 'Credit revenue', amount: summary.credit_revenue, sub: `${summary.credit_line_count ?? 0} lines · profit ${formatCurrency(Number(summary.credit_profit ?? 0))}`, icon: CreditCard, color: 'amber' },
            { label: 'Grand revenue', amount: summary.grand_revenue, sub: `${summary.total_line_count ?? 0} lines · qty ${formatNumber(Number(summary.grand_quantity ?? 0), 2)}`, icon: DollarSign, color: 'indigo' },
            { label: 'Grand profit', amount: summary.grand_profit, sub: `cost ${formatCurrency(Number(summary.grand_total_cost ?? 0))}`, icon: TrendingUp, color: 'emerald' },
          ].map((item) => {
            const colorMap: Record<string, string> = {
              green: 'from-green-50 to-green-100 border-success/25 text-success bg-green-200',
              amber: 'from-amber-50 to-amber-100 border-warning/30 text-amber-600 bg-amber-200',
              indigo: 'from-accent to-accent border-primary/25 text-primary bg-accent',
              emerald: 'from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-600 bg-emerald-200',
            }
            const colors = colorMap[item.color] || colorMap.indigo
            const [gradient, border, text, bg] = colors.split(' ')
            const Icon = item.icon
            return (
              <div key={item.label} className={`bg-gradient-to-br ${gradient} ${border} border rounded-lg p-4 shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className={`text-xs uppercase tracking-wide font-medium ${text}`}>{item.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${text.replace('600', '900')}`}>
                      {Money(item.amount ?? 0, summary, item.label === 'Grand profit' ? 'grand_profit' : item.label === 'Grand revenue' ? 'grand_revenue' : item.label === 'Cash revenue' ? 'cash_revenue' : 'credit_revenue')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{item.sub}</p>
                  </div>
                  <div className={`${bg} rounded-full p-2 ml-2`}>
                    <Icon className={`h-5 w-5 ${text}`} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {renderProductTable('Cash products', cashRows, 'text-success')}
        {renderProductTable('Credit products', creditRows, 'text-warning-foreground')}

        <div className="overflow-x-auto rounded-lg border-2 border-primary/30 bg-accent/60 shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-primary">
                <th className="px-4 py-2 text-right" colSpan={4}>Grand total</th>
                <th className="px-4 py-2 text-right">Lines</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right" colSpan={2} />
                <th className="px-4 py-2 text-right">Revenue</th>
                <th className="px-4 py-2 text-right">Cost</th>
                <th className="px-4 py-2 text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="px-4 py-3 text-right text-sm font-bold uppercase tracking-wide text-foreground/85">
                  All products (cash + credit)
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-foreground/85">
                  {summary.total_line_count ?? 0}
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-foreground/85">
                  {formatNumber(Number(summary.grand_quantity ?? 0), 2)}
                </td>
                <td colSpan={2} />
                <td className="px-4 py-3 text-right text-sm font-bold text-foreground/85">
                  {Money(summary.grand_revenue ?? 0, summary, 'grand_revenue')}
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-foreground/85">
                  {Money(summary.grand_total_cost ?? 0, summary, 'grand_total_cost')}
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-emerald-900">
                  {Money(summary.grand_profit ?? 0, summary, 'grand_profit')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {data.accounting_note && (
          <p className="text-xs text-muted-foreground border-t border-border/70 pt-3">{data.accounting_note}</p>
        )}
      </div>
    )
  }

  // Sales Report (cash vs credit customers)
  if (reportType === 'sales-report' && data) {
    const summary = data.summary || {}
    const cashRows = Array.isArray(data.cash_customers) ? data.cash_customers : []
    const creditRows = Array.isArray(data.credit_customers) ? data.credit_customers : []
    const segmentLabel = data.business_segment_label as string | undefined
    const segmentStationNames = Array.isArray(data.business_segment_station_names)
      ? (data.business_segment_station_names as string[])
      : undefined

    const renderCustomerTable = (title: string, rows: any[], titleClass: string, showPondBadge = false) => {
      const totalInv = rows.reduce((s: number, r: any) => s + Number(r.invoice_count ?? 0), 0)
      const totalAmt = rows.reduce((s: number, r: any) => s + Number(r.total ?? 0), 0)
      return (
        <div className="space-y-3">
          <h3 className={`text-sm font-semibold uppercase tracking-wide ${titleClass}`}>{title}</h3>
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Customer #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Customer</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Invoices</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-border">
                {rows.length > 0 ? (
                  rows.map((r: any, idx: number) => (
                    <tr
                      key={r.customer_id != null ? `cust-${r.customer_id}` : `cust-row-${idx}`}
                      className="hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 text-sm text-muted-foreground">{r.customer_number || '—'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-foreground">
                        <span>{r.display_name || '—'}</span>
                        {showPondBadge && r.is_pond_pos_customer ? (
                          <span className="ml-2 inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-primary">
                            Pond POS
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums text-foreground">{r.invoice_count ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                        {Money(r.total ?? 0, r, "total")}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      No sales in this section for the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="bg-muted/40">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                      Subtotal
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {totalInv}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                      {Money(totalAmt, documentsTotalRow(rows, { title, entityType: 'customers' }), 'total')}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )
    }

    const salesGrandDrill = documentsTotalRow(
      [...cashRows, ...creditRows],
      { title: 'Grand total sales', entityType: 'customers', field: 'grand_total' },
    )

    return (
      <div className="space-y-6">
        {businessSegmentProps ? (
          <BusinessSegmentFilter
            value={businessSegmentProps.value}
            onChange={businessSegmentProps.onChange}
            stations={businessSegmentProps.stations}
            lockedSegment={businessSegmentProps.lockedSegment}
            activeLabel={segmentLabel}
            activeStationNames={segmentStationNames}
          />
        ) : null}

        {salesPurchasePeriodProps ? (
          <SalesPurchasePeriodFilter
            dateRange={salesPurchasePeriodProps.dateRange}
            preset={salesPurchasePeriodProps.preset}
            onPresetChange={salesPurchasePeriodProps.onPresetChange}
            onDateChange={salesPurchasePeriodProps.onDateChange}
            period={period}
            description="Invoice totals by customer for invoice dates in this range (non-draft)."
          />
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Cash sales', amount: summary.cash_sales_total, field: 'cash_sales_total', sub: `${summary.cash_invoice_count ?? 0} invoices`, icon: Banknote, color: 'green' },
            { label: 'Credit sales', amount: summary.credit_sales_total, field: 'credit_sales_total', sub: `${summary.credit_invoice_count ?? 0} invoices`, icon: CreditCard, color: 'amber' },
            { label: 'Total invoices', amount: summary.total_invoices, field: '', sub: 'in period', icon: FileText, color: 'blue', count: true },
            { label: 'Grand total', amount: summary.grand_total, field: 'grand_total', sub: 'cash + credit', icon: DollarSign, color: 'indigo' },
          ].map((item) => {
            const colorMap: Record<string, string> = {
              green: 'from-green-50 to-green-100 border-success/25 text-success bg-green-200',
              amber: 'from-amber-50 to-amber-100 border-warning/30 text-amber-600 bg-amber-200',
              blue: 'from-accent to-blue-100 border-primary/25 text-primary bg-blue-200',
              indigo: 'from-accent to-accent border-primary/25 text-primary bg-accent',
            }
            const colors = colorMap[item.color] || colorMap.blue
            const [gradient, border, text, bg] = colors.split(' ')
            const Icon = item.icon
            const summaryRow = { ...summary, ...salesGrandDrill }
            return (
              <div key={item.label} className={`bg-gradient-to-br ${gradient} ${border} border rounded-lg p-4 shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className={`text-xs uppercase tracking-wide font-medium ${text}`}>{item.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${text.replace('600', '900')}`}>
                      {item.count
                        ? (item.amount ?? 0)
                        : Money(item.amount ?? 0, summaryRow, item.field || 'total')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{item.sub}</p>
                  </div>
                  <div className={`${bg} rounded-full p-2 ml-2`}>
                    <Icon className={`h-5 w-5 ${text}`} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {renderCustomerTable('Cash customers', cashRows, 'text-success')}
        {renderCustomerTable('Credit customers', creditRows, 'text-warning-foreground', true)}

        <div className="overflow-x-auto rounded-lg border-2 border-primary/30 bg-accent/60 shadow-sm">
          <table className="min-w-full">
            <tbody>
              <tr>
                <td colSpan={2} className="px-4 py-3 text-right text-sm font-bold uppercase tracking-wide text-foreground/85">
                  Grand total sales
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-foreground/85">
                  {summary.total_invoices ?? 0}
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-foreground/85">
                  {Money(summary.grand_total ?? 0, { ...summary, ...salesGrandDrill }, 'grand_total')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {data.accounting_note && (
          <p className="text-xs text-muted-foreground border-t border-border/70 pt-3">{data.accounting_note}</p>
        )}
      </div>
    )
  }

  // Purchase Report (cash vs credit vendors)
  if (reportType === 'purchase-report' && data) {
    const summary = data.summary || {}
    const cashRows = Array.isArray(data.cash_vendors) ? data.cash_vendors : []
    const creditRows = Array.isArray(data.credit_vendors) ? data.credit_vendors : []
    const segmentLabel = data.business_segment_label as string | undefined
    const segmentStationNames = Array.isArray(data.business_segment_station_names)
      ? (data.business_segment_station_names as string[])
      : undefined

    const renderVendorTable = (title: string, rows: any[], titleClass: string) => {
      const totalBills = rows.reduce((s: number, r: any) => s + Number(r.bill_count ?? 0), 0)
      const totalAmt = rows.reduce((s: number, r: any) => s + Number(r.total ?? 0), 0)
      return (
        <div className="space-y-3">
          <h3 className={`text-sm font-semibold uppercase tracking-wide ${titleClass}`}>{title}</h3>
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Vendor #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Vendor</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Bills</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-border">
                {rows.length > 0 ? (
                  rows.map((r: any, idx: number) => (
                    <tr
                      key={r.vendor_id != null ? `vend-${r.vendor_id}` : `vend-row-${idx}`}
                      className="hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 text-sm text-muted-foreground">{r.vendor_number || '—'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{r.display_name || '—'}</td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums text-foreground">{r.bill_count ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                        {Money(r.total ?? 0, r, "total")}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      No purchases in this section for the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="bg-muted/40">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                      Subtotal
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {totalBills}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                      {Money(totalAmt, documentsTotalRow(rows, { title, entityType: 'vendors' }), 'total')}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )
    }

    const purchaseGrandDrill = documentsTotalRow(
      [...cashRows, ...creditRows],
      { title: 'Grand total purchases', entityType: 'vendors', field: 'grand_total' },
    )

    return (
      <div className="space-y-6">
        {businessSegmentProps ? (
          <BusinessSegmentFilter
            value={businessSegmentProps.value}
            onChange={businessSegmentProps.onChange}
            stations={businessSegmentProps.stations}
            lockedSegment={businessSegmentProps.lockedSegment}
            activeLabel={segmentLabel}
            activeStationNames={segmentStationNames}
            hint="Fuel Station = forecourt vendor bills. Aquaculture = Premium Agro shop receipts (feed, medicine, supplies)."
          />
        ) : null}

        {salesPurchasePeriodProps ? (
          <SalesPurchasePeriodFilter
            dateRange={salesPurchasePeriodProps.dateRange}
            preset={salesPurchasePeriodProps.preset}
            onPresetChange={salesPurchasePeriodProps.onPresetChange}
            onDateChange={salesPurchasePeriodProps.onDateChange}
            period={period}
            description="Bill totals by vendor for bill dates in this range (non-draft, non-void)."
          />
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Cash purchases', amount: summary.cash_purchase_total, field: 'cash_purchase_total', sub: `${summary.cash_bill_count ?? 0} bill portions`, icon: Banknote, color: 'green' },
            { label: 'Credit purchases', amount: summary.credit_purchase_total, field: 'credit_purchase_total', sub: `${summary.credit_bill_count ?? 0} bill portions`, icon: CreditCard, color: 'amber' },
            { label: 'Total bill portions', amount: summary.total_bills, field: '', sub: 'cash + credit rows', icon: FileText, color: 'blue', count: true },
            { label: 'Grand total', amount: summary.grand_total, field: 'grand_total', sub: 'cash + credit', icon: DollarSign, color: 'indigo' },
          ].map((item) => {
            const colorMap: Record<string, string> = {
              green: 'from-green-50 to-green-100 border-success/25 text-success bg-green-200',
              amber: 'from-amber-50 to-amber-100 border-warning/30 text-amber-600 bg-amber-200',
              blue: 'from-accent to-blue-100 border-primary/25 text-primary bg-blue-200',
              indigo: 'from-accent to-accent border-primary/25 text-primary bg-accent',
            }
            const colors = colorMap[item.color] || colorMap.blue
            const [gradient, border, text, bg] = colors.split(' ')
            const Icon = item.icon
            const summaryRow = { ...summary, ...purchaseGrandDrill }
            return (
              <div key={item.label} className={`bg-gradient-to-br ${gradient} ${border} border rounded-lg p-4 shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className={`text-xs uppercase tracking-wide font-medium ${text}`}>{item.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${text.replace('600', '900')}`}>
                      {item.count
                        ? (item.amount ?? 0)
                        : Money(item.amount ?? 0, summaryRow, item.field || 'total')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{item.sub}</p>
                  </div>
                  <div className={`${bg} rounded-full p-2 ml-2`}>
                    <Icon className={`h-5 w-5 ${text}`} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {renderVendorTable('Cash vendors', cashRows, 'text-success')}
        {renderVendorTable('Credit vendors', creditRows, 'text-warning-foreground')}

        {data.accounting_note && (
          <p className="text-xs text-muted-foreground border-t border-border/70 pt-3">{data.accounting_note}</p>
        )}
      </div>
    )
  }

  // Customer & Vendor Balances
  if ((reportType === 'customer-balances' || reportType === 'vendor-balances') && data) {
    const isCustomer = reportType === 'customer-balances'
    const entries = isCustomer
      ? Array.isArray(data.customers)
        ? data.customers
        : []
      : Array.isArray(data.vendors)
        ? data.vendors
        : []
    const totalPositive = isCustomer ? Number(data?.total_ar ?? 0) : Number(data?.total_ap ?? 0)
    const netListed = entries.reduce((sum: number, entry: any) => sum + Number(entry.balance ?? 0), 0)
    const totalNet = data?.total_net_balance != null ? Number(data.total_net_balance) : netListed
    const period = data?.period || {}
    const contactDrill = contactsTotalRow(
      entries,
      isCustomer ? 'Customer balances' : 'Vendor balances',
      isCustomer ? 'customers' : 'vendors',
    )
    
    return (
      <div className="space-y-6">
        {/* Report Period - Date Range */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          `${isCustomer ? 'Customer' : 'Vendor'} balances are shown as of the end date.`
        )}

        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
            <p className="text-sm text-muted-foreground uppercase tracking-wide">Total {isCustomer ? 'Customers' : 'Vendors'}</p>
            <p className="text-2xl font-semibold text-foreground mt-2">{entries.length}</p>
          </div>
          <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
            <p className="text-sm text-muted-foreground uppercase tracking-wide">Total {isCustomer ? 'Accounts Receivable' : 'Accounts Payable'}</p>
            <p className={`text-2xl font-semibold mt-2 ${totalPositive >= 0 ? 'text-foreground' : 'text-destructive'}`}>
                      {Money(Math.abs(totalPositive), contactDrill, isCustomer ? 'total_ar' : 'total_ap')}
            </p>
          </div>
          <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
            <p className="text-sm text-muted-foreground uppercase tracking-wide">With {isCustomer ? 'Outstanding' : 'Outstanding'} Balance</p>
            <p className="text-2xl font-semibold text-foreground mt-2">
              {entries.filter((e: any) => Number(e.balance) !== 0).length}
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  {isCustomer ? 'Customer' : 'Vendor'} #
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  {isCustomer ? 'Customer' : 'Vendor'} Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Phone</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Balance</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border">
              {entries.length > 0 ? (
                entries.map((entry: any, idx: number) => {
                  const balance = Number(entry.balance ?? 0)
                  const entityId = Number(isCustomer ? entry.customer_id : entry.vendor_id)
                  const ledgerDrill: ReportDrillTarget | null =
                    entityId > 0
                      ? {
                          kind: 'contact-ledger',
                          entity: isCustomer ? 'customers' : 'vendors',
                          entityId,
                          label: entry.display_name || entry.company_name || undefined,
                          startDate: period.start_date || dateRange?.startDate,
                          endDate: period.end_date || dateRange?.endDate,
                        }
                      : null
                  return (
                    <tr
                      key={
                        entry.id != null
                          ? `${isCustomer ? 'cust' : 'vend'}-${entry.id}`
                          : `${isCustomer ? 'cust' : 'vend'}-${idx}-${String(entry.vendor_number ?? entry.customer_number ?? '')}`
                      }
                      className="hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-foreground">
                        {isCustomer ? entry.customer_number : entry.vendor_number}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {entry.display_name || entry.company_name || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{entry.email || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{entry.phone || '—'}</td>
                      <td className={`px-4 py-3 text-sm text-right font-semibold ${
                        balance > 0 ? 'text-destructive' : balance < 0 ? 'text-success' : 'text-foreground'
                      }`}>
                        <DrillAmount amount={Math.abs(balance)} drill={ledgerDrill} disabled={balance === 0} />
                        {balance > 0 && isCustomer && <span className="block text-xs text-muted-foreground mt-1">(Owed to us)</span>}
                        {balance > 0 && !isCustomer && <span className="block text-xs text-muted-foreground mt-1">(We owe)</span>}
                        {balance < 0 && <span className="block text-xs text-muted-foreground mt-1">(Credit)</span>}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <Users className="h-12 w-12 text-muted-foreground/40 mb-3" />
                      <p className="text-muted-foreground font-medium">No {isCustomer ? 'customers' : 'vendors'} found</p>
                      <p className="text-muted-foreground/70 text-sm mt-1">
                        {isCustomer ? 'Add customers to see their balances here' : 'Add vendors to see their balances here'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {entries.length > 0 && (
              <tfoot className="bg-muted/40">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                    Sub-total —{' '}
                    {isCustomer ? 'accounts receivable (balance > 0)' : 'accounts payable (balance > 0)'}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-foreground">
                    {Money(Math.abs(totalPositive), contactDrill, isCustomer ? 'total_ar' : 'total_ap')}
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                    Total — net of all listed balances
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-foreground">
                    {Money(totalNet, contactDrill, 'total_net_balance')}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )
  }

  // Shift Summary - Sessions
  if (reportType === 'shift-summary' && data) {
    const summary = data.summary || {}
    const sessions = Array.isArray(data.sessions) ? data.sessions : []
    const byCashier = data.by_cashier || {}
    const sessTotals =
      sessions.length > 0
        ? {
            tx: Number(summary.total_transactions ?? sessions.reduce((s: number, x: any) => s + Number(x.transaction_count ?? 0), 0)),
            sales: Number(summary.total_sales ?? sessions.reduce((s: number, x: any) => s + Number(x.total_sales ?? 0), 0)),
            L: Number(summary.total_liters ?? sessions.reduce((s: number, x: any) => s + Number(x.total_liters ?? 0), 0)),
            exp: Number(summary.total_cash_expected ?? sessions.reduce((s: number, x: any) => s + Number(x.cash_expected ?? 0), 0)),
            cnt: Number(summary.total_cash_counted ?? sessions.reduce((s: number, x: any) => s + Number(x.cash_counted ?? 0), 0)),
            var: Number(summary.total_variance ?? sessions.reduce((s: number, x: any) => s + Number(x.variance ?? 0), 0)),
          }
        : null

    return (
      <div className="space-y-6">
        {/* Period Info - Editable inline date inputs */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          "Shift sessions and cashier performance data is filtered by this date range."
        )}
        
        {/* Summary Cards */}
        {summary && Object.keys(summary).length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4">Executive Summary</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-accent to-blue-100 border border-primary/25 rounded-lg p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-primary uppercase tracking-wide">Total Sessions</p>
                    <p className="text-2xl font-bold text-blue-900 mt-2">{summary.total_sessions || 0}</p>
                    <p className="text-xs text-primary mt-1">
                      {summary.active_sessions || 0} Active • {summary.closed_sessions || 0} Closed
                    </p>
                  </div>
                  <div className="bg-blue-200 rounded-full p-3">
                    <Users className="h-6 w-6 text-primary" />
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-green-50 to-green-100 border border-success/25 rounded-lg p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-success uppercase tracking-wide">Total Sales</p>
                    <p className="text-2xl font-bold text-green-900 mt-2">
                      {Money(summary.total_sales, summary, 'total_sales')}
                    </p>
                    <p className="text-xs text-success mt-1">
                      {formatNumber(Number(summary.total_liters || 0))} Liters
                    </p>
                  </div>
                  <div className="bg-green-200 rounded-full p-3">
                    <DollarSign className="h-6 w-6 text-success" />
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-purple-600 uppercase tracking-wide">Cash Expected</p>
                    <p className="text-2xl font-bold text-purple-900 mt-2">
                      {Money(summary.total_cash_expected, summary, 'total_cash_expected')}
                    </p>
                    <p className="text-xs text-purple-600 mt-1">
                      Counted: {Money(summary.total_cash_counted || 0, summary, 'total_cash_counted')}
                    </p>
                  </div>
                  <div className="bg-purple-200 rounded-full p-3">
                    <TrendingUp className="h-6 w-6 text-purple-600" />
                  </div>
                </div>
              </div>
              
              <div className={`bg-gradient-to-br rounded-lg p-5 shadow-sm border ${
                (summary.total_variance || 0) >= 0 
                  ? 'from-green-50 to-green-100 border-success/25' 
                  : 'from-red-50 to-red-100 border-destructive/25'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-xs font-medium uppercase tracking-wide ${
                      (summary.total_variance || 0) >= 0 ? 'text-success' : 'text-destructive'
                    }`}>
                      Net Variance
                    </p>
                    <p className={`text-2xl font-bold mt-2 ${
                      (summary.total_variance || 0) >= 0 ? 'text-green-900' : 'text-red-900'
                    }`}>
                      {Money(Math.abs(summary.total_variance || 0), summary, 'total_variance')}
                    </p>
                    <p className={`text-xs mt-1 ${
                      (summary.total_variance || 0) >= 0 ? 'text-success' : 'text-destructive'
                    }`}>
                      {formatNumber(Number(summary.variance_percentage || 0))}% of expected
                    </p>
                  </div>
                  <div className={`rounded-full p-3 ${
                    (summary.total_variance || 0) >= 0 ? 'bg-green-200' : 'bg-red-200'
                  }`}>
                    <BarChart3 className={`h-6 w-6 ${
                      (summary.total_variance || 0) >= 0 ? 'text-success' : 'text-destructive'
                    }`} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Cashier Performance Summary */}
        {byCashier && Object.keys(byCashier).length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4">Cashier Performance</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(byCashier).map(([cashier, stats]: [string, any], cIdx: number) => (
                <div key={`cashier-${cIdx}-${cashier}`} className="bg-white border border-border rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-foreground text-lg">{cashier}</h4>
                    <span className="px-3 py-1 bg-blue-100 text-primary rounded-full text-xs font-medium">
                      {stats.sessions} {stats.sessions === 1 ? 'Session' : 'Sessions'}
                    </span>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-border/70">
                      <span className="text-sm text-muted-foreground">Total Sales</span>
                      <span className="text-base font-semibold text-foreground">
                        {Money(stats.total_sales, { ...stats, documents: stats.documents }, 'total_sales')}
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center pb-2 border-b border-border/70">
                      <span className="text-sm text-muted-foreground">Volume</span>
                      <span className="text-base font-semibold text-foreground">
                        {formatNumber(Number(stats.total_liters || 0))} L
                      </span>
                    </div>
                    
                    {stats.total_cash_sales !== undefined && (
                      <div className="flex justify-between items-center pb-2 border-b border-border/70">
                        <span className="text-sm text-muted-foreground">Cash Sales</span>
                        <span className="text-base font-semibold text-success">
                          {Money(stats.total_cash_sales || 0, stats, 'total_cash_sales')}
                        </span>
                      </div>
                    )}
                    
                    {stats.total_non_cash_sales !== undefined && (
                      <div className="flex justify-between items-center pb-2 border-b border-border/70">
                        <span className="text-sm text-muted-foreground">Non-Cash Sales</span>
                        <span className="text-base font-semibold text-primary">
                          {Money(stats.total_non_cash_sales || 0, stats, 'total_non_cash_sales')}
                        </span>
                      </div>
                    )}
                    
                    <div className="pt-2">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium text-foreground/85">Cash Variance</span>
                        <span className={`text-base font-bold ${
                          (stats.cash_variance || 0) >= 0 ? 'text-success' : 'text-destructive'
                        }`}>
                          {Money(Math.abs(Number(stats.cash_variance || 0)), stats, 'cash_variance')}
                        </span>
                      </div>
                      {stats.variance_percentage !== undefined && (
                        <div className="w-full bg-muted rounded-full h-2 mt-2">
                          <div 
                            className={`h-2 rounded-full ${
                              (stats.cash_variance || 0) >= 0 ? 'bg-green-500' : 'bg-destructive/50'
                            }`}
                            style={{ 
                              width: `${Math.min(Math.abs(stats.variance_percentage || 0), 100)}%` 
                            }}
                          />
                        </div>
                      )}
                      {stats.variance_percentage !== undefined && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatNumber(Number(stats.variance_percentage || 0))}% variance rate
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sessions Table */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Session Details</h3>
            {sessions.length > 0 && (
              <span className="text-sm text-muted-foreground">
                Showing {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
              </span>
            )}
          </div>
          
          {sessions.length > 0 ? (
            <div className="overflow-x-auto bg-white rounded-lg border border-border shadow-sm">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">Cashier</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">Station</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">Opened</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">Closed</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">Transactions</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">Sales</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">Liters</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">Cash Expected</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">Cash Counted</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">Variance</th>
                    <th className="px-6 py-4 text-center text-xs font-semibold text-foreground/85 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {sessions.map((session: any) => (
                    <tr key={session.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">{session.cashier_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-muted-foreground">{session.station_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-foreground">
                          {formatDate(session.opened_at)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(session.opened_at, true).split(', ')[1]}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {session.closed_at ? (
                          <>
                            <div className="text-sm text-foreground">
                              {formatDate(session.closed_at)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDate(session.closed_at, true).split(', ')[1]}
                            </div>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground/70">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm font-medium text-foreground">
                          {session.transaction_count || 0}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm font-semibold text-foreground">
                          {Money(session.total_sales, session, 'total_sales')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm text-muted-foreground">
                          {formatNumber(Number(session.total_liters || 0))} L
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm text-foreground/85">
                          {Money(session.cash_expected || 0, session, "cash_expected")}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm text-foreground/85">
                          {Money(session.cash_counted || 0, session, "cash_counted")}
                        </span>
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-right`}>
                        <span className={`text-sm font-semibold ${
                          (session.variance || 0) >= 0 ? 'text-success' : 'text-destructive'
                        }`}>
                          {Money(session.variance || 0, session, "variance")}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                          session.status === 'OPEN' 
                            ? 'bg-success/15 text-success border border-success/25' 
                            : session.status === 'CLOSED'
                            ? 'bg-muted text-foreground border border-border'
                            : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                        }`}>
                          {session.status || 'UNKNOWN'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {sessTotals && (
                  <tfoot className="bg-muted/40">
                    <tr>
                      <td colSpan={4} className="px-6 py-3 text-right text-sm font-semibold text-foreground">
                        Totals — all sessions
                      </td>
                      <td className="px-6 py-3 text-right text-sm font-bold tabular-nums text-foreground">{sessTotals.tx}</td>
                      <td className="px-6 py-3 text-right text-sm font-bold text-foreground">{Money(sessTotals.sales, documentsTotalRow(sessions, { title: 'Session sales', entityType: 'customers' }), 'total_sales')}</td>
                      <td className="px-6 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                        {formatNumber(sessTotals.L)} L
                      </td>
                      <td className="px-6 py-3 text-right text-sm font-semibold text-foreground">{Money(sessTotals.exp, summary, 'total_cash_expected')}</td>
                      <td className="px-6 py-3 text-right text-sm font-semibold text-foreground">{Money(sessTotals.cnt, summary, 'total_cash_counted')}</td>
                      <td className="px-6 py-3 text-right text-sm font-bold text-foreground">{Money(Math.abs(sessTotals.var), summary, 'total_variance')}</td>
                      <td className="px-6 py-3" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <div className="bg-muted/40 border border-border rounded-lg p-12 text-center">
              <Users className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
              <p className="text-muted-foreground text-lg font-medium">No shift sessions found</p>
              <p className="text-muted-foreground/70 text-sm mt-2">
                Try adjusting the date range or check if shift sessions have been created
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Tank Dip Register (chronological audit trail)
  if (reportType === 'tank-dip-register' && data) {
    const entries = Array.isArray(data.entries) ? data.entries : []
    const byTank = Array.isArray(data.by_tank) ? data.by_tank : []
    const summary = data.summary || {}
    const netV = Number(summary.net_variance_liters ?? 0)
    const entryVarSum = entries.reduce((s: number, row: any) => {
      const v = row.variance_liters
      if (v == null || v === '') return s
      return s + Number(v)
    }, 0)
    const entryValSum = entries.reduce((s: number, row: any) => {
      const v = row.variance_value_estimate
      if (v == null || v === '') return s
      return s + Number(v)
    }, 0)

    return (
      <div className="space-y-6">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Dip dates within this range (chronological register).'
          )}

        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">
          <p className="font-medium text-foreground">How to read this register</p>
          <p className="mt-1 text-muted-foreground">
            <strong>Book (at dip)</strong> is system stock when the reading was saved. <strong>Stick</strong> is the
            measured volume. <strong>Variance</strong> = stick minus book (gain if positive). Value estimate uses the
            product&apos;s unit price × variance liters (same basis as Tank Dips screen).
          </p>
        </div>

        {summary && Object.keys(summary).length > 0 && (
          <div>
            <h4 className="font-semibold text-foreground mb-3">Period summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Readings</p>
                <p className="text-2xl font-bold text-foreground mt-1">{summary.readings_count ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tanks</p>
                <p className="text-2xl font-bold text-foreground mt-1">{summary.tanks_with_readings ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Gains</p>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{summary.gain_events ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Losses</p>
                <p className="text-2xl font-bold text-destructive mt-1">{summary.loss_events ?? 0}</p>
              </div>
              <div
                className={`rounded-lg border p-4 shadow-sm ${
                  netV >= 0
                    ? 'border-emerald-200 bg-emerald-50/80'
                    : 'border-destructive/25 bg-destructive/5/80'
                }`}
              >
                <p
                  className={`text-xs font-medium uppercase tracking-wide ${
                    netV >= 0 ? 'text-emerald-700' : 'text-destructive'
                  }`}
                >
                  Net variance (L)
                </p>
                <p
                  className={`text-2xl font-bold mt-1 tabular-nums ${
                    netV >= 0 ? 'text-emerald-900' : 'text-red-900'
                  }`}
                >
                  {netV >= 0 ? '+' : ''}
                  {formatNumber(netV)} L
                </p>
              </div>
            </div>
          </div>
        )}

        {byTank.length > 0 && (
          <div>
            <h4 className="font-semibold text-foreground mb-3">By tank</h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Tank</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Readings</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Net variance (L)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {byTank.map((row: any, tIdx: number) => (
                    <tr key={row.tank_id ?? row.id ?? `tank-row-${tIdx}-${String(row.tank_name ?? '')}`}>
                      <td className="px-4 py-2 text-foreground">{row.tank_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-foreground/85">{row.readings ?? 0}</td>
                      <td
                        className={`px-4 py-2 text-right font-medium tabular-nums ${
                          Number(row.net_variance_liters ?? 0) >= 0 ? 'text-emerald-700' : 'text-destructive'
                        }`}
                      >
                        {Number(row.net_variance_liters ?? 0) >= 0 ? '+' : ''}
                        {formatNumber(Number(row.net_variance_liters ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40">
                  <tr>
                    <td className="px-4 py-2 text-right text-xs font-semibold text-foreground">Totals — all tanks</td>
                    <td className="px-4 py-2 text-right text-xs font-bold tabular-nums text-foreground">
                      {byTank.reduce((s: number, r: any) => s + Number(r.readings ?? 0), 0)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right text-xs font-bold tabular-nums ${
                        netV >= 0 ? 'text-emerald-800' : 'text-destructive'
                      }`}
                    >
                      {netV >= 0 ? '+' : ''}
                      {formatNumber(netV)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <div>
          <h4 className="font-semibold text-foreground mb-3">Dip register (chronological)</h4>
          {entries.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-foreground text-white">
                  <tr>
                    <th className="px-3 py-3 text-left font-semibold">#</th>
                    <th className="px-3 py-3 text-left font-semibold">Date</th>
                    <th className="px-3 py-3 text-left font-semibold">Station</th>
                    <th className="px-3 py-3 text-left font-semibold">Tank</th>
                    <th className="px-3 py-3 text-left font-semibold">Product</th>
                    <th className="px-3 py-3 text-right font-semibold">Book (L)</th>
                    <th className="px-3 py-3 text-right font-semibold">Stick (L)</th>
                    <th className="px-3 py-3 text-right font-semibold">Variance (L)</th>
                    <th className="px-3 py-3 text-right font-semibold">% cap.</th>
                    <th className="px-3 py-3 text-right font-semibold">Est. value</th>
                    <th className="px-3 py-3 text-right font-semibold">Water (L)</th>
                    <th className="px-3 py-3 text-left font-semibold min-w-[140px]">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {entries.map((row: any, idx: number) => {
                    const v = row.variance_liters
                    const hasVar = v != null && v !== ''
                    const vn = hasVar ? Number(v) : null
                    return (
                      <tr key={row.id != null ? `dipreg-${row.id}-${idx}` : `dipreg-${idx}`} className="hover:bg-muted/50">
                        <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="px-3 py-2.5 text-foreground whitespace-nowrap">
                          {row.dip_date ? formatDate(row.dip_date) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-foreground/85">{row.station_name || '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-foreground">{row.tank_name || '—'}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{row.product_name || '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                          {row.book_before_liters != null ? formatNumber(Number(row.book_before_liters)) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                          {formatNumber(Number(row.measured_liters ?? 0))}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-medium tabular-nums ${
                            vn == null ? 'text-muted-foreground' : vn > 0 ? 'text-emerald-700' : vn < 0 ? 'text-destructive' : 'text-foreground'
                          }`}
                        >
                          {vn == null ? '—' : `${vn > 0 ? '+' : ''}${formatNumber(vn)}`}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {row.variance_pct_of_capacity != null && row.variance_pct_of_capacity !== ''
                            ? `${formatNumber(Number(row.variance_pct_of_capacity))}%`
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                          {row.variance_value_estimate != null && row.variance_value_estimate !== ''
                            ? Money(row.variance_value_estimate, row, "variance_value_estimate")
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {row.water_level_liters != null ? formatNumber(Number(row.water_level_liters)) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground max-w-xs truncate" title={row.notes || ''}>
                          {row.notes || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-muted">
                  <tr>
                    <td colSpan={7} className="px-3 py-2.5 text-right text-xs font-bold uppercase text-foreground">
                      Totals — all readings
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right text-xs font-bold tabular-nums ${
                        entryVarSum >= 0 ? 'text-emerald-900' : 'text-red-900'
                      }`}
                    >
                      {entryVarSum >= 0 ? '+' : ''}
                      {formatNumber(entryVarSum)}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-muted-foreground">—</td>
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-foreground">{Money(entryValSum, itemsTotalRow(entries, "Dip variance value", ["variance_value_estimate"]), "variance_value_estimate")}</td>
                    <td colSpan={3} className="px-3 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-12 text-center">
              <ClipboardList className="mx-auto h-14 w-14 text-muted-foreground/40" />
              <p className="mt-3 text-muted-foreground font-medium">No dip readings in this period</p>
              <p className="mt-1 text-sm text-muted-foreground">Adjust dates or record dips under Operations → Tank Dips.</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Tank Dip Variance
  if (reportType === 'tank-dip-variance' && data) {
    const dips = Array.isArray(data.dips) ? data.dips : []
    const byTank = data.by_tank || {}
    const summary = data.summary || {}
    const dipVq = dips.reduce(
      (s: number, d: { variance_quantity?: unknown; variance?: unknown }) =>
        s + Number(d.variance_quantity ?? d.variance ?? 0),
      0
    )
    const dipVval = dips.reduce(
      (s: number, d: { variance_value?: unknown }) => s + Number(d.variance_value ?? 0),
      0
    )

    return (
      <div className="space-y-6">
        {/* Period Info - Editable inline date inputs */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          "Tank dip readings and variance data is filtered by this date range."
        )}

        {typeof data.accounting_note === 'string' && data.accounting_note.trim() && (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">
            <p className="font-medium text-foreground">Valuation &amp; GL</p>
            <p className="mt-1 text-muted-foreground">{data.accounting_note}</p>
          </div>
        )}
        
        {/* Summary Section */}
        {summary && Object.keys(summary).length > 0 && (
          <div>
            <h4 className="font-semibold text-foreground mb-3">Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-muted/40 to-muted border border-border rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Dips</p>
                <p className="text-xl font-bold text-foreground mt-1">
                  {summary.total_dips ?? summary.total_readings ?? 0}
                </p>
              </div>
                  <div className="bg-muted rounded-full p-2 ml-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
              </div>
              </div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 border border-success/25 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-success uppercase tracking-wide font-medium">Total Gain (Liters)</p>
                    <p className="text-xl font-bold text-green-900 mt-1">{formatNumber(Number(summary.total_gain_quantity_liters || 0))}L</p>
              </div>
                  <div className="bg-green-200 rounded-full p-2 ml-2">
                    <TrendingUp className="h-4 w-4 text-success" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-red-100 border border-destructive/25 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-destructive uppercase tracking-wide font-medium">Total Loss (Liters)</p>
                    <p className="text-xl font-bold text-red-900 mt-1">{formatNumber(Number(summary.total_loss_quantity_liters || 0))}L</p>
                  </div>
                  <div className="bg-red-200 rounded-full p-2 ml-2">
                    <TrendingUp className="h-4 w-4 text-destructive rotate-180" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 border border-success/25 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-success uppercase tracking-wide font-medium">Total Gain (Value)</p>
                    <p className="text-xl font-bold text-green-900 mt-1">{Money(summary.total_gain_value, summary, "total_gain_value")}</p>
                  </div>
                  <div className="bg-green-200 rounded-full p-2 ml-2">
                    <DollarSign className="h-4 w-4 text-success" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-red-100 border border-destructive/25 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-destructive uppercase tracking-wide font-medium">Total Loss (Value)</p>
                    <p className="text-xl font-bold text-red-900 mt-1">{Money(summary.total_loss_value, summary, "total_loss_value")}</p>
                  </div>
                  <div className="bg-red-200 rounded-full p-2 ml-2">
                    <DollarSign className="h-4 w-4 text-destructive" />
                  </div>
                </div>
              </div>
              <div className={`bg-gradient-to-br ${(summary.net_variance_quantity || 0) >= 0 ? 'from-green-50 to-green-100 border-success/25' : 'from-red-50 to-red-100 border-destructive/25'} border rounded-lg p-4 shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-xs uppercase tracking-wide font-medium ${(summary.net_variance_quantity || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                  Net Variance
                </p>
                    <p className={`text-xl font-bold mt-1 ${(summary.net_variance_quantity || 0) >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                      {formatNumber(Number(summary.net_variance_quantity || 0))}L ({Money(summary.net_variance_value, summary, "net_variance_value")})
                </p>
                  </div>
                  <div className={`${(summary.net_variance_quantity || 0) >= 0 ? 'bg-green-200' : 'bg-red-200'} rounded-full p-2 ml-2`}>
                    <BarChart3 className={`h-4 w-4 ${(summary.net_variance_quantity || 0) >= 0 ? 'text-success' : 'text-destructive'}`} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* By Tank Summary */}
        {Object.keys(byTank).length > 0 && (
          <div>
            <h4 className="font-semibold text-foreground mb-3">By Tank</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(byTank).map(([tank, stats]: [string, any], tkIdx: number) => (
                <div key={`tank-card-${tkIdx}-${tank}`} className="border rounded-lg p-4">
                  <h5 className="font-medium text-foreground">{tank}</h5>
                  <p className="text-sm text-muted-foreground">{stats.product}</p>
                  <div className="mt-2 space-y-1 text-sm">
                    <p className="text-success">Gain: {formatNumber(Number(stats.total_gain_qty || 0))}L ({Money(stats.total_gain_value || 0, stats, "total_gain_value")})</p>
                    <p className="text-destructive">Loss: {formatNumber(Number(stats.total_loss_qty || 0))}L ({Money(stats.total_loss_value || 0, stats, "total_loss_value")})</p>
                    <p className={`font-medium ${(stats.net_variance_qty || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                      Net: {formatNumber(Number(stats.net_variance_qty || 0))}L ({Money(stats.net_variance_value || 0, stats, "net_variance_value")})
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dips Table */}
        <div>
          <h4 className="font-semibold text-foreground mb-3">Dip Reading Details</h4>
          {dips.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Tank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">System Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Measured Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Variance</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase" title="BDT at item cost (fallback: unit price)">
                      Value (cost)
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {dips.map((dip: any, idx: number) => {
                    const dateRaw = dip.reading_date ?? dip.dip_date
                    const sys = Number(
                      dip.system_quantity ?? dip.book_volume ?? 0
                    )
                    const meas = Number(dip.measured_quantity ?? dip.dip_volume ?? 0)
                    const vq = Number(dip.variance_quantity ?? dip.variance ?? 0)
                    const vType = dip.variance_type || (vq > 0 ? 'GAIN' : vq < 0 ? 'LOSS' : 'EVEN')
                    return (
                    <tr key={dip.id != null ? `dip-${dip.id}-${idx}` : `dip-${idx}`} className="hover:bg-muted/40">
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {dateRaw ? formatDate(dateRaw) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">{dip.tank_name}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{dip.product_name}</td>
                      <td className="px-4 py-3 text-sm text-right text-muted-foreground tabular-nums">
                        {formatNumber(sys)}L
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-muted-foreground tabular-nums">
                        {formatNumber(meas)}L
                      </td>
                      <td className={`px-4 py-3 text-sm text-right font-medium tabular-nums ${
                        vType === 'GAIN' ? 'text-success' : vType === 'LOSS' ? 'text-destructive' : 'text-muted-foreground'
                      }`}>
                        {vType === 'GAIN' ? '+' : ''}{formatNumber(vq)}L
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-muted-foreground tabular-nums">
                        {Money(dip.variance_value, dip, "variance_value")}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          vType === 'GAIN'
                            ? 'bg-success/15 text-success'
                            : vType === 'LOSS'
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-muted text-foreground/85'
                        }`}>
                          {vType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {dip.recorded_by?.trim() ? dip.recorded_by : '—'}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-muted/40">
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-xs font-semibold text-emerald-800">
                      Sub-total — gains (summary)
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-medium tabular-nums text-emerald-800">
                      +{formatNumber(Number(summary.total_gain_quantity_liters ?? 0))} L
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-medium text-emerald-800">
                      {Money(Number(summary.total_gain_value ?? 0), summary, "total_gain_value")}
                    </td>
                    <td colSpan={3} />
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-xs font-semibold text-destructive">
                      Sub-total — losses (summary)
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-medium tabular-nums text-destructive">
                      −{formatNumber(Number(summary.total_loss_quantity_liters ?? 0))} L
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-medium text-destructive">
                      {Money(Number(summary.total_loss_value ?? 0), summary, "total_loss_value")}
                    </td>
                    <td colSpan={3} />
                  </tr>
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-right text-sm font-bold text-foreground">
                      Total — net variance (all dips)
                    </td>
                    <td
                      className={`px-4 py-3 text-right text-sm font-bold tabular-nums ${
                        dipVq >= 0 ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {dipVq >= 0 ? '+' : ''}
                      {formatNumber(dipVq)} L
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-foreground">{Money(dipVval, documentsTotalRow(dips, { title: "Tank dip variance", entityType: "customers" }), "net_variance_value")}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="bg-muted/40 border border-border rounded-lg p-12 text-center">
              <div className="flex flex-col items-center">
                <TrendingUp className="h-16 w-16 text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground text-lg font-medium">No tank dip readings found</p>
                <p className="text-muted-foreground/70 text-sm mt-2">
                  Try adjusting the date range or create new dip readings
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }


  if (reportType === 'aquaculture-pond-pl' && data) {
    const ponds: any[] = Array.isArray(data.ponds) ? data.ponds : []
    const byCat: any[] = Array.isArray(data.expenses_by_category) ? data.expenses_by_category : []
    const incomeByPond: any[] = Array.isArray(data.income_by_pond) ? data.income_by_pond : []
    const incomeByCat: any[] = Array.isArray(data.income_by_category) ? data.income_by_category : []
    const expensesByPond: any[] = Array.isArray(data.expenses_by_pond) ? data.expenses_by_pond : []
    const segments: any[] = Array.isArray(data.pond_cycle_segments) ? data.pond_cycle_segments : []
    const t = data.totals || {}
    const period = data.period || {}
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Aquaculture pond P&L uses fish sales dates, expense dates, and payroll payment dates in this range.'
          )}
        {renderAquacultureFcrBlock(data)}
        <p className="text-sm font-medium text-foreground/85">
          All amounts in <strong>BDT</strong>.
        </p>
        {data.cycle_scope_note ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
            {String(data.cycle_scope_note)}
          </div>
        ) : null}
        <AquaculturePlNetSummary
          totals={t}
          entityName={
            ponds.length === 1
              ? ponds[0]?.pond_name
              : data.pond_scope_id
                ? scopeLabels?.ponds?.find((p) => p.id === Number(data.pond_scope_id))?.name ??
                  `Pond #${data.pond_scope_id}`
                : scopeLabels?.aquaculturePondId
                  ? scopeLabels.ponds?.find((p) => p.id === Number(scopeLabels.aquaculturePondId))?.name ??
                    null
                  : null
          }
        />
        <PlConsumptionCostsExpenses totals={t} />
        {ponds.length !== 1 ? <PlPondByPondExpenseTable ponds={ponds} totals={t} /> : null}
        <PlActiveExpenseCategoriesList categories={byCat} />
        <div>
          <AquaculturePlCategoryMatrices
            incomeByPond={incomeByPond}
            incomeByCategory={incomeByCat}
            expensesByPond={expensesByPond}
            expensesByCategory={byCat}
            incomeColumns={
              Array.isArray(data.pl_income_columns)
                ? (data.pl_income_columns as { code: string; label: string }[])
                : undefined
            }
            expenseColumns={
              Array.isArray(data.pl_expense_columns)
                ? (data.pl_expense_columns as { code: string; label: string }[])
                : undefined
            }
            showFullCatalog
            combinedMode
            rowTotalsByPond={ponds.map((p: any) => ({
              pond_id: p.pond_id,
              income_total: p.income_total ?? p.revenue,
              expense_total: p.expense_total ?? p.total_costs,
              net_profit: p.net_profit ?? p.profit,
            }))}
            grandTotals={
              (data.pl_grand_totals as {
                total_income: string
                total_costs_and_expenses: string
                net_profit: string
              } | undefined) ?? {
                total_income: String(t.revenue ?? '0'),
                total_costs_and_expenses: String(t.total_costs_and_expenses ?? t.total_costs ?? '0'),
                net_profit: String(t.net_profit ?? t.profit ?? '0'),
              }
            }
            formulaNote={typeof data.pl_formula_note === 'string' ? data.pl_formula_note : undefined}
            pondScopeLabel={
              ponds.length === 1
                ? ponds[0]?.pond_name
                : data.pond_scope_id
                  ? `Pond #${data.pond_scope_id}`
                  : 'All ponds'
            }
          />
        </div>
        {segments.length > 0 ? (
          <div>
            <h4 className="font-semibold text-foreground mb-2">Cycle segments (revenue &amp; direct costs)</h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Pond</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Cycle</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Revenue</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Direct exp.</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {segments.map((s: any, i: number) => (
                    <tr key={`${s.pond_id}-${s.production_cycle_id ?? 'u'}-${i}`}>
                      <td className="px-3 py-2">{s.pond_name}</td>
                      <td className="px-3 py-2">{s.production_cycle_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{MoneyBdt(s.revenue, s, "revenue")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{MoneyBdt(s.direct_operating_expenses, s, "direct_operating_expenses")}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{MoneyBdt(s.segment_margin, s, "segment_margin")}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 font-bold text-foreground">
                      Total — all segments
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-foreground">
                      {MoneyBdt(segments.reduce((s: number, x: any) => s + Number(x.revenue || 0), 0))}
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-foreground">
                      {MoneyBdt(segments.reduce((s: number, x: any) => s + Number(x.direct_operating_expenses || 0), 0))}
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-foreground">
                      {MoneyBdt(segments.reduce((s: number, x: any) => s + Number(x.segment_margin || 0), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  if (reportType === 'aquaculture-pond-sales-comprehensive' && data) {
    const period = data.period || {}
    const sm = data.summary || {}
    const fish = data.fish_sales || {}
    const pos = data.pos_shop_sales || {}
    const fishGroups: any[] = Array.isArray(fish.groups) ? fish.groups : []
    const posGroups: any[] = Array.isArray(pos.groups) ? pos.groups : []
    const fishTot = fish.totals || {}
    const posTot = pos.totals || {}
    const byInc: any[] = Array.isArray(sm.fish_by_income_type) ? sm.fish_by_income_type : []
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Fish rows use Aquaculture sale date; POS rows use invoice date. Optional pond filter applies to both sections.'
          )}
        <p className="text-sm font-medium text-foreground/85">
          All amounts in <strong>BDT</strong>. {data.accounting_note ? String(data.accounting_note) : ''}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-cyan-200 bg-cyan-50/80 p-4">
            <p className="text-xs font-medium uppercase text-cyan-900">Registered pond income</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-cyan-950">
              {MoneyBdt(sm.fish_total_amount_bdt)}
            </p>
            <p className="text-xs text-cyan-800">{sm.fish_line_count ?? 0} line(s)</p>
          </div>
          <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-muted-foreground">Pond POS (non-fuel)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
              {MoneyBdt(sm.pos_non_fuel_total_amount_bdt)}
            </p>
            <p className="text-xs text-muted-foreground">{sm.pos_non_fuel_line_count ?? 0} invoice line(s)</p>
          </div>
          <div className="rounded-lg border-2 border-border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase text-foreground">Combined</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
              {MoneyBdt(sm.combined_total_amount_bdt)}
            </p>
          </div>
        </div>
        {byInc.length > 0 ? (
          <div>
            <h4 className="mb-2 font-semibold text-foreground">Registered income by type</h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Income type</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Lines</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount (BDT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {byInc.map((r: any) => (
                    <tr key={r.income_type || 'x'}>
                      <td className="px-3 py-2">{r.income_type_label || r.income_type || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.line_count ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{MoneyBdt(r.amount_bdt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div>
          <h4 className="mb-2 font-semibold text-cyan-950">A. Registered pond sales (all income types)</h4>
          {fishGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No registered pond sales in this range.</p>
          ) : (
            fishGroups.map((g: any) => (
              <div key={`fish-${g.pond_id}`} className="mb-6 rounded-lg border border-border bg-white shadow-sm">
                <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2">
                  <h5 className="font-semibold text-cyan-950">{g.pond_name}</h5>
                </div>
                <div className="overflow-x-auto p-2">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-2 py-1">Date</th>
                        <th className="px-2 py-1">Income type</th>
                        <th className="px-2 py-1">Species</th>
                        <th className="px-2 py-1 text-right">Weight (kg)</th>
                        <th className="px-2 py-1 text-right">Amount (BDT)</th>
                        <th className="px-2 py-1">Buyer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {(g.lines || []).map((ln: any) => (
                        <tr key={ln.id}>
                          <td className="px-2 py-1.5 whitespace-nowrap">{ln.sale_date}</td>
                          <td className="px-2 py-1.5">{ln.income_type_label}</td>
                          <td className="px-2 py-1.5">{ln.fish_species_label || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {Number(ln.weight_kg).toLocaleString()}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.total_amount)}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{ln.buyer_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/40">
                      <tr>
                        <td colSpan={4} className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                          Sub-total — {g.pond_name}
                        </td>
                        <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-foreground">
                          {MoneyBdt(g.subtotal_amount)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ))
          )}
          {fishGroups.length > 0 ? (
            <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
              <span>Total — registered pond sales</span>
              <span className="float-right tabular-nums">{MoneyBdt(fishTot.total_amount)}</span>
            </div>
          ) : null}
        </div>

        <div>
          <h4 className="mb-2 font-semibold text-foreground">B. Invoices to pond POS customers (excludes fuel lines)</h4>
          <p className="mb-3 text-xs text-muted-foreground">
            Uses each pond&apos;s linked POS customer. Motor-fuel-classified products (same rule as the Fuel sales report)
            are omitted.
          </p>
          {posGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No matching invoice lines. Link a POS customer on the pond and record non-draft invoices to that customer.
            </p>
          ) : (
            posGroups.map((g: any) => (
              <div key={`pos-${g.pond_id}`} className="mb-6 rounded-lg border border-border bg-white shadow-sm">
                <div className="border-b border-border/70 bg-muted px-4 py-2">
                  <h5 className="font-semibold text-foreground">{g.pond_name}</h5>
                </div>
                <div className="overflow-x-auto p-2">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-2 py-1">Invoice date</th>
                        <th className="px-2 py-1">Invoice #</th>
                        <th className="px-2 py-1">Station</th>
                        <th className="px-2 py-1">Item</th>
                        <th className="px-2 py-1">POS class</th>
                        <th className="px-2 py-1 text-right">Qty</th>
                        <th className="px-2 py-1 text-right">Amount (BDT)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {(g.lines || []).map((ln: any) => (
                        <tr key={ln.id}>
                          <td className="px-2 py-1.5 whitespace-nowrap">{ln.invoice_date}</td>
                          <td className="px-2 py-1.5 font-mono text-xs">{ln.invoice_number}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{ln.station_name || '—'}</td>
                          <td className="px-2 py-1.5">{ln.item_name || '—'}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{ln.pos_category || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{ln.quantity}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/40">
                      <tr>
                        <td colSpan={6} className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                          Sub-total — {g.pond_name}
                        </td>
                        <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-foreground">
                          {MoneyBdt(g.subtotal_amount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ))
          )}
          {posGroups.length > 0 ? (
            <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
              <span>Total — pond POS (non-fuel)</span>
              <span className="float-right tabular-nums">{MoneyBdt(posTot.total_amount)}</span>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (
    reportType === 'aquaculture-feed-medicine-consumption' &&
    data &&
    Array.isArray(data.groups)
  ) {
    const pondName =
      data.filter_pond_id != null
        ? scopeLabels?.ponds?.find((p) => p.id === Number(data.filter_pond_id))?.name ??
          (typeof data.filter_pond_name === 'string' ? data.filter_pond_name : null)
        : null
    return (
      <AquacultureFeedMedicineConsumptionPanel
        data={data as Record<string, unknown>}
        hasPeriod={hasPeriod}
        renderPeriodFilter={(props) =>
          renderPeriodFilter(
            props.period,
            props.dateRange,
            props.reportType as ReportType,
            handleReportDateChange,
            props.hint,
          )
        }
        reportType={reportType}
        dateRange={dateRange}
        pondScopeLabel={pondName}
      />
    )
  }

  if (
    (reportType === 'aquaculture-fish-sales' ||
      reportType === 'aquaculture-expenses' ||
      reportType === 'aquaculture-equipment-assets' ||
      reportType === 'aquaculture-sampling' ||
      reportType === 'aquaculture-profit-transfers') &&
    data &&
    Array.isArray(data.groups)
  ) {
    const period = data.period || {}
    const groups: any[] = data.groups
    const totals = data.totals || {}
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            rt('reportPeriodRowsFiltered')
          )}
        {renderAquacultureFcrBlock(data)}
        <p className="text-sm font-medium text-foreground/85">
          {reportType === 'aquaculture-equipment-assets'
            ? 'Equipment, repair, and miscellaneous pond asset purchases in the period — amounts in '
            : 'All amounts in '}
          <strong>BDT</strong> where applicable.
        </p>
        {reportType === 'aquaculture-equipment-assets' && data.accounting_note ? (
          <p className="text-xs text-muted-foreground">{data.accounting_note}</p>
        ) : null}
        {reportType === 'aquaculture-sampling' && data.accounting_note ? (
          <p className="text-xs text-muted-foreground">{data.accounting_note}</p>
        ) : null}
        {groups.map((g: any) => (
          <div key={`${reportType}-g-${g.pond_id ?? 's'}`} className="rounded-lg border border-border bg-white shadow-sm">
            <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2">
              <h4 className="font-semibold text-cyan-950">{g.pond_name}</h4>
            </div>
            <div className="overflow-x-auto p-2">
              <table className="min-w-full text-sm">
                {reportType === 'aquaculture-fish-sales' ? (
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Income type</th>
                      <th className="px-2 py-1">Species</th>
                      <th className="px-2 py-1 text-right">Weight (kg)</th>
                      <th className="px-2 py-1 text-right">Amount (BDT)</th>
                      <th className="px-2 py-1">Buyer</th>
                    </tr>
                  </thead>
                ) : null}
                {reportType === 'aquaculture-expenses' || reportType === 'aquaculture-equipment-assets' ? (
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Category</th>
                      <th className="px-2 py-1 text-right">Amount (BDT)</th>
                      <th className="px-2 py-1">Vendor / memo</th>
                    </tr>
                  </thead>
                ) : null}
                {reportType === 'aquaculture-sampling' ? (
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Cycle</th>
                      <th className="px-2 py-1">Species</th>
                      <th className="px-2 py-1 text-right">Net count</th>
                      <th className="px-2 py-1 text-right">Net kg</th>
                      <th className="px-2 py-1 text-right">Pcs/kg</th>
                      <th className="px-2 py-1 text-right">Avg (g)</th>
                      <th className="px-2 py-1 text-right">Book heads</th>
                      <th className="px-2 py-1 text-right">Extrap. kg</th>
                      <th className="px-2 py-1 text-right">Gain kg</th>
                      <th className="px-2 py-1 text-right">Market BDT/kg</th>
                      <th className="px-2 py-1 text-right">Market value</th>
                      <th className="px-2 py-1 text-right">Margin vs bio</th>
                      <th className="px-2 py-1">Notes</th>
                    </tr>
                  </thead>
                ) : null}
                {reportType === 'aquaculture-profit-transfers' ? (
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1 text-right">Amount (BDT)</th>
                      <th className="px-2 py-1">Debit → Credit</th>
                      <th className="px-2 py-1">Memo</th>
                    </tr>
                  </thead>
                ) : null}
                <tbody className="divide-y divide-border/70">
                  {(g.lines || []).map((ln: any) => (
                    <tr key={ln.id}>
                      {reportType === 'aquaculture-fish-sales' ? (
                        <>
                          <td className="px-2 py-1.5 whitespace-nowrap">{ln.sale_date}</td>
                          <td className="px-2 py-1.5">{ln.income_type_label}</td>
                          <td className="px-2 py-1.5">{ln.fish_species_label || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{Number(ln.weight_kg).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.total_amount)}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{ln.buyer_name || '—'}</td>
                        </>
                      ) : null}
                      {reportType === 'aquaculture-expenses' || reportType === 'aquaculture-equipment-assets' ? (
                        <>
                          <td className="px-2 py-1.5 whitespace-nowrap">{ln.expense_date}</td>
                          <td className="px-2 py-1.5">{ln.expense_category_label}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.amount)}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{ln.vendor_name || '—'}</td>
                        </>
                      ) : null}
                      {reportType === 'aquaculture-sampling' ? (
                        <>
                          <td className="px-2 py-1.5 whitespace-nowrap">{ln.sample_date}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{ln.production_cycle_name || '—'}</td>
                          <td className="px-2 py-1.5">{ln.fish_species_label || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{ln.estimated_fish_count ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{ln.estimated_total_weight_kg || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{ln.fish_per_kg || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{ln.avg_weight_g || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{ln.stock_reference_fish_count ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{ln.extrapolated_biomass_kg || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{ln.biomass_gain_kg || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {ln.market_price_per_kg ? MoneyBdt(ln.market_price_per_kg) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {ln.market_value ? MoneyBdt(ln.market_value) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {ln.bioasset_margin ? MoneyBdt(ln.bioasset_margin) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">{(ln.notes || '').slice(0, 60)}</td>
                        </>
                      ) : null}
                      {reportType === 'aquaculture-profit-transfers' ? (
                        <>
                          <td className="px-2 py-1.5 whitespace-nowrap">{ln.transfer_date}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.amount)}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {ln.debit_account_code} → {ln.credit_account_code}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">{ln.memo || '—'}</td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40">
                  {reportType === 'aquaculture-fish-sales' ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                        Sub-total — {g.pond_name}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-foreground">
                        {MoneyBdt(g.subtotal_amount)}
                      </td>
                      <td />
                    </tr>
                  ) : null}
                  {reportType === 'aquaculture-expenses' || reportType === 'aquaculture-equipment-assets' ? (
                    <tr>
                      <td colSpan={2} className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                        Sub-total — {g.pond_name}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-foreground">
                        {MoneyBdt(g.subtotal_amount)}
                      </td>
                      <td />
                    </tr>
                  ) : null}
                  {reportType === 'aquaculture-sampling' ? (
                    <tr>
                      <td colSpan={9} className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                        Sub-total — {g.pond_name}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-foreground">
                        {g.subtotal_estimated_weight_kg ? `${g.subtotal_estimated_weight_kg} kg net` : ''}
                      </td>
                      <td colSpan={4} className="px-2 py-2 text-right text-xs font-bold text-foreground">
                        {g.subtotal_samples} sample(s)
                      </td>
                    </tr>
                  ) : null}
                  {reportType === 'aquaculture-profit-transfers' ? (
                    <tr>
                      <td className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                        Sub-total — {g.pond_name}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-foreground">
                        {MoneyBdt(g.subtotal_amount)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  ) : null}
                </tfoot>
              </table>
            </div>
          </div>
        ))}
        <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3">
          <div className="flex flex-wrap justify-between gap-2 text-sm font-bold text-foreground">
            <span>{pondTotal(groups.length === 1 ? groups[0]?.pond_name : null)}</span>
            <span className="tabular-nums">
              {reportType === 'aquaculture-fish-sales'
                ? MoneyBdt(totals.total_amount)
                : reportType === 'aquaculture-expenses' || reportType === 'aquaculture-equipment-assets'
                  ? MoneyBdt(totals.total_amount)
                  : reportType === 'aquaculture-profit-transfers'
                    ? MoneyBdt(totals.total_amount)
                    : `Samples: ${totals.sample_count ?? 0}`}
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (reportType === 'aquaculture-fingerling-transfers' && data && Array.isArray(data.transfers)) {
    const period = data.period || {}
    const statementLines: any[] = data.statement_lines || []
    const transfers: any[] = data.transfers
    const nursingSummary: any[] = data.nursing_summary || []
    const growoutSummary: any[] = data.growout_summary || []
    const recon = data.reconciliation || {}
    const totals = data.totals || {}
    const filtersApplied = data.filters_applied || {}
    const balanced = recon.balanced !== false
    const hasActiveFilters = Boolean(
      filtersApplied.search_q ||
        filtersApplied.species ||
        filtersApplied.min_cost ||
        filtersApplied.max_cost ||
        filtersApplied.nursing_pond_id ||
        filtersApplied.growout_pond_id ||
        (filtersApplied.balance && filtersApplied.balance !== 'all')
    )
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Transfer date within this range. Use Aquaculture filters above for search and cost value.'
          )}
        {data.report_note ? (
          <p className="text-sm text-muted-foreground">{data.report_note}</p>
        ) : null}
        {hasActiveFilters ? (
          <p className="rounded-md border border-cyan-200 bg-cyan-50/80 px-3 py-2 text-xs text-cyan-950">
            <span className="font-semibold">Active filters:</span>{' '}
            {[
              filtersApplied.search_q && `search="${filtersApplied.search_q}"`,
              filtersApplied.species && `species=${filtersApplied.species}`,
              filtersApplied.min_cost && `min cost ${filtersApplied.min_cost}`,
              filtersApplied.max_cost && `max cost ${filtersApplied.max_cost}`,
              filtersApplied.nursing_pond_id && `nursing pond #${filtersApplied.nursing_pond_id}`,
              filtersApplied.growout_pond_id && `receiving pond #${filtersApplied.growout_pond_id}`,
              filtersApplied.balance && filtersApplied.balance !== 'all' && filtersApplied.balance,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}

        <div className="rounded-lg border border-border bg-white shadow-sm">
          <div className="border-b border-border/70 bg-muted/40 px-4 py-2">
            <h4 className="font-semibold text-foreground">Full statement — all fingerling transfer lines</h4>
            <p className="text-xs text-muted-foreground">
              {statementLines.length} line(s) · amounts in BDT · liability = receiving pond biological cost
            </p>
          </div>
          <div className="overflow-x-auto p-2">
            {statementLines.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">No lines match the current filters.</p>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">Nursing pond</th>
                    <th className="px-2 py-1">Species</th>
                    <th className="px-2 py-1">Receiving pond</th>
                    <th className="px-2 py-1 text-right">Fish (#)</th>
                    <th className="px-2 py-1 text-right">kg</th>
                    <th className="px-2 py-1 text-right">pcs/kg</th>
                    <th className="px-2 py-1 text-right">Fry purchase</th>
                    <th className="px-2 py-1 text-right">Other costs</th>
                    <th className="px-2 py-1 text-right">Total liability</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {statementLines.map((ln: any) => (
                    <tr key={`st-${ln.line_id}`}>
                      <td className="whitespace-nowrap px-2 py-1.5">{ln.transfer_date}</td>
                      <td className="px-2 py-1.5">
                        {ln.from_pond_name || '—'}
                        {ln.from_cycle_name ? (
                          <div className="text-[11px] text-muted-foreground">{ln.from_cycle_name}</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">{ln.fish_species_label || '—'}</td>
                      <td className="px-2 py-1.5">
                        {ln.to_pond_name || '—'}
                        {ln.to_cycle_name ? (
                          <div className="text-[11px] text-muted-foreground">{ln.to_cycle_name}</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {ln.fish_count != null ? Number(ln.fish_count).toLocaleString() : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {Number(ln.weight_kg || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {ln.pcs_per_kg
                          ? Number(ln.pcs_per_kg).toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.purchase_cost)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.other_expenses_cost)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{MoneyBdt(ln.total_cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40">
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-right text-xs font-semibold">
                      Statement subtotal
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-bold tabular-nums">
                      {Number(totals.fish_count || 0).toLocaleString()}
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-bold tabular-nums">
                      {Number(totals.weight_kg || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </td>
                    <td />
                    <td className="px-2 py-2 text-right text-xs font-bold tabular-nums">
                      {MoneyBdt(totals.purchase_cost)}
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-bold tabular-nums">
                      {MoneyBdt(totals.other_expenses)}
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-bold tabular-nums">
                      {MoneyBdt(totals.total_cost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {transfers.length === 0 && statementLines.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            No fingerling transfers from nursing ponds in this period.
          </p>
        ) : transfers.length > 0 ? (
          <>
            <h4 className="text-sm font-semibold text-foreground">By transfer document</h4>
            {transfers.map((t: any) => (
            <div key={`fl-${t.transfer_id}`} className="rounded-lg border border-border bg-white shadow-sm">
              <div className="border-b border-border/70 bg-teal-50/80 px-4 py-2">
                <h4 className="font-semibold text-teal-950">
                  {t.transfer_date} · {t.from_pond_name || 'Nursing pond'} → grow-out
                </h4>
                <p className="text-xs text-teal-900/80">
                  {t.fish_species_label || '—'}
                  {t.from_cycle_name ? ` · batch: ${t.from_cycle_name}` : ''}
                  {t.transfer_balanced === false ? (
                    <span className="ml-2 font-semibold text-amber-800">Transfer not balanced</span>
                  ) : null}
                </p>
              </div>
              <div className="overflow-x-auto p-2">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1">Receiving pond</th>
                      <th className="px-2 py-1 text-right">Fish (#)</th>
                      <th className="px-2 py-1 text-right">Weight (kg)</th>
                      <th className="px-2 py-1 text-right">pcs/kg</th>
                      <th className="px-2 py-1 text-right">Fry purchase</th>
                      <th className="px-2 py-1 text-right">Other costs</th>
                      <th className="px-2 py-1 text-right">Total liability</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {(t.lines || []).map((ln: any) => (
                      <tr key={ln.line_id}>
                        <td className="px-2 py-1.5">
                          {ln.to_pond_name || '—'}
                          {ln.to_cycle_name ? (
                            <div className="text-[11px] text-muted-foreground">{ln.to_cycle_name}</div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {ln.fish_count != null ? Number(ln.fish_count).toLocaleString() : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {Number(ln.weight_kg || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {ln.pcs_per_kg ? Number(ln.pcs_per_kg).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.purchase_cost)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.other_expenses_cost)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{MoneyBdt(ln.total_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/40">
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                        Nursing out / Grow-out in
                      </td>
                      <td className="px-2 py-2 text-right text-xs tabular-nums" colSpan={2}>
                        {MoneyBdt(t.nursing_cost_out)} / {MoneyBdt(t.growout_liability_in)}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums">
                        {t.transfer_balanced ? '✓' : '≠'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            ))}
          </>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
            <h4 className="mb-2 text-sm font-semibold text-foreground">Nursing ponds — cost transferred out</h4>
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-1 text-left">Pond</th>
                  <th className="py-1 text-right">Fish</th>
                  <th className="py-1 text-right">Fry purchase</th>
                  <th className="py-1 text-right">Other</th>
                  <th className="py-1 text-right">Total out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {nursingSummary.map((r: any) => (
                  <tr key={`n-${r.pond_id}`}>
                    <td className="py-1.5">{r.pond_name}</td>
                    <td className="py-1.5 text-right tabular-nums">{Number(r.fish_count_out || 0).toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums">{MoneyBdt(r.purchase_cost_out)}</td>
                    <td className="py-1.5 text-right tabular-nums">{MoneyBdt(r.other_expenses_out)}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{MoneyBdt(r.total_cost_out)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
            <h4 className="mb-2 text-sm font-semibold text-foreground">Grow-out ponds — liability received</h4>
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-1 text-left">Pond</th>
                  <th className="py-1 text-right">Fish</th>
                  <th className="py-1 text-right">Fry purchase</th>
                  <th className="py-1 text-right">Other</th>
                  <th className="py-1 text-right">Total in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {growoutSummary.map((r: any) => (
                  <tr key={`g-${r.pond_id}`}>
                    <td className="py-1.5">{r.pond_name}</td>
                    <td className="py-1.5 text-right tabular-nums">{Number(r.fish_count_in || 0).toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums">{MoneyBdt(r.purchase_cost_in)}</td>
                    <td className="py-1.5 text-right tabular-nums">{MoneyBdt(r.other_expenses_in)}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{MoneyBdt(r.total_liability_in)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div
          className={`rounded-lg border-2 px-4 py-3 text-sm font-bold ${
            balanced ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-amber-400 bg-amber-50 text-amber-950'
          }`}
        >
          <div>Reconciliation — nursing cost out vs grow-out liability in</div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 font-normal text-sm">
            <span>
              Out: {MoneyBdt(recon.nursing_total_cost_out)} · In: {MoneyBdt(recon.growout_total_liability_in)}
            </span>
            <span className="tabular-nums">
              {balanced ? 'Balanced ✓' : `Difference: ${MoneyBdt(recon.difference)}`}
            </span>
          </div>
          <div className="mt-2 text-xs font-normal opacity-90">
            {Number(totals.fish_count || 0).toLocaleString()} fish · {Number(totals.weight_kg || 0).toLocaleString()} kg
            · Fry {MoneyBdt(totals.purchase_cost)} + Other {MoneyBdt(totals.other_expenses)} = {MoneyBdt(totals.total_cost)}
          </div>
        </div>
      </div>
    )
  }

  if (reportType === 'aquaculture-fish-transfers' && data && Array.isArray(data.groups)) {
    const period = data.period || {}
    const groups: any[] = data.groups
    const totals = data.totals || {}
    const summary = data.summary || {}
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Transfers filtered by transfer date within this range.'
          )}
        <p className="text-sm font-medium text-foreground/85">
          Inter-pond fish moves — weight and optional biological cost allocation in <strong>BDT</strong>.
        </p>
        {groups.map((g: any) => (
          <div key={`xfer-${g.id}`} className="rounded-lg border border-border bg-white shadow-sm">
            <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2">
              <h4 className="font-semibold text-cyan-950">
                {g.transfer_date} · {g.from_pond_name || 'Source pond'} → destinations
              </h4>
              <p className="text-xs text-cyan-900/80">
                {g.fish_species_label || '—'}
                {g.from_cycle_name ? ` · cycle: ${g.from_cycle_name}` : ''}
              </p>
            </div>
            <div className="overflow-x-auto p-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1">To pond</th>
                    <th className="px-2 py-1 text-right">Weight (kg)</th>
                    <th className="px-2 py-1 text-right">Fish count</th>
                    <th className="px-2 py-1 text-right">Cost (BDT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {(g.lines || []).map((ln: any) => (
                    <tr key={ln.id}>
                      <td className="px-2 py-1.5">{ln.to_pond_name || '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{Number(ln.weight_kg).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.fish_count ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.cost_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40">
                  <tr>
                    <td className="px-2 py-2 text-right text-xs font-semibold text-foreground">Sub-total</td>
                    <td className="px-2 py-2 text-right text-xs font-bold tabular-nums">{Number(g.subtotal_weight_kg).toLocaleString()}</td>
                    <td />
                    <td className="px-2 py-2 text-right text-xs font-bold tabular-nums">{MoneyBdt(g.subtotal_cost_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}
        <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
          <span>Total — {summary.transfer_count ?? groups.length} transfer(s)</span>
          <span className="float-right tabular-nums">
            {Number(totals.total_weight_kg ?? 0).toLocaleString()} kg · {MoneyBdt(totals.total_cost_amount)}
          </span>
        </div>
      </div>
    )
  }

  if (reportType === 'aquaculture-pond-total-inventory' && data && Array.isArray(data.groups)) {
    const period = data.period || {}
    const groups: any[] = data.groups
    const totals = data.totals || {}
    const asOf = data.as_of_date || period.end_date || ''
    const sectionOrder = [
      'feed',
      'medicine',
      'supplies',
      'fish_sku',
      'biological_fish',
      'equipment_assets',
    ]
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Combined pond inventory and asset value as of the report end date.'
          )}
        <p className="text-sm font-medium text-foreground/85">
          Total stock and value per pond as of <strong>{asOf}</strong> — warehouse, live fish, and deployed equipment (
          <strong>BDT</strong>).
        </p>
        {data.accounting_note ? (
          <p className="text-xs text-muted-foreground">{data.accounting_note}</p>
        ) : null}
        {groups.map((g: any) => {
          const st = g.subtotals || {}
          const lines: any[] = g.lines || []
          const bySection: Record<string, any[]> = {}
          for (const ln of lines) {
            const sk = ln.section || 'supplies'
            if (!bySection[sk]) bySection[sk] = []
            bySection[sk].push(ln)
          }
          return (
            <div key={`ptotal-${g.pond_id}`} className="rounded-lg border border-border bg-white shadow-sm">
              <div className="border-b border-border/70 bg-accent/90 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-lg font-bold text-teal-950">{g.pond_name}</h4>
                <span className="text-base font-bold tabular-nums text-primary">
                  Total: {MoneyBdt(st.total_bdt)}
                </span>
              </div>
              <div className="grid gap-2 border-b border-border/70 bg-muted/50 px-4 py-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">Feed</span>{' '}
                  <span className="font-semibold tabular-nums">{MoneyBdt(st.feed_bdt)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Medicine</span>{' '}
                  <span className="font-semibold tabular-nums">{MoneyBdt(st.medicine_bdt)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Supplies & materials</span>{' '}
                  <span className="font-semibold tabular-nums">{MoneyBdt(st.supplies_bdt)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Fish / fry SKU (warehouse)</span>{' '}
                  <span className="font-semibold tabular-nums">{MoneyBdt(st.fish_sku_bdt)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Live fish (biological)</span>{' '}
                  <span className="font-semibold tabular-nums">{MoneyBdt(st.biological_fish_bdt)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Equipment & assets</span>{' '}
                  <span className="font-semibold tabular-nums">{MoneyBdt(st.equipment_assets_bdt)}</span>
                </div>
              </div>
              <div className="space-y-4 p-3">
                {sectionOrder.map((sk) => {
                  const secLines = bySection[sk]
                  if (!secLines?.length) return null
                  const label = secLines[0]?.section_label || sk
                  return (
                    <div key={`${g.pond_id}-${sk}`}>
                      <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {label}
                      </h5>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs text-muted-foreground">
                              <th className="px-2 py-1">Item / description</th>
                              <th className="px-2 py-1 text-right">Qty</th>
                              <th className="px-2 py-1">Unit</th>
                              <th className="px-2 py-1 text-right">Value (BDT)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/70">
                            {secLines.map((ln: any, idx: number) => (
                              <tr key={`${sk}-${ln.item_id ?? ln.id ?? idx}`}>
                                <td className="px-2 py-1.5">
                                  <span className="font-medium">{ln.item_name}</span>
                                  {ln.vendor_name ? (
                                    <span className="block text-xs text-muted-foreground">
                                      {ln.expense_date ? `${ln.expense_date} · ` : ''}
                                      {ln.vendor_name}
                                      {ln.memo ? ` — ${ln.memo}` : ''}
                                    </span>
                                  ) : null}
                                  {ln.valuation_note ? (
                                    <span className="block text-xs text-muted-foreground">{ln.valuation_note}</span>
                                  ) : null}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">
                                  {ln.implied_net_fish_count != null
                                    ? `${Number(ln.quantity).toLocaleString()} kg / ${ln.implied_net_fish_count.toLocaleString()} fish`
                                    : Number(ln.quantity).toLocaleString()}
                                </td>
                                <td className="px-2 py-1.5 text-muted-foreground">
                                  {ln.cost_per_kg ? `${ln.unit} @ ${ln.cost_per_kg}/kg` : ln.unit}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                                  {MoneyBdt(ln.value_bdt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div className="rounded-lg border-2 border-teal-400 bg-accent px-4 py-4">
          <div className="flex flex-wrap justify-between gap-2 text-base font-bold text-teal-950">
            <span>{grandPondTotal(groups.length === 1 ? groups[0]?.pond_name : null)}</span>
            <span className="tabular-nums">{MoneyBdt(totals.grand_total_bdt)}</span>
          </div>
          <p className="mt-1 text-xs text-primary">{totals.pond_count ?? groups.length} pond(s) in report</p>
        </div>
      </div>
    )
  }

  const AQUACULTURE_POND_STOCK_REPORTS = new Set([
    'aquaculture-pond-feed-stock',
    'aquaculture-pond-medicine-stock',
    'aquaculture-pond-supplies-stock',
  ])
  if (AQUACULTURE_POND_STOCK_REPORTS.has(reportType) && data && Array.isArray(data.groups)) {
    const period = data.period || {}
    const groups: any[] = data.groups
    const totals = data.totals || {}
    const summary = data.summary || {}
    const asOf = data.as_of_date || period.end_date || ''
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'On-hand pond warehouse quantities as of the report end date.'
          )}
        <p className="text-sm font-medium text-foreground/85">
          {summary.stock_kind_label || 'Pond warehouse'} — snapshot as of <strong>{asOf}</strong>. Values in{' '}
          <strong>BDT</strong> at average unit cost.
        </p>
        {data.accounting_note ? (
          <p className="text-xs text-muted-foreground">{data.accounting_note}</p>
        ) : null}
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No on-hand stock for the selected pond filter.</p>
        ) : (
          groups.map((g: any) => (
            <div key={`pstock-${g.pond_id}`} className="rounded-lg border border-border bg-white shadow-sm">
              <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2">
                <h4 className="font-semibold text-cyan-950">{g.pond_name}</h4>
              </div>
              <div className="overflow-x-auto p-2">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1">Item</th>
                      <th className="px-2 py-1">Category</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                      <th className="px-2 py-1">Unit</th>
                      <th className="px-2 py-1 text-right">Value (BDT)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {(g.lines || []).map((ln: any) => (
                      <tr key={ln.item_id}>
                        <td className="px-2 py-1.5 font-medium">{ln.item_name}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{ln.reporting_category || '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{Number(ln.quantity).toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{ln.unit}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.extended_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/40">
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                        Sub-total — {g.pond_name}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-foreground">
                        {MoneyBdt(g.subtotal_value)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))
        )}
        <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
          <span>{pondTotal(groups.length === 1 ? groups[0]?.pond_name : null)}</span>
          <span className="float-right tabular-nums">{MoneyBdt(totals.total_value)}</span>
        </div>
      </div>
    )
  }

  if (reportType === 'aquaculture-pond-performance' && data) {
    const period = data.period || {}
    const ponds: any[] = Array.isArray(data.ponds) ? data.ponds : []
    const summary = data.summary || {}
    const loadLevelClass = (level: string | undefined) => {
      if (level === 'high_risk') return 'text-destructive font-medium'
      if (level === 'full') return 'text-warning-foreground font-medium'
      if (level === 'moderate') return 'text-primary'
      if (level === 'understocked') return 'text-muted-foreground'
      return ''
    }
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'FCR and ADG use this date range. Biomass, load, and bioasset are as of the period end date.'
          )}
        {renderAquacultureFcrBlock(data)}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">Ponds</div>
            <div className="font-semibold tabular-nums">{summary.pond_count ?? ponds.length}</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">Total biomass</div>
            <div className="font-semibold tabular-nums">
              {summary.total_biomass_kg != null
                ? `${formatNumber(Number(summary.total_biomass_kg), 2)} kg`
                : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">Total bioasset</div>
            <div className="font-semibold tabular-nums text-primary">
              {summary.total_bioasset_value != null ? MoneyBdt(summary.total_bioasset_value) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">Portfolio FCR</div>
            <div className="font-semibold tabular-nums text-primary">{summary.portfolio_fcr_biomass ?? '—'}</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">Avg ADG</div>
            <div className="font-semibold tabular-nums">
              {summary.avg_adg_g_per_fish_per_day != null
                ? `${summary.avg_adg_g_per_fish_per_day} g/fish/day`
                : '—'}
            </div>
          </div>
        </div>
        {ponds.length > 0 ? (
          <div>
            <h4 className="font-semibold text-foreground mb-2">Pond performance</h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Pond</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Fish</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Biomass kg</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Bioasset</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">ADG g/fish/day</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">FCR</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">kg/dec</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Load</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Feed kg</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Biomass gain</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {ponds.map((p: any) => (
                    <tr key={p.pond_id}>
                      <td className="px-3 py-2 font-medium">{p.pond_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(p.fish_count ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(Number(p.biomass_kg ?? 0), 2)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{MoneyBdt(p.bioasset_value)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-primary">
                        {p.adg_g_per_fish_per_day ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-primary">
                        {p.fcr_biomass ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.load_kg_per_decimal ?? '—'}</td>
                      <td className={`px-3 py-2 ${loadLevelClass(p.load_level)}`}>
                        {p.load_level_label ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(Number(p.feed_kg ?? 0), 2)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(Number(p.biomass_gain_kg ?? 0), 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {ponds.length > 1 ? (
                  <tfoot className="bg-muted/40 font-semibold">
                    <tr>
                      <td className="px-3 py-2">Total / portfolio</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(summary.total_fish_count ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(Number(summary.total_biomass_kg ?? 0), 2)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{MoneyBdt(summary.total_bioasset_value)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{summary.avg_adg_g_per_fish_per_day ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{summary.portfolio_fcr_biomass ?? '—'}</td>
                      <td className="px-3 py-2" colSpan={4} />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No active ponds match the current filters.</p>
        )}
        {data.methodology ? <p className="text-xs text-muted-foreground">{String(data.methodology)}</p> : null}
      </div>
    )
  }

  if (reportType === 'aquaculture-fish-growth' && data) {
    const period = data.period || {}
    const intervals: any[] = Array.isArray(data.intervals) ? data.intervals : []
    const loadRows: any[] = Array.isArray(data.load_by_pond) ? data.load_by_pond : []
    const summary = data.summary || {}
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Growth is measured between consecutive biomass samples; FCR and load use the same period.'
          )}
        {renderAquacultureFcrBlock(data)}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">Samples</div>
            <div className="font-semibold tabular-nums">{summary.sample_count ?? 0}</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">Growth intervals</div>
            <div className="font-semibold tabular-nums">{summary.interval_count ?? 0}</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">Period biomass gain</div>
            <div className="font-semibold tabular-nums">
              {summary.biomass_gain_kg != null ? `${formatNumber(Number(summary.biomass_gain_kg), 2)} kg` : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">Period FCR (biomass)</div>
            <div className="font-semibold tabular-nums text-primary">{summary.fcr_biomass ?? '—'}</div>
          </div>
        </div>
        {intervals.length > 0 ? (
          <div>
            <h4 className="font-semibold text-foreground mb-2">Sample-to-sample growth</h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Pond</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">From → To</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Days</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">ADG g/fish/day</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Biomass gain kg</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Feed kg</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Interval FCR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {intervals.map((row: any, idx: number) => (
                    <tr key={`${row.pond_id}-${row.from_sample_id}-${row.to_sample_id}-${idx}`}>
                      <td className="px-3 py-2 font-medium">{row.pond_name}</td>
                      <td className="px-3 py-2 text-xs">
                        {row.from_date} → {row.to_date}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.days}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-primary">
                        {row.adg_g_per_fish_per_day ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.biomass_gain_kg ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(Number(row.feed_kg ?? 0), 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.interval_fcr ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Need at least two biomass samples in the period to show growth intervals. Record samples under Aquaculture →
            Sampling.
          </p>
        )}
        {loadRows.length > 0 ? (
          <div>
            <h4 className="font-semibold text-foreground mb-2">Pond load (kg per decimal) — as of period end</h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Pond</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Live kg</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Live fish</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">pcs/kg</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">kg/dec</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Load</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {loadRows.map((r: any) => (
                    <tr key={r.pond_id}>
                      <td className="px-3 py-2 font-medium">{r.pond_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(Number(r.implied_net_weight_kg ?? 0), 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(r.implied_net_fish_count ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.current_fish_per_kg ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.stock_density_kg_per_decimal ?? '—'}</td>
                      <td className="px-3 py-2">{r.load_level_label ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {data.methodology ? <p className="text-xs text-muted-foreground">{String(data.methodology)}</p> : null}
      </div>
    )
  }

  if (reportType === 'aquaculture-fcr-biomass' && data) {
    const period = data.period || {}
    const fcr = data.fcr || {}
    const portfolio = fcr.portfolio || {}
    const loadRows: any[] = Array.isArray(data.load_by_pond) ? data.load_by_pond : []
    const perPond: any[] = Array.isArray(fcr.per_pond) ? fcr.per_pond : []
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'FCR uses feed kg on pond expenses and biomass gain from first-to-last sampling in this range.'
          )}
        {renderAquacultureFcrBlock(data)}
        {perPond.length > 0 ? (
          <div>
            <h4 className="font-semibold text-foreground mb-2">FCR by pond</h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Pond</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Feed kg</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Biomass gain</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Harvest kg</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">FCR biomass</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">FCR harvest</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {perPond.map((p: any) => (
                    <tr key={p.pond_id}>
                      <td className="px-3 py-2 font-medium">{p.pond_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(Number(p.feed_kg ?? 0), 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(Number(p.biomass_gain_kg ?? 0), 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(Number(p.harvest_kg ?? 0), 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-primary">
                        {p.fcr_biomass ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.fcr_harvest ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {loadRows.length > 0 ? (
          <div>
            <h4 className="font-semibold text-foreground mb-2">Pond load (kg per decimal) — as of period end</h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Pond</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Live kg</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Live fish</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">pcs/kg</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">kg/dec</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Load</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Partial harvest hint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {loadRows.map((r: any) => (
                    <tr key={r.pond_id}>
                      <td className="px-3 py-2 font-medium">{r.pond_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(Number(r.implied_net_weight_kg ?? 0), 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(r.implied_net_fish_count ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.current_fish_per_kg ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.stock_density_kg_per_decimal ?? '—'}</td>
                      <td className="px-3 py-2">{r.load_level_label ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-warning-foreground">
                        {r.partial_harvest_applicable && r.partial_harvest_suggested_kg
                          ? `~${formatNumber(Number(r.partial_harvest_suggested_kg), 0)} kg` +
                            (r.partial_harvest_suggested_fish_count
                              ? ` (~${(r.partial_harvest_suggested_fish_count as number).toLocaleString()} fish)`
                              : '')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {data.methodology ? <p className="text-xs text-muted-foreground">{String(data.methodology)}</p> : null}
      </div>
    )
  }

  if (reportType === 'aquaculture-fish-biomass-movements' && data && Array.isArray(data.groups)) {
    const period = data.period || {}
    const groups: any[] = data.groups
    const totals = data.totals || {}
    const summary = data.summary || {}
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            rt('reportMovementsFiltered')
          )}
        {renderAquacultureFcrBlock(data)}
        <p className="text-sm font-medium text-foreground/85">
          Fish biomass movements — stocking, transfers, sales, mortality, and manual adjustments.
        </p>
        {data.accounting_note ? <p className="text-xs text-muted-foreground">{data.accounting_note}</p> : null}
        {groups.map((g: any) => (
          <div key={`fbm-${g.pond_id}`} className="rounded-lg border border-border bg-white shadow-sm">
            <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2 flex flex-wrap justify-between gap-2">
              <h4 className="font-semibold text-cyan-950">{g.pond_name}</h4>
              <span className="text-sm tabular-nums text-cyan-900">
                {Number(g.subtotal_weight_kg_delta ?? 0).toLocaleString()} kg ·{' '}
                {(g.subtotal_fish_count_delta ?? 0).toLocaleString()} fish
              </span>
            </div>
            <div className="overflow-x-auto p-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">Source</th>
                    <th className="px-2 py-1">Species</th>
                    <th className="px-2 py-1 text-right">Δ Fish</th>
                    <th className="px-2 py-1 text-right">Δ kg</th>
                    <th className="px-2 py-1 text-right">Value</th>
                    <th className="px-2 py-1">Memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {(g.lines || []).map((ln: any, idx: number) => (
                    <tr key={`${ln.source}-${ln.source_id}-${idx}`}>
                      <td className="px-2 py-1.5 whitespace-nowrap">{ln.entry_date}</td>
                      <td className="px-2 py-1.5">{ln.source_label || ln.source}</td>
                      <td className="px-2 py-1.5">{ln.fish_species_label || '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.fish_count_delta ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.weight_kg_delta ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {ln.value_amount ? MoneyBdt(ln.value_amount) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{(ln.memo || ln.source_doc || '').slice(0, 60)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
          Total — {summary.movement_count ?? totals.movement_count ?? 0} movement(s)
          <span className="float-right tabular-nums">
            {Number(totals.total_weight_kg_delta ?? 0).toLocaleString()} kg ·{' '}
            {(totals.total_fish_count_delta ?? 0).toLocaleString()} fish
          </span>
        </div>
      </div>
    )
  }

  if (reportType === 'aquaculture-biological-asset-ledger' && data && Array.isArray(data.groups)) {
    const period = data.period || {}
    const groups: any[] = data.groups
    const totals = data.totals || {}
    const summary = data.summary || {}
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            rt('reportMovementsFiltered')
          )}
        {renderAquacultureFcrBlock(data)}
        <p className="text-sm font-medium text-foreground/85">
          Biological asset ledger — accumulated production cost, survivor unit economics, and fish movements.
        </p>
        {data.methodology ? <p className="text-xs text-muted-foreground">{String(data.methodology)}</p> : null}
        {data.as_of_date ? (
          <p className="text-xs text-muted-foreground">Valuation as of {String(data.as_of_date)} (period end).</p>
        ) : null}
        {groups.map((g: any) => {
          const s = g.summary || {}
          return (
            <div key={`bio-${g.pond_id}`} className="rounded-lg border border-border bg-white shadow-sm">
              <div className="border-b border-border/70 bg-accent/80 px-4 py-3">
                <h4 className="font-semibold text-teal-950">{g.pond_name}</h4>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-primary">
                  <span>
                    Bio asset: {MoneyBdt(s.total_biological_asset_value ?? '0')}
                  </span>
                  <span>
                    {s.cost_per_fish ? `${MoneyBdt(s.cost_per_fish)}/fish` : '—/fish'}
                  </span>
                  <span>
                    {s.cost_per_kg ? `${MoneyBdt(s.cost_per_kg)}/kg` : '—/kg'}
                  </span>
                  <span>{(s.live_fish_count ?? 0).toLocaleString()} live fish</span>
                </div>
              </div>
              {(s.cost_buckets || []).length > 0 ? (
                <div className="border-b border-border/70 px-4 py-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Cost buckets</p>
                  <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                    {(s.cost_buckets || []).map((b: any) => (
                      <li key={b.cost_bucket} className="flex justify-between gap-2">
                        <span className="text-foreground/85">{b.label}</span>
                        <span className="tabular-nums font-medium">{MoneyBdt(b.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="overflow-x-auto p-2">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Event</th>
                      <th className="px-2 py-1 text-right">Δ Fish</th>
                      <th className="px-2 py-1 text-right">Δ kg</th>
                      <th className="px-2 py-1 text-right">Cost</th>
                      <th className="px-2 py-1">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {(g.lines || []).map((ln: any, idx: number) => (
                      <tr key={`${ln.entry_date}-${ln.source_doc}-${idx}`}>
                        <td className="px-2 py-1.5 whitespace-nowrap">{ln.entry_date}</td>
                        <td className="px-2 py-1.5">{ln.entry_type_label || ln.entry_type}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{ln.fish_count_delta ?? '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{ln.weight_kg_delta ?? '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {ln.cost_amount
                            ? MoneyBdt(ln.cost_amount)
                            : ln.implied_harvest_cost
                              ? `~${MoneyBdt(ln.implied_harvest_cost)}`
                              : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{(ln.cost_note || ln.memo || '').slice(0, 80)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
        <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
          Total — {summary.pond_count ?? totals.pond_count ?? 0} pond(s)
          <span className="float-right tabular-nums">
            {MoneyBdt(totals.total_biological_asset_value ?? summary.total_biological_asset_value ?? '0')} ·{' '}
            {(totals.total_live_fish_count ?? summary.total_live_fish_count ?? 0).toLocaleString()} live fish
          </span>
        </div>
      </div>
    )
  }

  if (reportType === 'aquaculture-fish-stock-adjustments' && data && Array.isArray(data.groups)) {
    const period = data.period || {}
    const groups: any[] = data.groups
    const totals = data.totals || {}
    const summary = data.summary || {}
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            rt('reportAdjustmentsFiltered')
          )}
        {renderAquacultureFcrBlock(data)}
        <p className="text-sm font-medium text-foreground/85">
          Mortality losses and manual stock adjustments from the fish stock ledger.
        </p>
        {data.accounting_note ? <p className="text-xs text-muted-foreground">{data.accounting_note}</p> : null}
        {groups.map((g: any) => (
          <div key={`fadj-${g.pond_id}`} className="rounded-lg border border-border bg-white shadow-sm">
            <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2 flex flex-wrap justify-between gap-2">
              <h4 className="font-semibold text-cyan-950">{g.pond_name}</h4>
              <span className="text-sm tabular-nums text-cyan-900">
                {Number(g.subtotal_weight_kg_delta ?? 0).toLocaleString()} kg ·{' '}
                {(g.subtotal_fish_count_delta ?? 0).toLocaleString()} fish
              </span>
            </div>
            <div className="overflow-x-auto p-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">Kind</th>
                    <th className="px-2 py-1">Reason</th>
                    <th className="px-2 py-1">Cycle</th>
                    <th className="px-2 py-1">Species</th>
                    <th className="px-2 py-1 text-right">Δ Fish</th>
                    <th className="px-2 py-1 text-right">Δ kg</th>
                    <th className="px-2 py-1 text-right">Book value</th>
                    <th className="px-2 py-1">Memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {(g.lines || []).map((ln: any) => (
                    <tr key={ln.id}>
                      <td className="px-2 py-1.5 whitespace-nowrap">{ln.entry_date}</td>
                      <td className="px-2 py-1.5">{ln.entry_kind_label || ln.entry_kind}</td>
                      <td className="px-2 py-1.5">{ln.loss_reason_label || '—'}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{ln.production_cycle_name || '—'}</td>
                      <td className="px-2 py-1.5">{ln.fish_species_label || '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.fish_count_delta ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.weight_kg_delta ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {ln.book_value && Number(ln.book_value) !== 0 ? MoneyBdt(ln.book_value) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{(ln.memo || '').slice(0, 60)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
          Total — {summary.entry_count ?? totals.entry_count ?? 0} entry(ies)
          {totals.loss_weight_kg_delta ? (
            <span className="ml-2 font-normal text-foreground/85">
              (mortality: {Number(totals.loss_weight_kg_delta).toLocaleString()} kg)
            </span>
          ) : null}
          <span className="float-right tabular-nums">
            {Number(totals.total_weight_kg_delta ?? 0).toLocaleString()} kg ·{' '}
            {(totals.total_fish_count_delta ?? 0).toLocaleString()} fish
          </span>
        </div>
      </div>
    )
  }

  if (reportType === 'aquaculture-fish-stock-breakdown' && data && Array.isArray(data.groups)) {
    const period = data.period || {}
    const groups: any[] = data.groups
    const totals = data.totals || {}
    const asOf = data.as_of_date || period.end_date || ''
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            rt('reportStockBreakdownAsOf')
          )}
        {renderAquacultureFcrBlock(data)}
        <p className="text-sm font-medium text-foreground/85">
          Fish stock by production cycle and species as of <strong>{asOf}</strong>.
        </p>
        {data.accounting_note ? <p className="text-xs text-muted-foreground">{data.accounting_note}</p> : null}
        {groups.map((g: any) => (
          <div key={`fbd-${g.pond_id}`} className="rounded-lg border border-border bg-white shadow-sm">
            <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2 flex flex-wrap justify-between gap-2">
              <h4 className="font-semibold text-cyan-950">{g.pond_name}</h4>
              <span className="text-sm tabular-nums text-cyan-900">
                {Number(g.subtotal_weight_kg ?? 0).toLocaleString()} kg ·{' '}
                {(g.subtotal_fish_count ?? 0).toLocaleString()} fish · {g.line_count ?? 0} bucket(s)
              </span>
            </div>
            <div className="overflow-x-auto p-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1">Cycle</th>
                    <th className="px-2 py-1">Species</th>
                    <th className="px-2 py-1 text-right">Present kg</th>
                    <th className="px-2 py-1 text-right">Present fish</th>
                    <th className="px-2 py-1 text-right">Stocked kg</th>
                    <th className="px-2 py-1 text-right">Sold kg</th>
                    <th className="px-2 py-1 text-right">Mortality kg</th>
                    <th className="px-2 py-1 text-right">Other adj. kg</th>
                    <th className="px-2 py-1 text-right">Pcs/kg</th>
                    <th className="px-2 py-1">Load</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {(g.lines || []).map((ln: any, idx: number) => (
                    <tr key={`${ln.production_cycle_id}-${ln.fish_species}-${idx}`}>
                      <td className="px-2 py-1.5">{ln.production_cycle_name || '—'}</td>
                      <td className="px-2 py-1.5">{ln.fish_species_label || '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{ln.implied_net_weight_kg ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.implied_net_fish_count ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.stocked_weight_kg ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.sale_weight_kg ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.mortality_weight_kg ?? '0'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.other_adjustment_weight_kg ?? '0'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ln.current_fish_per_kg ?? '—'}</td>
                      <td className="px-2 py-1.5">{ln.load_level_label || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
          Total implied weight: {Number(totals.total_implied_weight_kg ?? 0).toLocaleString()} kg · Fish count:{' '}
          {(totals.total_implied_fish_count ?? 0).toLocaleString()} · {totals.bucket_count ?? 0} bucket(s)
        </div>
      </div>
    )
  }

  if (reportType === 'aquaculture-fish-stock-position' && data && Array.isArray(data.groups)) {
    const period = data.period || {}
    const groups: any[] = data.groups
    const totals = data.totals || {}
    const asOf = data.as_of_date || period.end_date || ''
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            rt('reportFishStockAsOf')
          )}
        {renderAquacultureFcrBlock(data)}
        <p className="text-sm font-medium text-foreground/85">
          Fish stock by pond as of <strong>{asOf}</strong> (kg and head count from movements and latest sample).
        </p>
        {data.accounting_note ? (
          <p className="text-xs text-muted-foreground">{data.accounting_note}</p>
        ) : null}
        {groups.map((g: any) => {
          const ln = (g.lines || [])[0] || {}
          return (
            <div key={`fishpos-${g.pond_id}`} className="rounded-lg border border-border bg-white shadow-sm">
              <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2 flex flex-wrap justify-between gap-2">
                <h4 className="font-semibold text-cyan-950">{g.pond_name}</h4>
                <span className="text-sm tabular-nums text-cyan-900">
                  {Number(ln.implied_net_weight_kg ?? 0).toLocaleString()} kg ·{' '}
                  {(ln.implied_net_fish_count ?? 0).toLocaleString()} fish
                </span>
              </div>
              <div className="overflow-x-auto p-2 text-sm">
                <table className="min-w-full">
                  <tbody className="divide-y divide-border/70">
                    <tr>
                      <td className="px-2 py-1 text-muted-foreground" title="Opening stock-in before sale/mortality/other-adjustment: vendor bills + transfer-ins + positive (opening) ledger adjustments.">
                        Stocked (kg / count)
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {ln.stocked_weight_kg ?? ln.vendor_bill_in_weight_kg} /{' '}
                        {ln.stocked_fish_count ?? ln.vendor_bill_in_fish_count ?? '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-muted-foreground">Sales (kg / count)</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {ln.sale_weight_kg} / {ln.sale_fish_count ?? '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-muted-foreground">Mortality (kg / count)</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {ln.mortality_weight_kg ?? '0'} / {ln.mortality_fish_count ?? '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-muted-foreground" title="Transfer-outs and negative manual adjustments. Signed: + adds, − removes.">
                        Other adj. (kg / count)
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {ln.other_adjustment_weight_kg ?? '0'} / {ln.other_adjustment_fish_count ?? '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-muted-foreground">Latest sample</td>
                      <td className="px-2 py-1 text-right">
                        {ln.latest_sample_date
                          ? `${ln.latest_sample_date} · ${ln.latest_sample_fish_species_label || ''}`
                          : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-muted-foreground">Current size (pcs/kg)</td>
                      <td className="px-2 py-1 text-right tabular-nums">{ln.current_fish_per_kg ?? '—'}</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-muted-foreground">Load (kg per decimal)</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {ln.stock_density_kg_per_decimal ?? '—'}
                        {ln.load_level_label ? ` · ${ln.load_level_label}` : ''}
                      </td>
                    </tr>
                    {ln.partial_harvest_applicable && ln.partial_harvest_suggested_kg ? (
                      <tr>
                        <td className="px-2 py-1 text-warning-foreground">Suggested partial harvest</td>
                        <td className="px-2 py-1 text-right text-warning-foreground font-medium">
                          ~{formatNumber(Number(ln.partial_harvest_suggested_kg), 0)} kg
                          {ln.partial_harvest_suggested_fish_count
                            ? ` (~${(ln.partial_harvest_suggested_fish_count as number).toLocaleString()} fish)`
                            : ''}
                        </td>
                      </tr>
                    ) : null}
                    {ln.stocking_advice_message ? (
                      <tr>
                        <td className="px-2 py-1 text-muted-foreground">Stocking note</td>
                        <td className="px-2 py-1 text-right text-foreground/85">{ln.stocking_advice_message}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
        <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
          Total implied weight: {Number(totals.total_implied_weight_kg ?? 0).toLocaleString()} kg · Fish count:{' '}
          {(totals.total_implied_fish_count ?? 0).toLocaleString()}
        </div>
      </div>
    )
  }

  if (reportType === 'aquaculture-shop-station-stock' && data && Array.isArray(data.groups)) {
    const period = data.period || {}
    const groups: any[] = data.groups
    const totals = data.totals || {}
    const asOf = data.as_of_date || period.end_date || ''
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Shop bin quantities as of the report end date; optional site filter applies.'
          )}
        <p className="text-sm font-medium text-foreground/85">
          Station / shop inventory as of <strong>{asOf}</strong> — feed, medicine, fry SKUs, and supplies in{' '}
          <strong>BDT</strong>.
        </p>
        {data.accounting_note ? (
          <p className="text-xs text-muted-foreground">{data.accounting_note}</p>
        ) : null}
        {groups.map((g: any) => (
          <div key={`shop-${g.station_id}`} className="rounded-lg border border-border bg-white shadow-sm">
            <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2">
              <h4 className="font-semibold text-cyan-950">{g.station_name}</h4>
            </div>
            <div className="overflow-x-auto p-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1">Item</th>
                    <th className="px-2 py-1">Type</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1">Unit</th>
                    <th className="px-2 py-1 text-right">Value (BDT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {(g.lines || []).map((ln: any) => (
                    <tr key={`${g.station_id}-${ln.item_id}`}>
                      <td className="px-2 py-1.5 font-medium">{ln.item_name}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{ln.stock_kind_label || ln.stock_kind}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{Number(ln.quantity).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{ln.unit}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.extended_value)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40">
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                      Sub-total — {g.station_name}
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-foreground">
                      {MoneyBdt(g.subtotal_value)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}
        <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
          Total value: {MoneyBdt(totals.total_value)}
        </div>
      </div>
    )
  }

  if (reportType === 'aquaculture-production-cycles' && data) {
    const period = data.period || {}
    const groups: any[] = Array.isArray(data.groups) ? data.groups : []
    const totals = data.totals || {}
    return (
      <div className="space-y-8">
        {hasPeriod &&
          renderPeriodFilter(
            period,
            dateRange,
            reportType,
            handleReportDateChange,
            'Cycles that overlap the selected date range (by start / end dates).'
          )}
        <p className="text-sm font-medium text-foreground/85">
          Production batches — amounts are informational; money columns are <strong>BDT</strong> elsewhere.
        </p>
        {groups.map((g: any) => (
          <div key={`cyc-${g.pond_id}`} className="rounded-lg border border-border bg-white shadow-sm">
            <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2">
              <h4 className="font-semibold text-cyan-950">{g.pond_name}</h4>
            </div>
            <div className="overflow-x-auto p-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Start</th>
                    <th className="px-2 py-1">End</th>
                    <th className="px-2 py-1">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {(g.lines || []).map((ln: any) => (
                    <tr key={ln.id}>
                      <td className="px-2 py-1.5 font-medium">{ln.name}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{ln.start_date}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{ln.end_date || '—'}</td>
                      <td className="px-2 py-1.5">{ln.is_active ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40">
                  <tr>
                    <td colSpan={3} className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                      Sub-total — cycles in this pond
                    </td>
                    <td className="px-2 py-2 text-xs font-bold text-foreground">{g.subtotal_cycles}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}
        <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 text-sm font-bold text-foreground">
          Total — cycles listed: {totals.cycle_count ?? 0}
        </div>
      </div>
    )
  }

  return (
    <ReportStructuredFallback
      reportType={reportType}
      data={(data && typeof data === 'object' ? data : {}) as Record<string, unknown>}
      drillScope={reportDrillScope()}
    />
  )
}
