'use client'

import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { useCompany } from '@/contexts/CompanyContext'
import { 
  FileText, TrendingUp, DollarSign, Users, Package, 
  BarChart3, Calendar, Download, Filter, RefreshCw, Printer,
  Gauge, Droplet,   ClipboardList, Layers, ShoppingCart, MapPin, Fish,
  Scale, Landmark, Banknote, BookOpen, CreditCard,
} from 'lucide-react'
import { canViewInventorySkuReport } from '@/utils/rbac'
import api from '@/lib/api'
import { formatDate, formatDateOnly, formatDateRange, localDateISO, toDateInputValue } from '@/utils/date'
import { formatAmountPlain, formatCurrency, formatNumber } from '@/utils/formatting'
import { escapeHtml, printDocument } from '@/utils/printDocument'
import type { PrintBranding } from '@/utils/printBranding'
import { loadPrintBranding } from '@/utils/printBranding'
import { FinancialAnalyticsPanel } from './analytics/FinancialAnalyticsPanel'

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

type ReportType = 
  | 'trial-balance'
  | 'balance-sheet'
  | 'income-statement'
  | 'customer-balances'
  | 'vendor-balances'
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
  | 'aquaculture-expenses'
  | 'aquaculture-sampling'
  | 'aquaculture-production-cycles'
  | 'aquaculture-profit-transfers'

const ITEM_SCOPED_REPORT_IDS: readonly ReportType[] = [
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
  icon: React.ElementType
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
    description: 'Assets, Liabilities, and Equity',
    icon: FileText,
    category: 'financial'
  },
  {
    id: 'income-statement',
    title: 'Profit & Loss (P&L)',
    description: 'Income, COGS, and expenses from posted journals — optional site filter',
    icon: TrendingUp,
    category: 'financial'
  },
  {
    id: 'customer-balances',
    title: 'Customer Balances',
    description: 'Accounts Receivable aging',
    icon: Users,
    category: 'financial'
  },
  {
    id: 'vendor-balances',
    title: 'Vendor Balances',
    description: 'Accounts Payable summary',
    icon: Users,
    category: 'financial'
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
    description: 'Complete daily operations overview',
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
      'Charts and comparisons for sales, COGS, expenses, purchases, and net income — same workspace as the dedicated analytics view.',
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

  // Aquaculture (BDT; pond sub-totals and company totals on each report)
  {
    id: 'aquaculture-pond-pl',
    title: 'Aquaculture — Pond P&L',
    description: 'Pond-wise revenue, operating costs, payroll allocation, and net profit for the period',
    icon: Fish,
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
    id: 'aquaculture-expenses',
    title: 'Aquaculture — Expense register',
    description: 'Operating expenses by pond and shared allocations with sub-totals (BDT)',
    icon: Fish,
    category: 'aquaculture',
  },
  {
    id: 'aquaculture-sampling',
    title: 'Aquaculture — Biomass sampling',
    description: 'Sample history by pond with sub-totals for the period',
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
]

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

/** Mix — Fuel & Aquaculture tab: fixed shortlist (same order as sidebar). */
const MIX_FUEL_AQUACULTURE_REPORT_IDS: readonly ReportType[] = [
  'trial-balance',
  'balance-sheet',
  'income-statement',
  'customer-balances',
  'vendor-balances',
  'daily-summary',
] as const

/** Reports that accept optional `station_id` (all sites when empty; home-station users are always scoped in API). */
const REPORTS_STATION_SCOPED = new Set<ReportType>([
  'trial-balance',
  'income-statement',
  'liabilities-detail',
  'loan-receivable-gl',
  'loan-payable-gl',
  'loans-borrow-and-lent',
  'fuel-sales',
  'tank-inventory',
  'shift-summary',
  'daily-summary',
  'sales-by-station',
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
])

/** Subset of station-scoped reports where amounts come from posted GL lines (not invoice subledgers). */
const REPORTS_GL_STATION_SCOPED = new Set<ReportType>([
  'trial-balance',
  'income-statement',
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
  'daily-summary',
  'shift-summary',
  'sales-by-nozzle',
  'sales-by-station',
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
  'aquaculture-expenses',
  'aquaculture-sampling',
  'aquaculture-production-cycles',
  'aquaculture-profit-transfers',
])

/** In-report + export label for which site(s) a station-scoped report covers. */
function getReportSiteScopeDisplay(
  reportId: ReportType | null,
  reportData: { filter_station_id?: number } | null | undefined,
  stations: { id: number; station_name: string }[],
  userHasHomeStation: boolean,
  homeStationId: number | null,
  homeStationName: string | null,
  reportStationId: string
): { headline: string; detail: string } | null {
  if (!reportId || !REPORTS_STATION_SCOPED.has(reportId)) return null
  const gl = REPORTS_GL_STATION_SCOPED.has(reportId)
  const rawFid = reportData && typeof reportData === 'object' && 'filter_station_id' in reportData
    ? (reportData as { filter_station_id?: unknown }).filter_station_id
    : undefined
  const fid = typeof rawFid === 'number' && rawFid > 0 ? rawFid : undefined
  if (fid != null) {
    const name = stations.find((s) => s.id === fid)?.station_name?.trim() || `Station #${fid}`
    return {
      headline: `Site: ${name}`,
      detail: gl
        ? 'Trial balance and P&L use posted journal lines tagged to this site. Entries without a site tag are excluded.'
        : 'Figures in this run are for this site only.',
    }
  }
  if (userHasHomeStation) {
    const name =
      (homeStationName && homeStationName.trim()) ||
      (homeStationId != null ? stations.find((s) => s.id === homeStationId)?.station_name?.trim() : undefined) ||
      (homeStationId != null ? `Station #${homeStationId}` : 'Assigned site')
    return {
      headline: `Site: ${name}`,
      detail: gl
        ? 'Your account is limited to this site; GL figures are for this location only.'
        : 'Your account is limited to this site for these reports.',
    }
  }
  if (reportStationId && /^\d+$/.test(reportStationId)) {
    const id = parseInt(reportStationId, 10)
    const name = stations.find((s) => s.id === id)?.station_name?.trim() || `Station #${id}`
    return {
      headline: `Site: ${name}`,
      detail: gl
        ? 'Using the site selected above. Only posted GL lines for that site are included.'
        : 'Using the site selected in the filter above.',
    }
  }
  return {
    headline: 'All sites',
    detail: gl
      ? 'All posted journal lines in the date range (every site). Pick a site above to see that location’s GL activity only.'
      : 'This run includes every station. Use the site filter to narrow to one location.',
  }
}

export default function ReportsPage() {
  const router = useRouter()
  const { selectedCompany } = useCompany()
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
    startDate: localDateISO(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    endDate: localDateISO(),
  })
  const [filterCategory, setFilterCategory] = useState<
    'all' | 'mix' | 'financial' | 'operational' | 'analytical' | 'inventory' | 'aquaculture'
  >('all')

  const [aquaculturePondId, setAquaculturePondId] = useState('')
  const [aquacultureCycleId, setAquacultureCycleId] = useState('')
  const [aquacultureIncludeCycleBreakdown, setAquacultureIncludeCycleBreakdown] = useState(false)
  const [aquaculturePonds, setAquaculturePonds] = useState<{ id: number; name: string }[]>([])
  const [aquacultureCycles, setAquacultureCycles] = useState<{ id: number; name: string }[]>([])

  /** Shared filters for item-scoped reports (category + multi-select products). */
  const [itemScopeCategory, setItemScopeCategory] = useState('')
  const [itemScopeItemIds, setItemScopeItemIds] = useState<number[]>([])
  const [itemScopeItemOptions, setItemScopeItemOptions] = useState<
    { id: number; name: string; item_number?: string; category?: string }[]
  >([])
  const [itemFilterCategoryList, setItemFilterCategoryList] = useState<string[]>([])
  const [reportStationList, setReportStationList] = useState<{ id: number; station_name: string }[]>([])
  const [reportStationId, setReportStationId] = useState('')
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
        const d = res.data as { name?: string; company_name?: string }
        const label = [d.name, d.company_name]
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .find((s) => s.length > 0)
        if (label) setReportCompanyLabel(label)
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
        if (r === 'operator') {
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
      .get<{ id: number; station_name: string }[]>('/stations/')
      .then((res) => {
        if (cancelled) return
        const rows = Array.isArray(res.data) ? res.data : []
        const mapped = rows.map((s) => ({
          id: s.id,
          station_name: s.station_name || `Station ${s.id}`,
        }))
        setReportStationList(mapped)
        const saved = localStorage.getItem('fserp_report_station_id')?.trim() || ''
        if (saved && /^\d+$/.test(saved)) {
          const sid = Number(saved)
          if (!mapped.some((s) => s.id === sid)) {
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
    if (saved && /^\d+$/.test(saved)) setReportStationId(saved)
    else setReportStationId('')
  }, [selectedCompany?.id])

  useEffect(() => {
    let cancelled = false
    api
      .get<{ id: number; name: string }[]>('/aquaculture/ponds/')
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
  }, [selectedCompany?.id])

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

  const persistReportStation = useCallback((id: string) => {
    setReportStationId(id)
    try {
      if (id && /^\d+$/.test(id)) {
        localStorage.setItem('fserp_report_station_id', id)
      } else {
        localStorage.removeItem('fserp_report_station_id')
      }
    } catch {
      /* ignore */
    }
  }, [])

  const reportSiteScope = useMemo(
    () =>
      getReportSiteScopeDisplay(
        selectedReport,
        reportData,
        reportStationList,
        userHasHomeStation,
        homeStationMeta.id,
        homeStationMeta.name,
        reportStationId
      ),
    [selectedReport, reportData, reportStationList, userHasHomeStation, homeStationMeta, reportStationId]
  )
  
  // Filter reports based on user role and category
  const getFilteredReports = () => {
    let roleFilteredReports = reports
    
    // First filter by role
    if (userRole === 'cashier') {
      // Cashiers see only: Sales and Stock reports
      roleFilteredReports = reports.filter(report => 
        report.id === 'fuel-sales' ||
        report.id === 'sales-by-nozzle' ||
        report.id === 'sales-by-station' ||
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
    return roleFilteredReports.filter((r) => r.category === filterCategory)
  }
  
  const filteredReports = getFilteredReports()

  const fetchReport = useCallback(async (reportId: ReportType) => {
    setLoading(true)
    setReportData(null) // Clear previous data

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

    const params: Record<string, string> = {}
    if (REPORTS_WITH_PERIOD.has(reportId)) {
      params.start_date = dateRange.startDate
      params.end_date = dateRange.endDate
    }
    if (
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
      if (aquaculturePondId && /^\d+$/.test(aquaculturePondId)) {
        params.pond_id = aquaculturePondId
      }
      if (reportId === 'aquaculture-pond-pl') {
        if (aquacultureCycleId && /^\d+$/.test(aquacultureCycleId)) {
          params.cycle_id = aquacultureCycleId
        }
        if (aquacultureIncludeCycleBreakdown) {
          params.include_cycle_breakdown = 'true'
        }
      }
    }

    if (REPORTS_STATION_SCOPED.has(reportId)) {
      let homeId: number | null = null
      try {
        const u = JSON.parse(localStorage.getItem('user') || '{}') as { home_station_id?: unknown }
        if (u?.home_station_id != null && String(u.home_station_id).trim() !== '') {
          homeId = Number(u.home_station_id)
        }
      } catch {
        /* ignore */
      }
      if (homeId == null && reportStationId && /^\d+$/.test(reportStationId)) {
        params.station_id = reportStationId
      }
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
      if (!token) {
        alert('Your session has expired. Please log in again.')
        router.push('/login')
        return
      }

      const response = await api.get(`/reports/${reportId}`, { params })

      // Ensure we have valid data structure
      if (response.data) {
        setReportData(response.data)
        setSelectedReport(reportId)
      } else {
        throw new Error('Invalid response data')
      }
    } catch (error: any) {
      console.error('Error fetching report:', error)

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
                const retry = await api.get(`/reports/${reportId}`, { params })
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
      
      const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to load report. Please try again.'
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
  ])

  const onReportStationSelectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value
      persistReportStation(v)
      if (selectedReport && REPORTS_STATION_SCOPED.has(selectedReport)) {
        void fetchReport(selectedReport)
      }
    },
    [persistReportStation, selectedReport, fetchReport]
  )
  
  // Debounced date change handler for all period-based reports
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const handleReportDateChange = useCallback((field: 'startDate' | 'endDate', value: string, reportId?: ReportType) => {
    // All reports now use date range
    const targetReportId = reportId || selectedReport
    
    const newDateRange = {
      startDate: field === 'startDate' ? value : dateRange.startDate,
      endDate: field === 'endDate' ? value : dateRange.endDate
    }
    
    // Update state immediately for UI responsiveness
    setDateRange(newDateRange)
    
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    
    // Re-fetch report after a short delay to avoid too many requests
    debounceTimerRef.current = setTimeout(() => {
      if (targetReportId && selectedReport === targetReportId) {
        fetchReport(targetReportId)
      }
    }, 500)
  }, [dateRange, fetchReport, selectedReport])

  const printReport = () => {
    if (!reportData || !selectedReport) return

    const reportTitle = reports.find(r => r.id === selectedReport)?.title || selectedReport
    const siteScopeForPrint = getReportSiteScopeDisplay(
      selectedReport,
      reportData,
      reportStationList,
      userHasHomeStation,
      homeStationMeta.id,
      homeStationMeta.name,
      reportStationId
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
    } else if (selectedReport === 'daily-summary' && reportData.sales) {
      const s = reportData.sales || {}
      const sh = reportData.shifts || {}
      const dp = reportData.dips || {}
      contentHTML += '<h2>Summary</h2><table><tbody>'
      contentHTML += `<tr><td><strong>Total transactions</strong></td><td>${s.total_transactions ?? 0}</td></tr>`
      contentHTML += `<tr><td><strong>Total liters</strong></td><td>${formatNumber(Number(s.total_liters ?? 0))}</td></tr>`
      contentHTML += `<tr><td><strong>Total amount</strong></td><td>${formatCurrency(s.total_amount)}</td></tr>`
      contentHTML += `<tr><td><strong>Average sale</strong></td><td>${formatCurrency(s.average_sale)}</td></tr>`
      contentHTML += `<tr><td><strong>Total shifts</strong></td><td>${sh.total_shifts ?? 0}</td></tr>`
      contentHTML += `<tr><td><strong>Total cash variance</strong></td><td>${formatCurrency(sh.total_cash_variance)}</td></tr>`
      contentHTML += `<tr><td><strong>Dip readings</strong></td><td>${dp.total_readings ?? 0}</td></tr>`
      contentHTML += `<tr><td><strong>Net dip variance (L)</strong></td><td>${formatNumber(Number(dp.net_variance ?? 0))}</td></tr>`
      contentHTML += '</tbody></table>'
      const bp = s.by_product || {}
      const keys = Object.keys(bp)
      if (keys.length > 0) {
        contentHTML +=
          '<h2>Sales by product</h2><table><thead><tr><th>Product</th><th style="text-align:right">Lines</th><th style="text-align:right">Liters</th><th style="text-align:right">Amount</th></tr></thead><tbody>'
        keys.forEach((k) => {
          const m = bp[k] as { line_count?: number; liters?: number; amount?: number }
          contentHTML += `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${m.line_count ?? 0}</td><td style="text-align:right">${formatNumber(Number(m.liters ?? 0))}</td><td style="text-align:right">${formatCurrency(m.amount ?? 0)}</td></tr>`
        })
        contentHTML += '</tbody></table>'
      }
      const tanks = Array.isArray(reportData.tanks) ? reportData.tanks : []
      if (tanks.length > 0) {
        contentHTML +=
          '<h2>Tank status</h2><table><thead><tr><th>Tank</th><th>Product</th><th style="text-align:right">Capacity</th><th style="text-align:right">Stock</th><th style="text-align:right">Fill %</th></tr></thead><tbody>'
        tanks.forEach((tank: any) => {
          contentHTML += `<tr><td>${escapeHtml(String(tank.tank_name ?? ''))}</td><td>${escapeHtml(String(tank.product ?? ''))}</td><td style="text-align:right">${Number(tank.capacity ?? 0).toLocaleString()}</td><td style="text-align:right">${Number(tank.current_stock ?? 0).toLocaleString()}</td><td style="text-align:right">${formatNumber(Number(tank.fill_percentage ?? 0))}%</td></tr>`
        })
        contentHTML += '</tbody></table>'
      }
    } else if (selectedReport === 'fuel-sales' && reportData) {
      contentHTML += '<h2>Fuel sales (invoice fuel lines)</h2><table><tbody>'
      contentHTML += `<tr><td><strong>Fuel line count</strong></td><td>${reportData.total_sales ?? 0}</td></tr>`
      contentHTML += `<tr><td><strong>Invoices with fuel</strong></td><td>${reportData.invoice_count ?? 0}</td></tr>`
      contentHTML += `<tr><td><strong>Total liters</strong></td><td>${formatNumber(Number(reportData.total_quantity_liters ?? 0))}</td></tr>`
      contentHTML += `<tr><td><strong>Total amount</strong></td><td>${formatCurrency(reportData.total_amount)}</td></tr>`
      contentHTML += `<tr><td><strong>Average per fuel line</strong></td><td>${formatCurrency(reportData.average_sale_amount)}</td></tr>`
      contentHTML += '</tbody></table>'
    } else {
      contentHTML += '<p>Report data not available for printing in this format.</p>'
    }

    const periodLine =
      reportData.period &&
      typeof reportData.period.start_date === 'string' &&
      typeof reportData.period.end_date === 'string'
        ? `<strong>Period:</strong> ${escapeHtml(reportData.period.start_date)} to ${escapeHtml(reportData.period.end_date)}`
        : ''
    const siteScopeLine = siteScopeForPrint
      ? `${escapeHtml(siteScopeForPrint.headline)} — ${escapeHtml(siteScopeForPrint.detail)}`
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
    
    const reportTitle = reports.find(r => r.id === selectedReport)?.title || selectedReport
    const fileName = `${reportTitle.replace(/\s+/g, '_')}_${dateRange.endDate}`
    
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
      const siteScopeCsv = getReportSiteScopeDisplay(
        selectedReport,
        reportData,
        reportStationList,
        userHasHomeStation,
        homeStationMeta.id,
        homeStationMeta.name,
        reportStationId
      )
      if (siteScopeCsv) {
        csvContent += `Site scope: ${siteScopeCsv.headline} — ${siteScopeCsv.detail}\n`
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
        csvContent += 'Metric,Value\n'
        if (reportData.sales) {
          csvContent += `Total Transactions,${reportData.sales.total_transactions || 0}\n`
          csvContent += `Total Liters,${reportData.sales.total_liters || 0}\n`
          csvContent += `Total Amount,${reportData.sales.total_amount || 0}\n`
          csvContent += `Average Sale,${reportData.sales.average_sale || 0}\n`
        }
        if (reportData.shifts) {
          csvContent += `Total Shifts,${reportData.shifts.total_shifts || 0}\n`
          csvContent += `Cash Variance,${reportData.shifts.total_cash_variance || 0}\n`
        }
        if (reportData.dips) {
          csvContent += `Total Dip Readings,${reportData.dips.total_readings || 0}\n`
          csvContent += `Net Dip Variance,${reportData.dips.net_variance || 0}\n`
        }
      } else if (selectedReport === 'fuel-sales') {
        csvContent += 'Metric,Value\n'
        csvContent += `Fuel line count,${reportData.total_sales ?? 0}\n`
        csvContent += `Invoices with fuel,${reportData.invoice_count ?? 0}\n`
        csvContent += `Total liters,${reportData.total_quantity_liters ?? 0}\n`
        csvContent += `Total amount,${reportData.total_amount ?? 0}\n`
        csvContent += `Average per fuel line,${reportData.average_sale_amount ?? 0}\n`
      } else if (String(selectedReport).startsWith('aquaculture-')) {
        csvContent += 'Aquaculture report (BDT). See JSON export for full nested structure.\n'
        if (reportData.summary && typeof reportData.summary === 'object') {
          Object.entries(reportData.summary as Record<string, unknown>).forEach(([k, v]) => {
            csvContent += `${k},${v}\n`
          })
        }
        if (selectedReport === 'aquaculture-pond-pl' && Array.isArray(reportData.ponds)) {
          csvContent += '\nPond,Revenue,Direct exp,Shared exp,Payroll,Total costs,Profit\n'
          ;(reportData.ponds as any[]).forEach((p: any) => {
            csvContent += [
              escapeCsv(p.pond_name),
              p.revenue,
              p.direct_operating_expenses,
              p.shared_operating_expenses,
              p.payroll_allocated,
              p.total_costs,
              p.profit,
            ].join(',')
            csvContent += '\n'
          })
          const tt = reportData.totals || {}
          csvContent += `Total,,,,,${tt.total_costs ?? ''},${tt.profit ?? ''}\n`
        }
        if (Array.isArray(reportData.groups)) {
          csvContent += '\nPond group,Field,Value\n'
          ;(reportData.groups as any[]).forEach((g: any) => {
            csvContent += `${escapeCsv(g.pond_name)},subtotal_amount,${g.subtotal_amount ?? g.subtotal_samples ?? ''}\n`
            ;(g.lines || []).forEach((ln: any) => {
              csvContent += `${escapeCsv(g.pond_name)},line,${JSON.stringify(ln)}\n`
            })
          })
        }
      } else {
        // Fallback to JSON if CSV not supported
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
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto app-scroll-pad">
        <div className="space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
            <p className="text-gray-600 mt-1">Generate comprehensive business and operational reports</p>
          </div>

          {/* Category Filters - Hide for cashiers */}
          {userRole !== 'cashier' && (
            <div className="flex items-center space-x-2 bg-gray-100 p-2 rounded-lg w-fit">
              <button
                onClick={() => setFilterCategory('all')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filterCategory === 'all'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                All Reports
              </button>
              <button
                onClick={() => setFilterCategory('mix')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filterCategory === 'mix'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Mix — Fuel & Aquaculture
              </button>
              <button
                onClick={() => setFilterCategory('financial')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filterCategory === 'financial' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Financial
              </button>
              <button
                onClick={() => setFilterCategory('operational')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filterCategory === 'operational' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Operational
              </button>
              <button
                onClick={() => setFilterCategory('inventory')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filterCategory === 'inventory' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Inventory
              </button>
              <button
                onClick={() => setFilterCategory('analytical')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filterCategory === 'analytical' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Analytical
              </button>
              <button
                onClick={() => setFilterCategory('aquaculture')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filterCategory === 'aquaculture'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Aquaculture
              </button>
            </div>
          )}

          {userRole != null &&
            userRole !== 'operator' &&
            reportStationList.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2 text-sm text-slate-600">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-medium text-slate-800">Site scope (operations, inventory, and GL)</p>
                    {userHasHomeStation ? (
                      <p className="text-slate-500">Your login is limited to your assigned site; totals match that location.</p>
                    ) : (
                      <p className="text-slate-500">
                        <strong>All</strong> includes every station. Pick a site to filter shift, fuel, tank, inventory,
                        trial balance, and P&amp;L (posted lines tagged to that site).
                      </p>
                    )}
                  </div>
                </div>
                {userHasHomeStation ? null : (
                  <div className="flex flex-col gap-1 sm:items-end">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-slate-700" htmlFor="report-station-scope">
                        Site
                      </label>
                      <select
                        id="report-station-scope"
                        aria-label="Filter reports by site or all sites"
                        value={reportStationId}
                        onChange={onReportStationSelectChange}
                        className="min-w-[16rem] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      >
                        <option value="">All</option>
                        {reportStationList.map((s) => (
                          <option key={s.id} value={String(s.id)}>
                            {s.station_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-xs text-slate-500 sm:text-right">
                      Applies when you run a site-scoped report (saved for this browser)
                    </p>
                  </div>
                )}
              </div>
            )}

          <div className="flex min-h-0 w-full min-w-0 flex-col gap-6 lg:flex-row lg:items-start lg:gap-6 xl:gap-8">
            {/* Report list: fixed max width; main pane uses flex-1 for full usable width (especially for Analytics) */}
            <aside className="w-full min-w-0 shrink-0 space-y-3 lg:max-w-[20rem] xl:max-w-[22rem]">
              {filteredReports.map((report) => {
                const Icon = report.icon
                return (
                  <button
                    key={report.id}
                    onClick={() => fetchReport(report.id)}
                    disabled={loading}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      selectedReport === report.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
                    } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-start space-x-3">
                      <div className={`p-2 rounded-lg ${
                        selectedReport === report.id ? 'bg-blue-100' : 'bg-gray-100'
                      }`}>
                        <Icon className={`h-5 w-5 ${
                          selectedReport === report.id ? 'text-blue-600' : 'text-gray-600'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900">{report.title}</h3>
                        <p className="text-sm text-gray-500 mt-1">{report.description}</p>
                        <span className={`inline-block mt-2 text-xs px-2 py-1 rounded-full ${
                          report.category === 'financial' ? 'bg-green-100 text-green-700' :
                          report.category === 'operational' ? 'bg-blue-100 text-blue-700' :
                          report.category === 'inventory' ? 'bg-amber-100 text-amber-800' :
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
            <div className="min-h-0 w-full min-w-0 flex-1">
              <div className="min-h-[600px] w-full min-w-0 max-w-full rounded-lg border border-gray-200 bg-white">
                {loading ? (
                  <div className="flex h-[600px] items-center justify-center">
                    <div className="text-center">
                      <RefreshCw className="mx-auto mb-4 h-12 w-12 animate-spin text-blue-500" />
                      <p className="text-gray-600">Loading report...</p>
                    </div>
                  </div>
                ) : selectedReport === 'analytics-kpi' && reportData && '_analytics' in reportData && reportData._analytics ? (
                  <div className="w-full min-w-0 p-0">
                    <FinancialAnalyticsPanel embedInReports reportStationKey={reportStationId} />
                  </div>
                ) : selectedReport && reportData ? (
                  <div className="p-6">
                    {/* Report Header */}
                    <div className="flex items-center justify-between mb-6 pb-4 border-b">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {reports.find(r => r.id === selectedReport)?.title}
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Generated on {formatDate(new Date())}
                    </p>
                    {selectedReport && REPORTS_STATION_SCOPED.has(selectedReport) && reportStationList.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                        <MapPin className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                        {userHasHomeStation ? (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium text-gray-800">Site (fixed):</span>{' '}
                            {homeStationMeta.name?.trim() ||
                              reportStationList.find((s) => s.id === homeStationMeta.id)?.station_name ||
                              (homeStationMeta.id != null ? `Station #${homeStationMeta.id}` : 'Your assigned site')}
                          </p>
                        ) : (
                          <>
                            <label className="text-sm font-medium text-gray-700" htmlFor="report-station-preview">
                              Site
                            </label>
                            <select
                              id="report-station-preview"
                              aria-label="Filter this report by site or All"
                              value={reportStationId}
                              onChange={onReportStationSelectChange}
                              className="min-w-[16rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                            >
                              <option value="">All</option>
                              {reportStationList.map((s) => (
                                <option key={s.id} value={String(s.id)}>
                                  {s.station_name}
                                </option>
                              ))}
                            </select>
                            <span className="text-xs text-gray-500">
                              {selectedReport === 'trial-balance' || selectedReport === 'income-statement'
                                ? 'All = every posted line; one site = only GL lines tagged to that location'
                                : 'All = company-wide for this report type'}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={printReport}
                      className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      title="Print Report"
                    >
                      <Printer className="h-4 w-4" />
                      <span>Print</span>
                    </button>
                    <button
                      onClick={() => downloadReport('json')}
                      className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                      title="Export as JSON"
                    >
                      <Download className="h-4 w-4" />
                      <span>JSON</span>
                    </button>
                    <button
                      onClick={() => downloadReport('csv')}
                      className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      title="Export as CSV"
                    >
                      <Download className="h-4 w-4" />
                      <span>CSV</span>
                    </button>
                  </div>
                    </div>

                    {reportSiteScope && (
                      <div className="mb-6 flex gap-3 rounded-lg border border-amber-200/90 bg-amber-50/95 px-4 py-3 text-sm text-amber-950 shadow-sm dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                        <div>
                          <p className="font-semibold text-amber-950 dark:text-amber-50">{reportSiteScope.headline}</p>
                          <p className="mt-0.5 text-amber-900/90 dark:text-amber-200/90">{reportSiteScope.detail}</p>
                        </div>
                      </div>
                    )}

                    {selectedReport &&
                      String(selectedReport).startsWith('aquaculture-') &&
                      userRole !== 'cashier' && (
                        <div className="mb-6 rounded-lg border border-cyan-200 bg-cyan-50/90 px-4 py-3 text-sm text-cyan-950 shadow-sm">
                          <p className="font-semibold text-cyan-900">Aquaculture filters</p>
                          <p className="mt-1 text-cyan-800/90">
                            All amounts in this section are shown in <strong>BDT</strong>. Use Refresh after changing
                            filters.
                          </p>
                          <div className="mt-3 flex flex-wrap items-end gap-3">
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-medium text-cyan-900" htmlFor="aq-report-pond">
                                Pond (optional)
                              </label>
                              <select
                                id="aq-report-pond"
                                value={aquaculturePondId}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setAquaculturePondId(v)
                                  setAquacultureCycleId('')
                                }}
                                className="min-w-[12rem] rounded-md border border-cyan-300 bg-white px-2 py-1.5 text-sm"
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
                                    disabled={!aquaculturePondId}
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
                          <h3 className="text-lg font-semibold text-gray-900 mb-3">Summary</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {Object.entries(reportData.summary as Record<string, unknown>).map(([key, value], idx) => {
                              const summaryEntryKey = `${idx}-${key}`
                              const colorClasses = [
                                'from-blue-50 to-blue-100 border-blue-200 text-blue-600',
                                'from-green-50 to-green-100 border-green-200 text-green-600',
                                'from-purple-50 to-purple-100 border-purple-200 text-purple-600',
                                'from-indigo-50 to-indigo-100 border-indigo-200 text-indigo-600',
                                'from-pink-50 to-pink-100 border-pink-200 text-pink-600',
                                'from-yellow-50 to-yellow-100 border-yellow-200 text-yellow-600'
                              ]
                              const colorClass = colorClasses[idx % colorClasses.length]
                              const iconColors = [
                                'bg-blue-200 text-blue-600',
                                'bg-green-200 text-green-600',
                                'bg-purple-200 text-purple-600',
                                'bg-indigo-200 text-indigo-600',
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
                          : undefined
                      )}

                      {/* Alerts */}
                      {reportData.alerts && reportData.alerts.low_stock_tanks && reportData.alerts.low_stock_tanks.length > 0 && (
                        <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                          <h4 className="font-semibold text-red-800 mb-2">⚠️ Low Stock Alerts</h4>
                          <ul className="space-y-1">
                            {reportData.alerts.low_stock_tanks.map((tank: any, idx: number) => (
                              <li key={idx} className="text-sm text-red-700">
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
                      <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-500 text-lg">Select a report to view</p>
                      <p className="text-gray-400 text-sm mt-2">
                        Choose from the report cards on the left
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper function to render editable period filter (for date range reports)
function renderPeriodFilter(
  period: { start_date?: string; end_date?: string },
  dateRange?: { startDate: string; endDate: string },
  reportType?: ReportType,
  onDateChange?: (field: 'startDate' | 'endDate', value: string, reportId?: ReportType) => void,
  description?: string
) {
  const currentStartDate = period?.start_date
    ? toDateInputValue(period.start_date)
    : (dateRange?.startDate || '')
  const currentEndDate = period?.end_date
    ? toDateInputValue(period.end_date)
    : (dateRange?.endDate || '')
  
  const defaultDescription = "Data is filtered by this date range."
  const displayDescription = description || defaultDescription
  
  if (!currentStartDate && !currentEndDate) {
    return null
  }
  
  return (
    <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center space-x-3 flex-wrap">
          <label className="text-sm font-medium text-blue-800 whitespace-nowrap">
            Report Period:
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="date"
              value={currentStartDate}
              onChange={(e) => onDateChange?.('startDate', e.target.value, reportType)}
              max={currentEndDate}
              className="px-3 py-1.5 border border-blue-300 rounded-md text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm"
            />
            <span className="text-sm text-blue-600 font-medium">to</span>
            <input
              type="date"
              value={currentEndDate}
              onChange={(e) => onDateChange?.('endDate', e.target.value, reportType)}
              min={currentStartDate}
              max={localDateISO()}
              className="px-3 py-1.5 border border-blue-300 rounded-md text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm"
            />
          </div>
        </div>
        <p className="text-xs text-blue-600 mt-2 md:mt-0">
          {displayDescription}
        </p>
      </div>
    </div>
  )
}

// Helper function to render editable single date filter (for single-date reports)
function renderDateFilter(
  date: string | undefined,
  dateRange?: { startDate: string; endDate: string },
  reportType?: ReportType,
  onDateChange?: (field: 'startDate' | 'endDate', value: string, reportId?: ReportType) => void,
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
    <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center space-x-3 flex-wrap">
          <label className="text-sm font-medium text-blue-800 whitespace-nowrap">
            {displayLabel}
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="date"
              value={currentDate}
              onChange={(e) => onDateChange?.('endDate', e.target.value, reportType)}
              max={localDateISO()}
              className="px-3 py-1.5 border border-blue-300 rounded-md text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm"
            />
          </div>
        </div>
        <p className="text-xs text-blue-600 mt-2 md:mt-0">
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
    return <span className="text-xs text-gray-300">—</span>
  }
  return (
    <Link
      href={`/chart-of-accounts?ledger=${accountId}`}
      className="inline-flex rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600"
      title={`${label} — GL ledger`}
      aria-label={`${label} — open general ledger`}
    >
      <BookOpen className="h-4 w-4 shrink-0" />
    </Link>
  )
}

function LoanFacilitiesTable({ rows, tone }: { rows: any[]; tone: 'borrowed' | 'lent' }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Loan</th>
            <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Party</th>
            <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Outstanding</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Period disb.</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Period pmt</th>
            <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500" colSpan={4}>
              GL ledgers
            </th>
          </tr>
          <tr className="border-t border-gray-100 bg-gray-50/80">
            <th colSpan={6} />
            <th className="px-1 py-2 text-center text-[10px] font-normal text-gray-500">Principal</th>
            <th className="px-1 py-2 text-center text-[10px] font-normal text-gray-500">Settlement</th>
            <th className="px-1 py-2 text-center text-[10px] font-normal text-gray-500">Interest</th>
            <th className="px-1 py-2 text-center text-[10px] font-normal text-gray-500">Accrual</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-500">
                No {tone === 'borrowed' ? 'borrowed' : 'lent'} facilities in this scope.
              </td>
            </tr>
          ) : (
            rows.map((row: any) => (
              <tr key={row.id} className="hover:bg-gray-50">
                <td className="max-w-[14rem] px-3 py-3 align-top">
                  <div className="flex items-start gap-2">
                    <Link
                      href="/loans"
                      className="mt-0.5 shrink-0 text-slate-400 hover:text-blue-600"
                      title="Open loans workspace"
                      aria-label="Open loans"
                    >
                      <Landmark className="h-4 w-4" />
                    </Link>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{row.loan_no}</p>
                      {row.title ? <p className="truncate text-xs text-gray-500">{row.title}</p> : null}
                      {row.deal_reference ? <p className="text-xs text-gray-400">Ref: {row.deal_reference}</p> : null}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 align-top text-sm text-gray-800">
                  <span className="font-medium">{row.counterparty_name || '—'}</span>
                  {row.counterparty_code ? (
                    <span className="ml-1 font-mono text-xs text-gray-500">({row.counterparty_code})</span>
                  ) : null}
                  <p className="text-xs text-gray-500">
                    {row.product_type} · {row.banking_model}
                  </p>
                </td>
                <td className="whitespace-nowrap px-3 py-3 align-top text-sm capitalize text-gray-700">{row.status}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                  {formatCurrency(row.outstanding_principal)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-sm tabular-nums text-gray-800">
                  {formatCurrency(row.period_disbursements)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-sm tabular-nums text-gray-800">
                  {formatCurrency(row.period_repayments)}
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
  handleReportDateChange?: (field: 'startDate' | 'endDate', value: string, reportId?: ReportType) => void,
  itemScope?: ItemScopeTableProps
) {
  const period = data?.period || {}
  const hasPeriod =
    REPORTS_WITH_PERIOD.has(reportType) &&
    (period.start_date || period.end_date || dateRange?.startDate || dateRange?.endDate)
  
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
            <h4 className="font-semibold text-gray-900 mb-3">Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 uppercase tracking-wide font-medium">Total Meters</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{summary.total_meters || 0}</p>
              </div>
                  <div className="bg-gray-200 rounded-full p-2 ml-2">
                    <Gauge className="h-4 w-4 text-gray-600" />
              </div>
              </div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-green-600 uppercase tracking-wide font-medium">Total Sales</p>
                    <p className="text-xl font-bold text-green-900 mt-1">{summary.total_sales || 0}</p>
                  </div>
                  <div className="bg-green-200 rounded-full p-2 ml-2">
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-blue-600 uppercase tracking-wide font-medium">Total Liters Dispensed</p>
                    <p className="text-xl font-bold text-blue-900 mt-1">{formatNumber(Number(summary.total_liters_dispensed || 0))}L</p>
                  </div>
                  <div className="bg-blue-200 rounded-full p-2 ml-2">
                    <Droplet className="h-4 w-4 text-blue-600" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-purple-600 uppercase tracking-wide font-medium">Total Amount</p>
                    <p className="text-xl font-bold text-purple-900 mt-1">{formatCurrency(summary.total_amount)}</p>
                  </div>
                  <div className="bg-purple-200 rounded-full p-2 ml-2">
                    <DollarSign className="h-4 w-4 text-purple-600" />
                  </div>
                </div>
              </div>
              {summary.average_sale !== undefined && (
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 rounded-lg p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-indigo-600 uppercase tracking-wide font-medium">Average Sale</p>
                      <p className="text-xl font-bold text-indigo-900 mt-1">{formatCurrency(summary.average_sale)}</p>
                    </div>
                    <div className="bg-indigo-200 rounded-full p-2 ml-2">
                      <BarChart3 className="h-4 w-4 text-indigo-600" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Meters Table */}
        <div>
          <h4 className="font-semibold text-gray-900 mb-3">Meter Details (Filtered by Date Range)</h4>
          {meters.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Meter Number</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Meter Name</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Opening Reading</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Closing Reading</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Period Dispensed</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Sales</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales Liters</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {meters.map((meter: any, index: number) => {
                    const openingReading = Number(meter.opening_reading || 0)
                    const closingReading = Number(meter.closing_reading || meter.current_reading || 0)
                    const periodDispensed = Math.max(0, Number(meter.period_dispensed !== undefined ? meter.period_dispensed : (closingReading - openingReading)))
                    
                    return (
                      <tr
                        key={meter.id != null ? `meter-${meter.id}` : `meter-${index}-${String(meter.meter_number ?? '')}`}
                        className="hover:bg-gray-50"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{meter.meter_number || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{meter.meter_name || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {formatNumber(openingReading)}L
                          {meter.opening_reading_date && (
                            <span className="block text-xs text-gray-400 mt-1">
                              {formatDate(meter.opening_reading_date)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                          {formatNumber(closingReading)}L
                          {meter.closing_reading_date && (
                            <span className="block text-xs text-gray-400 mt-1">
                              {formatDateOnly(meter.closing_reading_date)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-blue-600 font-medium">
                          {formatNumber(periodDispensed)}L
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {meter.total_sales || 0}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {formatNumber(Number(meter.total_liters || 0))}L
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                          {formatCurrency(meter.total_amount)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            meter.is_active !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {meter.is_active !== false ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {meters.length > 0 && (
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                        Totals
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                        {summary.total_sales ?? meters.reduce((s: number, m: any) => s + Number(m.total_sales ?? 0), 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                        {formatNumber(Number(summary.total_liters_dispensed ?? meters.reduce((s: number, m: any) => s + Number(m.total_liters ?? 0), 0)))}{' '}
                        L
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                        {formatCurrency(Number(summary.total_amount ?? meters.reduce((s: number, m: any) => s + Number(m.total_amount ?? 0), 0)))}
                      </td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center">
              <div className="flex flex-col items-center">
                <BarChart3 className="h-16 w-16 text-gray-300 mb-4" />
                <p className="text-gray-500 text-lg font-medium">No meter readings found</p>
                <p className="text-gray-400 text-sm mt-2">
                  Try adjusting the date range or check if meters are properly configured
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Daily Summary
  if (reportType === 'daily-summary' && data) {
    const summary = data.sales || {}
    const shifts = data.shifts || {}
    const dips = data.dips || {}
    const tanks = Array.isArray(data.tanks) ? data.tanks : []
    const byProduct = summary.by_product || {}
    const period = data?.period || {}

    return (
      <div className="space-y-8">
        {/* Report Period - Date Range */}
        {hasPeriod && renderPeriodFilter(
          period,
          dateRange,
          reportType,
          handleReportDateChange,
          "Daily summary data is shown for this date range."
        )}

        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Summary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { label: 'Total Transactions', value: summary.total_transactions ?? 0, icon: BarChart3, color: 'blue' },
              { label: 'Total Liters', value: `${formatNumber(Number(summary.total_liters ?? 0))} L`, icon: Droplet, color: 'blue' },
              { label: 'Total Amount', value: formatCurrency(summary.total_amount), icon: DollarSign, color: 'green' },
              { label: 'Average Sale', value: formatCurrency(summary.average_sale), icon: TrendingUp, color: 'purple' },
              { label: 'Total Shifts', value: shifts.total_shifts ?? 0, icon: Users, color: 'indigo' },
              { label: 'Total Cash Variance', value: formatCurrency(shifts.total_cash_variance), icon: DollarSign, color: 'yellow' },
              { label: 'Total Dip Readings', value: dips.total_readings ?? 0, icon: Calendar, color: 'pink' },
              { label: 'Net Dip Variance', value: formatCurrency(dips.net_variance), icon: TrendingUp, color: 'red' },
            ].map((item, idx) => {
              const colorMap: Record<string, string> = {
                blue: 'from-blue-50 to-blue-100 border-blue-200 text-blue-600 bg-blue-200',
                green: 'from-green-50 to-green-100 border-green-200 text-green-600 bg-green-200',
                purple: 'from-purple-50 to-purple-100 border-purple-200 text-purple-600 bg-purple-200',
                indigo: 'from-indigo-50 to-indigo-100 border-indigo-200 text-indigo-600 bg-indigo-200',
                yellow: 'from-yellow-50 to-yellow-100 border-yellow-200 text-yellow-600 bg-yellow-200',
                pink: 'from-pink-50 to-pink-100 border-pink-200 text-pink-600 bg-pink-200',
                red: 'from-red-50 to-red-100 border-red-200 text-red-600 bg-red-200'
              }
              const colors = colorMap[item.color] || colorMap.blue
              const [gradient, border, text, bg] = colors.split(' ')
              const Icon = item.icon
              
              return (
                <div key={idx} className={`bg-gradient-to-br ${gradient} ${border} border rounded-lg p-4 shadow-sm`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className={`text-xs uppercase tracking-wide font-medium ${text}`}>{item.label}</p>
                      <p className={`text-2xl font-bold mt-1 ${text.replace('600', '900')}`}>{item.value}</p>
              </div>
                    <div className={`${bg} rounded-full p-2 ml-2`}>
                      <Icon className={`h-5 w-5 ${text}`} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {Object.keys(byProduct).length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Sales by Product</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Transactions</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Liters</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Object.entries(
                    byProduct as Record<string, { line_count?: number; transactions?: number; liters?: number; amount?: number }>
                  ).map(([product, metrics], pIdx) => (
                    <tr key={`${pIdx}-${product}`}>
                      <td className="px-4 py-3 text-sm text-gray-900">{product}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">
                        {metrics.line_count ?? metrics.transactions ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">
                        {formatNumber(Number(metrics.liters ?? 0))} L
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">
                        {formatCurrency(metrics.amount ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800">Totals</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {Object.values(byProduct as Record<string, { line_count?: number }>).reduce((s, m) => s + Number(m.line_count ?? 0), 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {formatNumber(Number(summary.total_liters ?? 0))} L
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                      {formatCurrency(Number(summary.total_amount ?? 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {Array.isArray(tanks) && tanks.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Tank Status</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Capacity</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Current Stock</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Fill %</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {tanks.map((tank: any, idx: number) => (
                    <tr key={idx}>
                      <td className="px-4 py-3 text-sm text-gray-900">{tank.tank_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{tank.product}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">
                        {Number(tank.capacity ?? 0).toLocaleString()} L
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">
                        {Number(tank.current_stock ?? 0).toLocaleString()} L
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                        {formatNumber(Number(tank.fill_percentage ?? 0))}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                      Totals
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {tanks.reduce((s: number, t: any) => s + Number(t.capacity ?? 0), 0).toLocaleString()} L
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {tanks.reduce((s: number, t: any) => s + Number(t.current_stock ?? 0), 0).toLocaleString()} L
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Trial Balance
  if (reportType === 'trial-balance' && data) {
    const accounts = Array.isArray(data.accounts) ? data.accounts : (Array.isArray(data) ? data : [])
    const period = data?.period || {}
    const totalDebit = data?.total_debit || 0
    const totalCredit = data?.total_credit || 0

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

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong className="text-amber-900">Cash from POS:</strong> this report only lists accounts that had journal
          activity in the selected <strong>date range</strong>. If you do not see cash, extend the start date to include
          your sale days, then look for codes <span className="font-mono">1010</span>, <span className="font-mono">1020</span>{' '}
          (cash / undeposited), or <span className="font-mono">1120</span> (card). Detail:{' '}
          <span className="font-medium">Chart of accounts</span> → open that line → statement.
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-blue-600 uppercase tracking-wide font-medium">Total Debit</p>
                <p className="text-2xl font-bold text-blue-900 mt-1">
                  {formatCurrency(totalDebit)}
            </p>
          </div>
              <div className="bg-blue-200 rounded-full p-2 ml-2">
                <BarChart3 className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-green-600 uppercase tracking-wide font-medium">Total Credit</p>
                <p className="text-2xl font-bold text-green-900 mt-1">
                  {formatCurrency(totalCredit)}
                </p>
              </div>
              <div className="bg-green-200 rounded-full p-2 ml-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Accounts Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {accounts.length > 0 ? (
                accounts.map((account: any, idx: number) => (
                  <tr key={idx}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{account.account_code}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{account.account_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{account.account_type}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                      {formatCurrency(account.debit)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                      {formatCurrency(account.credit)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                      {formatCurrency(account.balance)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <BarChart3 className="h-12 w-12 text-gray-300 mb-3" />
                      <p className="text-gray-500 font-medium">No accounts found</p>
                      <p className="text-gray-400 text-sm mt-1">Set up your chart of accounts to generate a trial balance</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {accounts.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-6 py-3 text-sm font-medium text-gray-900 text-right">
                    Totals:
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">
                    {formatCurrency(totalDebit)}
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">
                    {formatCurrency(totalCredit)}
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">
                    {formatCurrency(totalDebit - totalCredit)}
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
            <div key={title} className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="p-4 border-b bg-gray-50">
                <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
                <p className="text-sm font-medium text-gray-700 mt-1">
                  Total: {formatCurrency(payload?.total)}
                </p>
              </div>
              <div className="divide-y divide-gray-200">
                {(payload?.accounts ?? []).length > 0 ? (
                  (payload?.accounts ?? []).map((account: any, accIdx: number) => (
                    <div
                      key={`${title}-${accIdx}-${account.account_code ?? 'acct'}`}
                      className={`px-4 py-3 flex justify-between hover:bg-gray-50 transition-colors ${
                        account.is_auto_plug
                          ? 'bg-amber-50/80 border-l-2 border-amber-500'
                          : account.is_rollup
                            ? 'bg-emerald-50/70 border-l-2 border-emerald-500'
                            : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{account.account_name}</p>
                        <p className="text-xs text-gray-500">{account.account_code}</p>
                      </div>
                      <p className="text-sm font-semibold text-gray-900 ml-4 whitespace-nowrap">
                        {formatCurrency(account.balance)}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <FileText className="h-12 w-12 text-gray-300 mb-3" />
                      <p className="text-gray-500 font-medium">No {title.toLowerCase()} accounts found</p>
                      <p className="text-gray-400 text-sm mt-1">Set up {title.toLowerCase()} accounts in your chart of accounts</p>
                    </div>
                  </div>
                )}
                {(payload?.accounts ?? []).length > 0 && (
                  <div className="flex justify-between items-center px-4 py-3 bg-slate-50 border-t border-slate-200">
                    <span className="text-sm font-semibold text-slate-800">Sub-total — {title}</span>
                    <span className="text-sm font-bold tabular-nums text-slate-900">{formatCurrency(payload?.total)}</span>
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
                <p className="mt-1 tabular-nums text-lg font-bold">{formatCurrency(ni)}</p>
                <p className={`mt-1 text-xs ${gain ? 'text-emerald-800/90' : 'text-rose-800/90'}`}>
                  Included under Equity as &quot;Net income (cumulative P&L — unclosed to equity)&quot; so Assets
                  match Liabilities + Equity. After closing P&amp;L to Retained Earnings, this rollup is usually
                  unnecessary.
                </p>
              </div>
            )
          })()}

        {data.is_balanced === false && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
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
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-semibold">Automatic tie-out line (Σ-ADJ)</p>
              <p className="mt-1">
                A small equity line of {formatCurrency(data.auto_plug_amount)} was added so totals match. Review
                inactive accounts, non-standard chart types, or one-sided opening balances if this amount is large.
              </p>
            </div>
          )}

        {data.is_balanced === true && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            Assets equal Liabilities + Equity (within ৳0.02), including cumulative P&amp;L in equity
            {typeof data.auto_plug_amount === 'number' && Math.abs(Number(data.auto_plug_amount)) > 0.02
              ? ' and any Σ-ADJ tie-out.'
              : '.'}
          </div>
        )}

        {/* Balance Sheet Totals */}
        <div className="bg-white border-2 border-gray-300 rounded-lg p-6 shadow-sm">
          <div className="flex justify-between items-center">
            <p className="text-lg font-semibold text-gray-900">Total Assets</p>
            <p className="text-lg font-bold text-gray-900">
              {formatCurrency(data.assets?.total)}
            </p>
          </div>
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-200">
            <p className="text-lg font-semibold text-gray-900">Total Liabilities & Equity</p>
            <p className="text-lg font-bold text-gray-900">
              {formatCurrency(data.total_liabilities_and_equity)}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Income Statement
  if (reportType === 'income-statement' && data) {
    const blocks = [
      { title: 'Income', payload: data.income },
      { title: 'Cost of Goods Sold', payload: data.cost_of_goods_sold },
      { title: 'Expenses', payload: data.expenses },
    ]
    const period = data?.period || {}

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

        {data.period_matches_cumulative_change === false && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold">Period net income vs cumulative P&L change</p>
            <p className="mt-1">
              This period&apos;s net ({formatCurrency(data.net_income)}) differs from the change in cumulative P&amp;L (
              {formatCurrency(data.cumulative_net_income_change)}) by{' '}
              {formatCurrency(data.cumulative_vs_period_difference)}. That usually means an opening balance on an
              income, COGS, or expense account, or activity dated outside the selected range.
            </p>
          </div>
        )}

        <div className="space-y-6">
          {blocks.map(({ title, payload }) => (
            <div key={title} className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
                <span className="text-sm font-bold text-gray-700">
                  {formatCurrency(payload?.total)}
                </span>
              </div>
              <div className="divide-y divide-gray-200">
                {(payload?.accounts ?? []).length > 0 ? (
                  (payload?.accounts ?? []).map((account: any, accIdx: number) => (
                    <div
                      key={`${title}-${accIdx}-${account.account_code ?? 'acct'}`}
                      className="px-4 py-3 flex justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{account.account_name}</p>
                        <p className="text-xs text-gray-500">{account.account_code}</p>
                      </div>
                      <p className="text-sm font-semibold text-gray-900 ml-4 whitespace-nowrap">
                        {formatCurrency(account.balance)}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-gray-400 text-sm">
                    No {title.toLowerCase()} accounts found
                  </div>
                )}
                {(payload?.accounts ?? []).length > 0 && (
                  <div className="flex justify-between items-center px-4 py-3 bg-slate-50 border-t border-slate-200">
                    <span className="text-sm font-semibold text-slate-800">Sub-total — {title}</span>
                    <span className="text-sm font-bold tabular-nums text-slate-900">{formatCurrency(payload?.total)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Summary Totals */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-green-50 to-white border-2 border-green-300 rounded-lg p-5 shadow-sm">
            <p className="text-xs text-green-700 uppercase tracking-wide font-semibold">Gross Profit</p>
            <p className="text-2xl font-bold text-green-800 mt-2">
              {formatCurrency(data.gross_profit)}
            </p>
            <p className="text-xs text-green-600 mt-1">
              Income - COGS
            </p>
          </div>
          <div className="bg-gradient-to-br from-blue-50 to-white border-2 border-blue-300 rounded-lg p-5 shadow-sm md:col-span-2">
            <p className="text-xs text-blue-700 uppercase tracking-wide font-semibold">Net Income</p>
            <p className={`text-3xl font-bold mt-2 ${
              Number(data.net_income ?? 0) >= 0 ? 'text-blue-800' : 'text-red-600'
            }`}>
              {formatCurrency(data.net_income)}
            </p>
            <p className="text-xs text-blue-600 mt-1">
              Gross Profit - Expenses
            </p>
          </div>
        </div>

        {Number(data.net_income ?? 0) < 0 && (
          <p className="text-sm text-slate-600 max-w-3xl">
            Negative net usually means period COGS (fuel 5100, shrinkage 5200, shop 5120) or operating expenses
            exceed income for the selected dates. Widen the range, or run{' '}
            <code className="text-xs bg-slate-100 px-1 rounded">python manage.py seed_master_full_demo --reset-demo-gl</code>{' '}
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
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Account</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500 w-24">
                  Ledger
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                    No liability accounts with a non-zero balance for this scope.
                  </td>
                </tr>
              ) : (
                accounts.map((acc: any, idx: number) => (
                  <tr key={`${acc.account_id}-${idx}`} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-gray-900">{acc.account_code}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{acc.account_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{acc.account_type}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {formatCurrency(acc.balance)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <GlLedgerIconLink accountId={acc.account_id} label={acc.account_name || acc.account_code} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {accounts.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                    Total liabilities
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-gray-900">
                    {formatCurrency(data.total_liabilities ?? 0)}
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
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Account</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Sub-type</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500 w-24">
                  Ledger
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                    No loans-receivable GL accounts with a balance. Create a lent loan or chart lines with type loan (not
                    loan payable).
                  </td>
                </tr>
              ) : (
                accounts.map((acc: any, idx: number) => (
                  <tr key={`${acc.account_id}-${idx}`} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-gray-900">{acc.account_code}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{acc.account_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{acc.account_sub_type || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {formatCurrency(acc.balance)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <GlLedgerIconLink accountId={acc.account_id} label={acc.account_name || acc.account_code} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {accounts.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                    Total loan receivable (GL)
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-gray-900">
                    {formatCurrency(data.total_loan_receivable_gl ?? 0)}
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
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Account</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Sub-type</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500 w-24">
                  Ledger
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                    No loans-payable GL accounts with a balance. Create a borrowed loan or chart lines with type loan and
                    sub-type loan payable.
                  </td>
                </tr>
              ) : (
                accounts.map((acc: any, idx: number) => (
                  <tr key={`${acc.account_id}-${idx}`} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-gray-900">{acc.account_code}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{acc.account_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{acc.account_sub_type || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {formatCurrency(acc.balance)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <GlLedgerIconLink accountId={acc.account_id} label={acc.account_name || acc.account_code} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {accounts.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                    Total loan payable (GL)
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-gray-900">
                    {formatCurrency(data.total_loan_payable_gl ?? 0)}
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
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-rose-100 bg-rose-50/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">Outstanding borrowed</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-rose-950">{formatCurrency(sm.outstanding_borrowed_principal ?? 0)}</p>
            <p className="mt-1 text-xs text-rose-800/80">{sm.borrowed_count ?? 0} facilities</p>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Outstanding lent</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-950">{formatCurrency(sm.outstanding_lent_principal ?? 0)}</p>
            <p className="mt-1 text-xs text-emerald-800/80">{sm.lent_count ?? 0} facilities</p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Period disbursements</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-blue-950">{formatCurrency(sm.period_disbursements_total ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Period repayments</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-indigo-950">{formatCurrency(sm.period_repayments_total ?? 0)}</p>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-lg font-semibold text-gray-900">Borrowed (you owe principal)</h3>
          <LoanFacilitiesTable rows={borrowed} tone="borrowed" />
        </div>
        <div>
          <h3 className="mb-3 text-lg font-semibold text-gray-900">Lent (principal receivable)</h3>
          <LoanFacilitiesTable rows={lent} tone="lent" />
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
              blue: 'from-blue-50 to-blue-100 border-blue-200 text-blue-600 bg-blue-200',
              green: 'from-green-50 to-green-100 border-green-200 text-green-600 bg-green-200',
              purple: 'from-purple-50 to-purple-100 border-purple-200 text-purple-600 bg-purple-200',
              indigo: 'from-indigo-50 to-indigo-100 border-indigo-200 text-indigo-600 bg-indigo-200'
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
                      {item.format === 'currency' ? formatCurrency(item.value) :
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
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tanks</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{invSummary.tank_count ?? inventory.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total capacity (L)</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{Number(invSummary.total_capacity_liters ?? totCap).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total stock (L)</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{Number(invSummary.total_current_stock_liters ?? totStock).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tank</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Station</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Capacity</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Current Stock</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Fill %</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Needs Refill</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {inventory.length > 0 ? (
                inventory.map((tank: any, idx: number) => (
                  <tr key={idx}>
                    <td className="px-4 py-3 text-sm text-gray-900">{tank.tank_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{tank.station_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{tank.product_name}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {Number(tank.capacity ?? 0).toLocaleString()} L
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {Number(tank.current_stock ?? 0).toLocaleString()} L
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                      {formatNumber(Number(tank.fill_percentage ?? 0))}%
                    </td>
                        <td className="px-4 py-3 text-sm text-right">
                      {tank.needs_refill ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
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
                      <Package className="h-12 w-12 text-gray-300 mb-3" />
                      <p className="text-gray-500 font-medium">No tank inventory found</p>
                      <p className="text-gray-400 text-sm mt-1">Set up tanks in your stations to track inventory</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {inventory.length > 0 && (
              <tfoot className="bg-slate-50">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-slate-800">
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">
                    {totCap.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">
                    {totStock.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td colSpan={2} className="px-4 py-3 text-sm text-slate-600" />
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
    const rows: any[] = Array.isArray(data.rows) ? data.rows : []
    const s = data.summary || {}
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

        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">What this report shows</h3>
          <p className="mt-1 text-sm text-slate-600 max-w-4xl leading-relaxed">
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
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {k.fmt === 'c' ? formatCurrency(Number(k.v) || 0) : formatNumber(Number(k.v) || 0, 2)}
              </p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">SKU</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Item</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Category</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">On hand</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Unit cost</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Cost value</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">List value</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Period qty</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Period revenue</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Units / day</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Days cover</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-slate-500">
                    No tracked inventory items found. Add products (inventory type) or record sales in the period.
                  </td>
                </tr>
              ) : (
                rows.map((r: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-900">{r.sku || '—'}</td>
                    <td className="max-w-[200px] px-3 py-2 text-slate-800">
                      <span className="line-clamp-2" title={r.name}>
                        {r.name}
                      </span>
                      {r.unit ? <span className="ml-1 text-xs text-slate-500">({r.unit})</span> : null}
                    </td>
                    <td className="px-3 py-2 text-slate-700 max-w-[140px]">
                      <span className="line-clamp-2" title={r.reporting_category || '—'}>
                        {r.reporting_category || '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-800">
                      {formatNumber(r.quantity_on_hand, 2)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">
                      {formatCurrency(r.unit_cost)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-slate-900">
                      {formatCurrency(r.extended_cost_value)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-slate-800">
                      {formatCurrency(r.extended_list_value)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-slate-800">
                      {formatNumber(r.period_quantity_sold, 2)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-slate-800">
                      {formatCurrency(r.period_revenue)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">
                      {formatNumber(r.velocity_per_day, 2)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-slate-800">
                      {r.days_of_cover == null ? '—' : `${r.days_of_cover} d`}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {statusLabel[r.stock_status] || r.stock_status}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-slate-100">
                <tr>
                  <td colSpan={3} className="px-3 py-2.5 text-right text-xs font-bold uppercase text-slate-700">
                    Totals
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                    {formatNumber(Number(s.total_qty_on_hand ?? 0), 2)}
                  </td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-900">
                    {formatCurrency(Number(s.total_cost_value ?? 0))}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-900">
                    {formatCurrency(Number(s.total_list_value ?? 0))}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                    {formatNumber(Number(s.total_period_quantity_sold ?? 0), 2)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-900">
                    {formatCurrency(Number(s.total_period_revenue ?? 0))}
                  </td>
                  <td colSpan={3} className="px-3 py-2.5" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {data.accounting_note ? (
          <p className="text-xs text-slate-500 max-w-4xl leading-relaxed border-t border-slate-100 pt-3">
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
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
            {String(period.note)} Dates below label the printout; stock is current.
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
          <h3 className="bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">Summary by category</h3>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-600">Category</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">Items</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">Active</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">On hand (units)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">Cost value</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">List value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {byCat.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No items in the catalog.
                  </td>
                </tr>
              ) : (
                byCat.map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-medium text-slate-900">{c.reporting_category}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.item_count ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.active_count ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.quantity_on_hand, 2)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(c.extended_cost_value)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(c.extended_list_value)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {byCat.length > 0 && (
              <tfoot className="bg-slate-100">
                <tr>
                  <td className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-700">Totals</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {ms.total_items != null ? ms.total_items : catTotals.items}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{catTotals.active}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {formatNumber(Number(ms.total_quantity_on_hand ?? catTotals.qoh), 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">
                    {formatCurrency(Number(ms.total_extended_cost_value ?? catTotals.cost))}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">
                    {formatCurrency(Number(ms.total_extended_list_value ?? catTotals.list))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
          <h3 className="bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">All items (detail)</h3>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-600">SKU</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-600">Name</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-600">Category</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-600">POS</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-600">Type</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase text-slate-600">Active</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">On hand</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">Cost value</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">List value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No rows.
                  </td>
                </tr>
              ) : (
                rows.map((r: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-800">{r.sku}</td>
                    <td className="max-w-[180px] px-3 py-2 text-slate-800">
                      <span className="line-clamp-2" title={r.name}>
                        {r.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-amber-900/90 max-w-[120px]">
                      <span className="line-clamp-2" title={r.reporting_category}>
                        {r.reporting_category}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{r.pos_category}</td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{r.item_type}</td>
                    <td className="px-3 py-2 text-center">
                      {r.is_active ? (
                        <span className="text-xs text-green-700">Yes</span>
                      ) : (
                        <span className="text-xs text-slate-400">No</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.quantity_on_hand, 2)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(r.extended_cost_value)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(r.extended_list_value)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-slate-100">
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-700">
                    Totals
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {formatNumber(detailTotals.qoh, 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(detailTotals.cost)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(detailTotals.list)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {data.accounting_note ? (
          <p className="text-xs text-slate-500 max-w-4xl leading-relaxed border-t border-slate-100 pt-3">
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

        <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Category</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Inv. lines</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Products</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Quantity</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {catRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    No invoice lines with linked items in this period.
                  </td>
                </tr>
              ) : (
                catRows.map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-medium text-amber-950">{c.reporting_category}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800">{c.line_count ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800">{c.distinct_items ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.total_quantity, 2)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(c.total_revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {catRows.length > 0 && (
              <tfoot className="bg-slate-100">
                <tr>
                  <td className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-700">Totals</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{subLines}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{subDist}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {formatNumber(Number(sm.total_quantity ?? subQty), 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">
                    {formatCurrency(Number(sm.total_revenue ?? subRev))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {data.accounting_note ? (
          <p className="text-xs text-slate-500 max-w-4xl leading-relaxed border-t border-slate-100 pt-3">
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

        <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Category</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Bill lines</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Products</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Quantity</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Purchase amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {catRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    No bill lines with linked items in this period.
                  </td>
                </tr>
              ) : (
                catRows.map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-medium text-amber-950">{c.reporting_category}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800">{c.line_count ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800">{c.distinct_items ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.total_quantity, 2)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(c.total_purchase_amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {catRows.length > 0 && (
              <tfoot className="bg-slate-100">
                <tr>
                  <td className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-700">Totals</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{subLines}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{subDist}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {formatNumber(Number(sm.total_quantity ?? subQty), 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">
                    {formatCurrency(Number(sm.total_purchase_amount ?? subAmt))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {data.accounting_note ? (
          <p className="text-xs text-slate-500 max-w-4xl leading-relaxed border-t border-slate-100 pt-3">
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

        {ic && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
            <p className="mb-3 text-sm font-medium text-slate-800">Scope: category and products (optional)</p>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-xs font-medium uppercase text-slate-500">Category</label>
                <select
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={ic!.category}
                  onChange={(e) => ic!.onCategoryChange(e.target.value)}
                >
                  <option value="">All categories (list shows every product)</option>
                  {ic!.categoryList.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Narrow the checklist. Leave empty to see all products (still multi-selectable).
                </p>
              </div>
              <div className="min-w-0 flex-[2]">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium uppercase text-slate-500">Products (multi-select)</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-blue-700 hover:underline"
                      onClick={() => ic!.onSelectAllVisible()}
                    >
                      Select all in list
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      className="text-xs font-medium text-slate-600 hover:underline"
                      onClick={() => ic!.onClearItems()}
                    >
                      Clear selection
                    </button>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white p-2">
                  {ic!.visibleItemOptions.length === 0 ? (
                    <p className="p-2 text-sm text-slate-500">No products match this category. Clear category or add items in Products.</p>
                  ) : (
                    <ul className="grid gap-1 sm:grid-cols-1 md:grid-cols-2">
                      {ic!.visibleItemOptions.map((it) => {
                        const checked = ic!.selectedItemIds.includes(it.id)
                        return (
                          <li key={it.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              id={`rpt-item-${it.id}`}
                              checked={checked}
                              onChange={() => ic!.onToggleItem(it.id)}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            <label htmlFor={`rpt-item-${it.id}`} className="flex-1 cursor-pointer truncate text-slate-800">
                              <span className="font-mono text-xs text-slate-500">{it.item_number || it.id}</span> — {it.name}
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {ic!.selectedItemIds.length} selected. Leave all unchecked to include <strong>every</strong> product
                  in scope (category-only or company-wide, depending on report). Check specific rows to run the report
                  for only those SKUs.
                </p>
              </div>
              <div className="flex shrink-0 items-end">
                <button
                  type="button"
                  onClick={() => void ic!.fetchReport(reportType)}
                  className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Apply filters
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-slate-600">
          <span className="font-medium">Active view:</span> {filterText}; {itemPart}.
        </p>

        {reportType === 'item-sales-custom' ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
            {(() => {
              const cRows: any[] = Array.isArray(data.rows) ? data.rows : []
              const sum = data.summary || {}
              const tq = Number(sum.total_quantity ?? cRows.reduce((s, r) => s + Number(r.period_quantity_sold ?? 0), 0))
              const tr = Number(sum.total_revenue ?? cRows.reduce((s, r) => s + Number(r.period_revenue ?? 0), 0))
              const tc = cRows.reduce((s, r) => s + Number(r.est_cogs ?? 0), 0)
              return (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">SKU</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Item</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Category</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">POS</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Period qty</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Revenue</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Est. COGS</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {cRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                      No rows for this selection. Try a wider range or different products.
                    </td>
                  </tr>
                ) : (
                  cRows.map((r: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-900">{r.sku || '—'}</td>
                      <td className="max-w-[200px] px-3 py-2 text-slate-800">
                        <span className="line-clamp-2" title={r.name}>
                          {r.name}
                        </span>
                        {r.unit ? <span className="ml-1 text-xs text-slate-500">({r.unit})</span> : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-amber-950/90 max-w-[120px] line-clamp-2">{r.reporting_category}</td>
                      <td className="px-3 py-2 text-slate-600 text-xs">{r.pos_category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.period_quantity_sold, 2)}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(r.period_revenue)}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(r.est_cogs)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                        {r.gross_margin_pct == null ? '—' : `${formatNumber(r.gross_margin_pct, 2)}%`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {cRows.length > 0 && (
                <tfoot className="bg-slate-100">
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-700">
                      Totals
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{formatNumber(tq, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(tr)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(tc)}</td>
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
          <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
            {(() => {
              const cRows: any[] = Array.isArray(data.rows) ? data.rows : []
              const sum = data.summary || {}
              const tq = Number(sum.total_quantity ?? cRows.reduce((s, r) => s + Number(r.period_quantity_purchased ?? 0), 0))
              const ta = Number(sum.total_purchase_amount ?? cRows.reduce((s, r) => s + Number(r.period_purchase_amount ?? 0), 0))
              return (
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">SKU</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Item</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Category</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">POS</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Period qty</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Purchase $</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Avg unit $</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {cRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                          No rows for this selection. Try a wider range or different products.
                        </td>
                      </tr>
                    ) : (
                      cRows.map((r: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50/80">
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-900">{r.sku || '—'}</td>
                          <td className="max-w-[200px] px-3 py-2 text-slate-800">
                            <span className="line-clamp-2" title={r.name}>
                              {r.name}
                            </span>
                            {r.unit ? <span className="ml-1 text-xs text-slate-500">({r.unit})</span> : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-amber-950/90 max-w-[120px] line-clamp-2">
                            {r.reporting_category}
                          </td>
                          <td className="px-3 py-2 text-slate-600 text-xs">{r.pos_category}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatNumber(r.period_quantity_purchased, 2)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(r.period_purchase_amount)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                            {r.avg_purchase_unit_cost == null ? '—' : formatCurrency(r.avg_purchase_unit_cost)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {cRows.length > 0 && (
                    <tfoot className="bg-slate-100">
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-700">
                          Totals
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{formatNumber(tq, 2)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(ta)}</td>
                        <td className="px-3 py-2 text-sm text-slate-500">—</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )
            })()}
          </div>
        ) : null}

        {reportType === 'item-stock-movement' ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
            {(() => {
              const cRows: any[] = Array.isArray(data.rows) ? data.rows : []
              const sum = data.summary || {}
              const tp = Number(sum.total_qty_purchased ?? cRows.reduce((s, r) => s + Number(r.quantity_purchased ?? 0), 0))
              const ts = Number(sum.total_qty_sold ?? cRows.reduce((s, r) => s + Number(r.quantity_sold ?? 0), 0))
              const tpa = Number(sum.total_purchase_amount ?? cRows.reduce((s, r) => s + Number(r.purchase_amount ?? 0), 0))
              const tsr = Number(sum.total_sales_revenue ?? cRows.reduce((s, r) => s + Number(r.sales_revenue ?? 0), 0))
              const tn = cRows.reduce((s, r) => s + Number(r.net_quantity_in ?? 0), 0)
              return (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">SKU</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Item</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Category</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Qty in (bills)</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Purchase $</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Qty out (sales)</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Sales $</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Net qty (in−out)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {cRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                      No data. Try a wider range or a category with bill and/or invoice lines.
                    </td>
                  </tr>
                ) : (
                  cRows.map((r: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-900">{r.sku || '—'}</td>
                      <td className="max-w-[200px] px-3 py-2 text-slate-800">
                        <span className="line-clamp-2" title={r.name}>
                          {r.name}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-amber-950/90 max-w-[120px] line-clamp-2">{r.reporting_category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.quantity_purchased, 2)}</td>
                      <td className="px-3 py-2 text-right text-slate-800">{formatCurrency(r.purchase_amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.quantity_sold, 2)}</td>
                      <td className="px-3 py-2 text-right text-slate-800">{formatCurrency(r.sales_revenue)}</td>
                      <td
                        className={`px-3 py-2 text-right font-medium tabular-nums ${
                          (r.net_quantity_in ?? 0) > 0
                            ? 'text-green-800'
                            : (r.net_quantity_in ?? 0) < 0
                              ? 'text-amber-900'
                              : 'text-slate-600'
                        }`}
                      >
                        {formatNumber(r.net_quantity_in, 2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {cRows.length > 0 && (
                <tfoot className="bg-slate-100">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-700">
                      Totals
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{formatNumber(tp, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(tpa)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{formatNumber(ts, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(tsr)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{formatNumber(tn, 2)}</td>
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
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm shadow-sm"
                  >
                    <div className="text-xs text-slate-500">{label}</div>
                    <div className="text-lg font-semibold text-slate-900">{(data.summary as any)[k] ?? 0}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
              {(() => {
                const cRows: any[] = Array.isArray(data.rows) ? data.rows : []
                const tierOrder = ['fast', 'medium', 'slow', 'no_period_sales'] as const
                const tierClass = (t: string) => {
                  if (t === 'fast') return 'bg-emerald-100 text-emerald-900'
                  if (t === 'medium') return 'bg-amber-100 text-amber-900'
                  if (t === 'slow') return 'bg-orange-100 text-orange-950'
                  return 'bg-slate-100 text-slate-700'
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
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Tier</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">SKU</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Item</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Category</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">On hand</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Sold qty</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Sales $</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Velocity / day</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Rank</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {cRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
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
                            <tr key={`${tier}-${idx}`} className="hover:bg-slate-50/80">
                              <td className="whitespace-nowrap px-3 py-2">
                                <span
                                  className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tierClass(r.movement_tier || '')}`}
                                >
                                  {String(r.movement_tier || '').replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-900">{r.sku || '—'}</td>
                              <td className="max-w-[200px] px-3 py-2 text-slate-800">
                                <span className="line-clamp-2" title={r.name}>
                                  {r.name}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs text-amber-950/90 max-w-[120px] line-clamp-2">{r.reporting_category}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.quantity_on_hand, 2)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.period_quantity_sold, 2)}</td>
                              <td className="px-3 py-2 text-right text-slate-800">{formatCurrency(r.period_revenue)}</td>
                              <td className="px-3 py-2 text-right text-slate-800">{formatNumber(r.velocity_per_day, 2)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{r.velocity_rank || '—'}</td>
                            </tr>
                          ))}
                          <tr className="bg-slate-100/90">
                            <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">
                              Sub-total — {label}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-slate-900">
                              {formatNumber(st.ooh, 2)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-slate-900">
                              {formatNumber(st.pq, 2)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-semibold text-slate-900">{formatCurrency(st.rev)}</td>
                            <td colSpan={2} className="px-3 py-2 text-xs text-slate-500">
                              {tierRows.length} SKU{tierRows.length === 1 ? '' : 's'}
                            </td>
                          </tr>
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
                {cRows.length > 0 && (
                  <tfoot className="bg-slate-200/80">
                    <tr>
                      <td colSpan={4} className="px-3 py-2.5 text-right text-xs font-bold uppercase text-slate-800">
                        Total — all tiers
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{formatNumber(gt.ooh, 2)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{formatNumber(gt.pq, 2)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-slate-900">{formatCurrency(gt.rev)}</td>
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
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm shadow-sm"
                  >
                    <div className="text-xs text-slate-500">{label}</div>
                    <div className="text-lg font-semibold text-slate-900">{(data.summary as any)[k] ?? 0}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
              {(() => {
                const cRows: any[] = Array.isArray(data.rows) ? data.rows : []
                const tierOrder = ['fast', 'medium', 'slow', 'no_period_purchases'] as const
                const tierClass = (t: string) => {
                  if (t === 'fast') return 'bg-emerald-100 text-emerald-900'
                  if (t === 'medium') return 'bg-amber-100 text-amber-900'
                  if (t === 'slow') return 'bg-orange-100 text-orange-950'
                  return 'bg-slate-100 text-slate-700'
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
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Tier</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">SKU</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Item</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Category</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">On hand</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Purch. qty</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Purch. $</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Purch. / day</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-600">Rank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {cRows.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
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
                                <tr key={`${tier}-${idx}`} className="hover:bg-slate-50/80">
                                  <td className="whitespace-nowrap px-3 py-2">
                                    <span
                                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tierClass(r.movement_tier || '')}`}
                                    >
                                      {String(r.movement_tier || '').replace(/_/g, ' ')}
                                    </span>
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-900">{r.sku || '—'}</td>
                                  <td className="max-w-[200px] px-3 py-2 text-slate-800">
                                    <span className="line-clamp-2" title={r.name}>
                                      {r.name}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-amber-950/90 max-w-[120px] line-clamp-2">
                                    {r.reporting_category}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.quantity_on_hand, 2)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {formatNumber(r.period_quantity_purchased, 2)}
                                  </td>
                                  <td className="px-3 py-2 text-right text-slate-800">
                                    {formatCurrency(r.period_purchase_amount)}
                                  </td>
                                  <td className="px-3 py-2 text-right text-slate-800">
                                    {formatNumber(r.purchase_velocity_per_day, 2)}
                                  </td>
                                  <td className="px-3 py-2 text-right text-slate-600">{r.velocity_rank || '—'}</td>
                                </tr>
                              ))}
                              <tr className="bg-slate-100/90">
                                <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">
                                  Sub-total — {label}
                                </td>
                                <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-slate-900">
                                  {formatNumber(st.ooh, 2)}
                                </td>
                                <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-slate-900">
                                  {formatNumber(st.pq, 2)}
                                </td>
                                <td className="px-3 py-2 text-right text-xs font-semibold text-slate-900">{formatCurrency(st.pam)}</td>
                                <td colSpan={2} className="px-3 py-2 text-xs text-slate-500">
                                  {tierRows.length} SKU{tierRows.length === 1 ? '' : 's'}
                                </td>
                              </tr>
                            </Fragment>
                          )
                        })
                      )}
                    </tbody>
                    {cRows.length > 0 && (
                      <tfoot className="bg-slate-200/80">
                        <tr>
                          <td colSpan={4} className="px-3 py-2.5 text-right text-xs font-bold uppercase text-slate-800">
                            Total — all tiers
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{formatNumber(gt.ooh, 2)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{formatNumber(gt.pq, 2)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-slate-900">{formatCurrency(gt.pam)}</td>
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
          <p className="text-xs text-slate-500 max-w-4xl leading-relaxed border-t border-slate-100 pt-3">
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
            { label: 'Total Amount', value: formatCurrency(summary.total_amount), icon: DollarSign, color: 'indigo' },
            { label: 'Average Sale', value: formatCurrency(summary.average_sale_amount), icon: TrendingUp, color: 'pink' },
          ].map((item) => {
            const colorMap: Record<string, string> = {
              blue: 'from-blue-50 to-blue-100 border-blue-200 text-blue-600 bg-blue-200',
              green: 'from-green-50 to-green-100 border-green-200 text-green-600 bg-green-200',
              purple: 'from-purple-50 to-purple-100 border-purple-200 text-purple-600 bg-purple-200',
              indigo: 'from-indigo-50 to-indigo-100 border-indigo-200 text-indigo-600 bg-indigo-200',
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
                    <p className={`text-2xl font-bold mt-1 ${text.replace('600', '900')}`}>{item.value}</p>
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
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nozzle</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Station</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Transactions</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Liters</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Sale</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {nozzles.length > 0 ? (
                nozzles.map((nozzle: any, idx: number) => (
                  <tr
                    key={nozzle.id != null ? `nozzle-${nozzle.id}` : `nozzle-${idx}-${String(nozzle.nozzle_number ?? '')}`}
                    className="hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{nozzle.nozzle_name || nozzle.nozzle_number || 'N/A'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{nozzle.product_name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{nozzle.station_name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{nozzle.total_transactions || 0}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {formatNumber(Number(nozzle.total_liters ?? 0))} L
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                      {formatCurrency(nozzle.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {formatCurrency(nozzle.average_sale_amount)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <Package className="h-12 w-12 text-gray-300 mb-3" />
                      <p className="text-gray-500 font-medium">No sales data found</p>
                      <p className="text-gray-400 text-sm mt-1">Try adjusting the date range or check if sales have been recorded</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {nozzles.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                    {summary.total_transactions ?? nozzles.reduce((s: number, n: any) => s + Number(n.total_transactions ?? 0), 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                    {formatNumber(Number(summary.total_liters ?? nozzles.reduce((s: number, n: any) => s + Number(n.total_liters ?? 0), 0)))} L
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                    {formatCurrency(Number(summary.total_amount ?? nozzles.reduce((s: number, n: any) => s + Number(n.total_amount ?? 0), 0)))}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">—</td>
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
            { label: 'Total amount', value: formatCurrency(totalAmt), icon: DollarSign, color: 'indigo' },
          ].map((item) => {
            const colorMap: Record<string, string> = {
              teal: 'from-teal-50 to-teal-100 border-teal-200 text-teal-600 bg-teal-200',
              blue: 'from-blue-50 to-blue-100 border-blue-200 text-blue-600 bg-blue-200',
              indigo: 'from-indigo-50 to-indigo-100 border-indigo-200 text-indigo-600 bg-indigo-200',
            }
            const colors = colorMap[item.color] || colorMap.teal
            const [gradient, border, text, bg] = colors.split(' ')
            const Icon = item.icon
            return (
              <div key={item.label} className={`bg-gradient-to-br ${gradient} ${border} border rounded-lg p-4 shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className={`text-xs uppercase tracking-wide font-medium ${text}`}>{item.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${text.replace('600', '900')}`}>{item.value}</p>
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
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Station</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Invoices</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rows.length > 0 ? (
                rows.map((r: any, idx: number) => (
                  <tr
                    key={r.station_id != null ? `st-${r.station_id}` : `st-row-${idx}-${String(r.station_name ?? '')}`}
                    className="hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.station_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-800">{r.invoice_count ?? 0}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                      {formatCurrency(r.total ?? 0)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-gray-500">
                    No invoices in this range with a station attached.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800">Totals</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                    {totalInv}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                    {formatCurrency(totalAmt)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
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
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-500 uppercase tracking-wide">Total {isCustomer ? 'Customers' : 'Vendors'}</p>
            <p className="text-2xl font-semibold text-gray-900 mt-2">{entries.length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-500 uppercase tracking-wide">Total {isCustomer ? 'Accounts Receivable' : 'Accounts Payable'}</p>
            <p className={`text-2xl font-semibold mt-2 ${totalPositive >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                      {formatCurrency(Math.abs(totalPositive))}
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-500 uppercase tracking-wide">With {isCustomer ? 'Outstanding' : 'Outstanding'} Balance</p>
            <p className="text-2xl font-semibold text-gray-900 mt-2">
              {entries.filter((e: any) => Number(e.balance) !== 0).length}
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {isCustomer ? 'Customer' : 'Vendor'} #
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {isCustomer ? 'Customer' : 'Vendor'} Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {entries.length > 0 ? (
                entries.map((entry: any, idx: number) => {
                  const balance = Number(entry.balance ?? 0)
                  return (
                    <tr
                      key={
                        entry.id != null
                          ? `${isCustomer ? 'cust' : 'vend'}-${entry.id}`
                          : `${isCustomer ? 'cust' : 'vend'}-${idx}-${String(entry.vendor_number ?? entry.customer_number ?? '')}`
                      }
                      className="hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {isCustomer ? entry.customer_number : entry.vendor_number}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {entry.display_name || entry.company_name || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{entry.email || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{entry.phone || '—'}</td>
                      <td className={`px-4 py-3 text-sm text-right font-semibold ${
                        balance > 0 ? 'text-red-600' : balance < 0 ? 'text-green-600' : 'text-gray-900'
                      }`}>
                        {formatCurrency(Math.abs(balance))}
                        {balance > 0 && isCustomer && <span className="block text-xs text-gray-500 mt-1">(Owed to us)</span>}
                        {balance > 0 && !isCustomer && <span className="block text-xs text-gray-500 mt-1">(We owe)</span>}
                        {balance < 0 && <span className="block text-xs text-gray-500 mt-1">(Credit)</span>}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <Users className="h-12 w-12 text-gray-300 mb-3" />
                      <p className="text-gray-500 font-medium">No {isCustomer ? 'customers' : 'vendors'} found</p>
                      <p className="text-gray-400 text-sm mt-1">
                        {isCustomer ? 'Add customers to see their balances here' : 'Add vendors to see their balances here'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {entries.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                    Sub-total —{' '}
                    {isCustomer ? 'accounts receivable (balance > 0)' : 'accounts payable (balance > 0)'}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">{formatCurrency(totalPositive)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                    Total — net of all listed balances
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-gray-900">{formatCurrency(totalNet)}</td>
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
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Executive Summary</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">Total Sessions</p>
                    <p className="text-2xl font-bold text-blue-900 mt-2">{summary.total_sessions || 0}</p>
                    <p className="text-xs text-blue-600 mt-1">
                      {summary.active_sessions || 0} Active • {summary.closed_sessions || 0} Closed
                    </p>
                  </div>
                  <div className="bg-blue-200 rounded-full p-3">
                    <Users className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-green-600 uppercase tracking-wide">Total Sales</p>
                    <p className="text-2xl font-bold text-green-900 mt-2">
                      {formatCurrency(summary.total_sales)}
                    </p>
                    <p className="text-xs text-green-600 mt-1">
                      {formatNumber(Number(summary.total_liters || 0))} Liters
                    </p>
                  </div>
                  <div className="bg-green-200 rounded-full p-3">
                    <DollarSign className="h-6 w-6 text-green-600" />
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-purple-600 uppercase tracking-wide">Cash Expected</p>
                    <p className="text-2xl font-bold text-purple-900 mt-2">
                      {formatCurrency(summary.total_cash_expected)}
                    </p>
                    <p className="text-xs text-purple-600 mt-1">
                      Counted: {formatCurrency(summary.total_cash_counted || 0)}
                    </p>
                  </div>
                  <div className="bg-purple-200 rounded-full p-3">
                    <TrendingUp className="h-6 w-6 text-purple-600" />
                  </div>
                </div>
              </div>
              
              <div className={`bg-gradient-to-br rounded-lg p-5 shadow-sm border ${
                (summary.total_variance || 0) >= 0 
                  ? 'from-green-50 to-green-100 border-green-200' 
                  : 'from-red-50 to-red-100 border-red-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-xs font-medium uppercase tracking-wide ${
                      (summary.total_variance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      Net Variance
                    </p>
                    <p className={`text-2xl font-bold mt-2 ${
                      (summary.total_variance || 0) >= 0 ? 'text-green-900' : 'text-red-900'
                    }`}>
                      {formatCurrency(Math.abs(summary.total_variance || 0))}
                    </p>
                    <p className={`text-xs mt-1 ${
                      (summary.total_variance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {formatNumber(Number(summary.variance_percentage || 0))}% of expected
                    </p>
                  </div>
                  <div className={`rounded-full p-3 ${
                    (summary.total_variance || 0) >= 0 ? 'bg-green-200' : 'bg-red-200'
                  }`}>
                    <BarChart3 className={`h-6 w-6 ${
                      (summary.total_variance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
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
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Cashier Performance</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(byCashier).map(([cashier, stats]: [string, any], cIdx: number) => (
                <div key={`cashier-${cIdx}-${cashier}`} className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-gray-900 text-lg">{cashier}</h4>
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                      {stats.sessions} {stats.sessions === 1 ? 'Session' : 'Sessions'}
                    </span>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                      <span className="text-sm text-gray-600">Total Sales</span>
                      <span className="text-base font-semibold text-gray-900">
                        {formatCurrency(stats.total_sales)}
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                      <span className="text-sm text-gray-600">Volume</span>
                      <span className="text-base font-semibold text-gray-900">
                        {formatNumber(Number(stats.total_liters || 0))} L
                      </span>
                    </div>
                    
                    {stats.total_cash_sales !== undefined && (
                      <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                        <span className="text-sm text-gray-600">Cash Sales</span>
                        <span className="text-base font-semibold text-green-700">
                          {formatCurrency(stats.total_cash_sales || 0)}
                        </span>
                      </div>
                    )}
                    
                    {stats.total_non_cash_sales !== undefined && (
                      <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                        <span className="text-sm text-gray-600">Non-Cash Sales</span>
                        <span className="text-base font-semibold text-blue-700">
                          {formatCurrency(stats.total_non_cash_sales || 0)}
                        </span>
                      </div>
                    )}
                    
                    <div className="pt-2">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium text-gray-700">Cash Variance</span>
                        <span className={`text-base font-bold ${
                          (stats.cash_variance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {formatCurrency(Math.abs(Number(stats.cash_variance || 0)))}
                        </span>
                      </div>
                      {stats.variance_percentage !== undefined && (
                        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                          <div 
                            className={`h-2 rounded-full ${
                              (stats.cash_variance || 0) >= 0 ? 'bg-green-500' : 'bg-red-500'
                            }`}
                            style={{ 
                              width: `${Math.min(Math.abs(stats.variance_percentage || 0), 100)}%` 
                            }}
                          />
                        </div>
                      )}
                      {stats.variance_percentage !== undefined && (
                        <p className="text-xs text-gray-500 mt-1">
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
            <h3 className="text-lg font-semibold text-gray-900">Session Details</h3>
            {sessions.length > 0 && (
              <span className="text-sm text-gray-500">
                Showing {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
              </span>
            )}
          </div>
          
          {sessions.length > 0 ? (
            <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Cashier</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Station</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Opened</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Closed</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Transactions</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Sales</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Liters</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Cash Expected</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Cash Counted</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Variance</th>
                    <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sessions.map((session: any) => (
                    <tr key={session.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{session.cashier_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">{session.station_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {formatDate(session.opened_at)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatDate(session.opened_at, true).split(', ')[1]}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {session.closed_at ? (
                          <>
                            <div className="text-sm text-gray-900">
                              {formatDate(session.closed_at)}
                            </div>
                            <div className="text-xs text-gray-500">
                              {formatDate(session.closed_at, true).split(', ')[1]}
                            </div>
                          </>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm font-medium text-gray-900">
                          {session.transaction_count || 0}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm font-semibold text-gray-900">
                          {formatCurrency(session.total_sales)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm text-gray-600">
                          {formatNumber(Number(session.total_liters || 0))} L
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm text-gray-700">
                          {formatCurrency(session.cash_expected || 0)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm text-gray-700">
                          {formatCurrency(session.cash_counted || 0)}
                        </span>
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-right`}>
                        <span className={`text-sm font-semibold ${
                          (session.variance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {formatCurrency(session.variance || 0)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                          session.status === 'OPEN' 
                            ? 'bg-green-100 text-green-800 border border-green-200' 
                            : session.status === 'CLOSED'
                            ? 'bg-gray-100 text-gray-800 border border-gray-200'
                            : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                        }`}>
                          {session.status || 'UNKNOWN'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {sessTotals && (
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan={4} className="px-6 py-3 text-right text-sm font-semibold text-gray-800">
                        Totals — all sessions
                      </td>
                      <td className="px-6 py-3 text-right text-sm font-bold tabular-nums text-gray-900">{sessTotals.tx}</td>
                      <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCurrency(sessTotals.sales)}</td>
                      <td className="px-6 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                        {formatNumber(sessTotals.L)} L
                      </td>
                      <td className="px-6 py-3 text-right text-sm font-semibold text-gray-900">{formatCurrency(sessTotals.exp)}</td>
                      <td className="px-6 py-3 text-right text-sm font-semibold text-gray-900">{formatCurrency(sessTotals.cnt)}</td>
                      <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">{formatCurrency(sessTotals.var)}</td>
                      <td className="px-6 py-3" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center">
              <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg font-medium">No shift sessions found</p>
              <p className="text-gray-400 text-sm mt-2">
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

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-medium text-slate-800">How to read this register</p>
          <p className="mt-1 text-slate-600">
            <strong>Book (at dip)</strong> is system stock when the reading was saved. <strong>Stick</strong> is the
            measured volume. <strong>Variance</strong> = stick minus book (gain if positive). Value estimate uses the
            product&apos;s unit price × variance liters (same basis as Tank Dips screen).
          </p>
        </div>

        {summary && Object.keys(summary).length > 0 && (
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">Period summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Readings</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{summary.readings_count ?? 0}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Tanks</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{summary.tanks_with_readings ?? 0}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Gains</p>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{summary.gain_events ?? 0}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Losses</p>
                <p className="text-2xl font-bold text-red-700 mt-1">{summary.loss_events ?? 0}</p>
              </div>
              <div
                className={`rounded-lg border p-4 shadow-sm ${
                  netV >= 0
                    ? 'border-emerald-200 bg-emerald-50/80'
                    : 'border-red-200 bg-red-50/80'
                }`}
              >
                <p
                  className={`text-xs font-medium uppercase tracking-wide ${
                    netV >= 0 ? 'text-emerald-700' : 'text-red-700'
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
            <h4 className="font-semibold text-gray-900 mb-3">By tank</h4>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Tank</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Readings</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Net variance (L)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {byTank.map((row: any, tIdx: number) => (
                    <tr key={row.tank_id ?? row.id ?? `tank-row-${tIdx}-${String(row.tank_name ?? '')}`}>
                      <td className="px-4 py-2 text-gray-900">{row.tank_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{row.readings ?? 0}</td>
                      <td
                        className={`px-4 py-2 text-right font-medium tabular-nums ${
                          Number(row.net_variance_liters ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {Number(row.net_variance_liters ?? 0) >= 0 ? '+' : ''}
                        {formatNumber(Number(row.net_variance_liters ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td className="px-4 py-2 text-right text-xs font-semibold text-gray-800">Totals — all tanks</td>
                    <td className="px-4 py-2 text-right text-xs font-bold tabular-nums text-gray-900">
                      {byTank.reduce((s: number, r: any) => s + Number(r.readings ?? 0), 0)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right text-xs font-bold tabular-nums ${
                        netV >= 0 ? 'text-emerald-800' : 'text-red-800'
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
          <h4 className="font-semibold text-gray-900 mb-3">Dip register (chronological)</h4>
          {entries.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-slate-800 text-white">
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
                <tbody className="divide-y divide-gray-100 bg-white">
                  {entries.map((row: any, idx: number) => {
                    const v = row.variance_liters
                    const hasVar = v != null && v !== ''
                    const vn = hasVar ? Number(v) : null
                    return (
                      <tr key={row.id != null ? `dipreg-${row.id}-${idx}` : `dipreg-${idx}`} className="hover:bg-slate-50/80">
                        <td className="px-3 py-2.5 text-gray-500 tabular-nums">{idx + 1}</td>
                        <td className="px-3 py-2.5 text-gray-900 whitespace-nowrap">
                          {row.dip_date ? formatDate(row.dip_date) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-700">{row.station_name || '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-gray-900">{row.tank_name || '—'}</td>
                        <td className="px-3 py-2.5 text-gray-600">{row.product_name || '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                          {row.book_before_liters != null ? formatNumber(Number(row.book_before_liters)) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                          {formatNumber(Number(row.measured_liters ?? 0))}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-medium tabular-nums ${
                            vn == null ? 'text-gray-500' : vn > 0 ? 'text-emerald-700' : vn < 0 ? 'text-red-700' : 'text-gray-800'
                          }`}
                        >
                          {vn == null ? '—' : `${vn > 0 ? '+' : ''}${formatNumber(vn)}`}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                          {row.variance_pct_of_capacity != null && row.variance_pct_of_capacity !== ''
                            ? `${formatNumber(Number(row.variance_pct_of_capacity))}%`
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                          {row.variance_value_estimate != null && row.variance_value_estimate !== ''
                            ? formatCurrency(row.variance_value_estimate)
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                          {row.water_level_liters != null ? formatNumber(Number(row.water_level_liters)) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 max-w-xs truncate" title={row.notes || ''}>
                          {row.notes || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-slate-100">
                  <tr>
                    <td colSpan={7} className="px-3 py-2.5 text-right text-xs font-bold uppercase text-slate-800">
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
                    <td className="px-3 py-2.5 text-sm text-slate-500">—</td>
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-slate-900">{formatCurrency(entryValSum)}</td>
                    <td colSpan={3} className="px-3 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
              <ClipboardList className="mx-auto h-14 w-14 text-gray-300" />
              <p className="mt-3 text-gray-600 font-medium">No dip readings in this period</p>
              <p className="mt-1 text-sm text-gray-500">Adjust dates or record dips under Operations → Tank Dips.</p>
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
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-medium text-slate-800">Valuation &amp; GL</p>
            <p className="mt-1 text-slate-600">{data.accounting_note}</p>
          </div>
        )}
        
        {/* Summary Section */}
        {summary && Object.keys(summary).length > 0 && (
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 uppercase tracking-wide font-medium">Total Dips</p>
                <p className="text-xl font-bold text-gray-900 mt-1">
                  {summary.total_dips ?? summary.total_readings ?? 0}
                </p>
              </div>
                  <div className="bg-gray-200 rounded-full p-2 ml-2">
                    <Calendar className="h-4 w-4 text-gray-600" />
              </div>
              </div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-green-600 uppercase tracking-wide font-medium">Total Gain (Liters)</p>
                    <p className="text-xl font-bold text-green-900 mt-1">{formatNumber(Number(summary.total_gain_quantity_liters || 0))}L</p>
              </div>
                  <div className="bg-green-200 rounded-full p-2 ml-2">
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-red-100 border border-red-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-red-600 uppercase tracking-wide font-medium">Total Loss (Liters)</p>
                    <p className="text-xl font-bold text-red-900 mt-1">{formatNumber(Number(summary.total_loss_quantity_liters || 0))}L</p>
                  </div>
                  <div className="bg-red-200 rounded-full p-2 ml-2">
                    <TrendingUp className="h-4 w-4 text-red-600 rotate-180" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-green-600 uppercase tracking-wide font-medium">Total Gain (Value)</p>
                    <p className="text-xl font-bold text-green-900 mt-1">{formatCurrency(summary.total_gain_value)}</p>
                  </div>
                  <div className="bg-green-200 rounded-full p-2 ml-2">
                    <DollarSign className="h-4 w-4 text-green-600" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-red-100 border border-red-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-red-600 uppercase tracking-wide font-medium">Total Loss (Value)</p>
                    <p className="text-xl font-bold text-red-900 mt-1">{formatCurrency(summary.total_loss_value)}</p>
                  </div>
                  <div className="bg-red-200 rounded-full p-2 ml-2">
                    <DollarSign className="h-4 w-4 text-red-600" />
                  </div>
                </div>
              </div>
              <div className={`bg-gradient-to-br ${(summary.net_variance_quantity || 0) >= 0 ? 'from-green-50 to-green-100 border-green-200' : 'from-red-50 to-red-100 border-red-200'} border rounded-lg p-4 shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-xs uppercase tracking-wide font-medium ${(summary.net_variance_quantity || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  Net Variance
                </p>
                    <p className={`text-xl font-bold mt-1 ${(summary.net_variance_quantity || 0) >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                      {formatNumber(Number(summary.net_variance_quantity || 0))}L ({formatCurrency(summary.net_variance_value)})
                </p>
                  </div>
                  <div className={`${(summary.net_variance_quantity || 0) >= 0 ? 'bg-green-200' : 'bg-red-200'} rounded-full p-2 ml-2`}>
                    <BarChart3 className={`h-4 w-4 ${(summary.net_variance_quantity || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* By Tank Summary */}
        {Object.keys(byTank).length > 0 && (
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">By Tank</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(byTank).map(([tank, stats]: [string, any], tkIdx: number) => (
                <div key={`tank-card-${tkIdx}-${tank}`} className="border rounded-lg p-4">
                  <h5 className="font-medium text-gray-900">{tank}</h5>
                  <p className="text-sm text-gray-500">{stats.product}</p>
                  <div className="mt-2 space-y-1 text-sm">
                    <p className="text-green-600">Gain: {formatNumber(Number(stats.total_gain_qty || 0))}L ({formatCurrency(stats.total_gain_value || 0)})</p>
                    <p className="text-red-600">Loss: {formatNumber(Number(stats.total_loss_qty || 0))}L ({formatCurrency(stats.total_loss_value || 0)})</p>
                    <p className={`font-medium ${(stats.net_variance_qty || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      Net: {formatNumber(Number(stats.net_variance_qty || 0))}L ({formatCurrency(stats.net_variance_value || 0)})
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dips Table */}
        <div>
          <h4 className="font-semibold text-gray-900 mb-3">Dip Reading Details</h4>
          {dips.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">System Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Measured Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Variance</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase" title="BDT at item cost (fallback: unit price)">
                      Value (cost)
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dips.map((dip: any, idx: number) => {
                    const dateRaw = dip.reading_date ?? dip.dip_date
                    const sys = Number(
                      dip.system_quantity ?? dip.book_volume ?? 0
                    )
                    const meas = Number(dip.measured_quantity ?? dip.dip_volume ?? 0)
                    const vq = Number(dip.variance_quantity ?? dip.variance ?? 0)
                    const vType = dip.variance_type || (vq > 0 ? 'GAIN' : vq < 0 ? 'LOSS' : 'EVEN')
                    return (
                    <tr key={dip.id != null ? `dip-${dip.id}-${idx}` : `dip-${idx}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {dateRaw ? formatDate(dateRaw) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{dip.tank_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{dip.product_name}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 tabular-nums">
                        {formatNumber(sys)}L
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 tabular-nums">
                        {formatNumber(meas)}L
                      </td>
                      <td className={`px-4 py-3 text-sm text-right font-medium tabular-nums ${
                        vType === 'GAIN' ? 'text-green-600' : vType === 'LOSS' ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {vType === 'GAIN' ? '+' : ''}{formatNumber(vq)}L
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 tabular-nums">
                        {formatCurrency(dip.variance_value)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          vType === 'GAIN'
                            ? 'bg-green-100 text-green-800'
                            : vType === 'LOSS'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-700'
                        }`}>
                          {vType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {dip.recorded_by?.trim() ? dip.recorded_by : '—'}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-xs font-semibold text-emerald-800">
                      Sub-total — gains (summary)
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-medium tabular-nums text-emerald-800">
                      +{formatNumber(Number(summary.total_gain_quantity_liters ?? 0))} L
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-medium text-emerald-800">
                      {formatCurrency(Number(summary.total_gain_value ?? 0))}
                    </td>
                    <td colSpan={3} />
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-xs font-semibold text-red-800">
                      Sub-total — losses (summary)
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-medium tabular-nums text-red-800">
                      −{formatNumber(Number(summary.total_loss_quantity_liters ?? 0))} L
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-medium text-red-800">
                      {formatCurrency(Number(summary.total_loss_value ?? 0))}
                    </td>
                    <td colSpan={3} />
                  </tr>
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                      Total — net variance (all dips)
                    </td>
                    <td
                      className={`px-4 py-3 text-right text-sm font-bold tabular-nums ${
                        dipVq >= 0 ? 'text-green-800' : 'text-red-800'
                      }`}
                    >
                      {dipVq >= 0 ? '+' : ''}
                      {formatNumber(dipVq)} L
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">{formatCurrency(dipVval)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center">
              <div className="flex flex-col items-center">
                <TrendingUp className="h-16 w-16 text-gray-300 mb-4" />
                <p className="text-gray-500 text-lg font-medium">No tank dip readings found</p>
                <p className="text-gray-400 text-sm mt-2">
                  Try adjusting the date range or create new dip readings
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const aqBdt = (n: number | string | undefined | null) => formatCurrency(Number(n ?? 0), 'BDT')

  if (reportType === 'aquaculture-pond-pl' && data) {
    const ponds: any[] = Array.isArray(data.ponds) ? data.ponds : []
    const byCat: any[] = Array.isArray(data.expenses_by_category) ? data.expenses_by_category : []
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
        <p className="text-sm font-medium text-slate-700">
          All amounts in <strong>BDT</strong>.
        </p>
        {data.cycle_scope_note ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {String(data.cycle_scope_note)}
          </div>
        ) : null}
        <div>
          <h4 className="font-semibold text-gray-900 mb-2">Pond P&amp;L</h4>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Pond</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Direct exp.</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Shared exp.</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Payroll</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Total costs</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Net profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {ponds.map((p: any) => (
                  <tr key={p.pond_id}>
                    <td className="px-3 py-2 font-medium text-gray-900">{p.pond_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{aqBdt(p.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{aqBdt(p.direct_operating_expenses)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{aqBdt(p.shared_operating_expenses)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{aqBdt(p.payroll_allocated)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{aqBdt(p.total_costs)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{aqBdt(p.profit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100">
                <tr>
                  <td className="px-3 py-2 font-bold text-slate-900">Total — all ponds</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{aqBdt(t.revenue)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">—</td>
                  <td className="px-3 py-2 text-right text-slate-500">—</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{aqBdt(t.payroll_allocated)}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{aqBdt(t.total_costs)}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{aqBdt(t.profit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        {byCat.length > 0 ? (
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Expenses by category (company scope)</h4>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Category</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Amount (BDT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {byCat.map((r: any) => (
                    <tr key={r.category}>
                      <td className="px-3 py-2">{r.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{aqBdt(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100">
                  <tr>
                    <td className="px-3 py-2 font-bold text-slate-900">Sub-total — categories shown</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">
                      {aqBdt(byCat.reduce((s: number, r: any) => s + Number(r.amount || 0), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : null}
        {segments.length > 0 ? (
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Cycle segments (revenue &amp; direct costs)</h4>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Pond</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Cycle</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Revenue</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Direct exp.</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {segments.map((s: any, i: number) => (
                    <tr key={`${s.pond_id}-${s.production_cycle_id ?? 'u'}-${i}`}>
                      <td className="px-3 py-2">{s.pond_name}</td>
                      <td className="px-3 py-2">{s.production_cycle_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{aqBdt(s.revenue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{aqBdt(s.direct_operating_expenses)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{aqBdt(s.segment_margin)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 font-bold text-slate-900">
                      Total — all segments
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">
                      {aqBdt(segments.reduce((s: number, x: any) => s + Number(x.revenue || 0), 0))}
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">
                      {aqBdt(segments.reduce((s: number, x: any) => s + Number(x.direct_operating_expenses || 0), 0))}
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">
                      {aqBdt(segments.reduce((s: number, x: any) => s + Number(x.segment_margin || 0), 0))}
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

  if (
    (reportType === 'aquaculture-fish-sales' ||
      reportType === 'aquaculture-expenses' ||
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
            'Rows are filtered by transaction date within this range.'
          )}
        <p className="text-sm font-medium text-slate-700">
          All amounts in <strong>BDT</strong> where applicable.
        </p>
        {groups.map((g: any) => (
          <div key={`${reportType}-g-${g.pond_id ?? 's'}`} className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-cyan-50/80 px-4 py-2">
              <h4 className="font-semibold text-cyan-950">{g.pond_name}</h4>
            </div>
            <div className="overflow-x-auto p-2">
              <table className="min-w-full text-sm">
                {reportType === 'aquaculture-fish-sales' ? (
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Income type</th>
                      <th className="px-2 py-1">Species</th>
                      <th className="px-2 py-1 text-right">Weight (kg)</th>
                      <th className="px-2 py-1 text-right">Amount (BDT)</th>
                      <th className="px-2 py-1">Buyer</th>
                    </tr>
                  </thead>
                ) : null}
                {reportType === 'aquaculture-expenses' ? (
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Category</th>
                      <th className="px-2 py-1 text-right">Amount (BDT)</th>
                      <th className="px-2 py-1">Vendor</th>
                    </tr>
                  </thead>
                ) : null}
                {reportType === 'aquaculture-sampling' ? (
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Species</th>
                      <th className="px-2 py-1">Est. count</th>
                      <th className="px-2 py-1 text-right">Est. weight (kg)</th>
                      <th className="px-2 py-1">Notes</th>
                    </tr>
                  </thead>
                ) : null}
                {reportType === 'aquaculture-profit-transfers' ? (
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1 text-right">Amount (BDT)</th>
                      <th className="px-2 py-1">Debit → Credit</th>
                      <th className="px-2 py-1">Memo</th>
                    </tr>
                  </thead>
                ) : null}
                <tbody className="divide-y divide-gray-100">
                  {(g.lines || []).map((ln: any) => (
                    <tr key={ln.id}>
                      {reportType === 'aquaculture-fish-sales' ? (
                        <>
                          <td className="px-2 py-1.5 whitespace-nowrap">{ln.sale_date}</td>
                          <td className="px-2 py-1.5">{ln.income_type_label}</td>
                          <td className="px-2 py-1.5">{ln.fish_species_label || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{Number(ln.weight_kg).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{aqBdt(ln.total_amount)}</td>
                          <td className="px-2 py-1.5 text-gray-600">{ln.buyer_name || '—'}</td>
                        </>
                      ) : null}
                      {reportType === 'aquaculture-expenses' ? (
                        <>
                          <td className="px-2 py-1.5 whitespace-nowrap">{ln.expense_date}</td>
                          <td className="px-2 py-1.5">{ln.expense_category_label}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{aqBdt(ln.amount)}</td>
                          <td className="px-2 py-1.5 text-gray-600">{ln.vendor_name || '—'}</td>
                        </>
                      ) : null}
                      {reportType === 'aquaculture-sampling' ? (
                        <>
                          <td className="px-2 py-1.5 whitespace-nowrap">{ln.sample_date}</td>
                          <td className="px-2 py-1.5">{ln.fish_species_label || '—'}</td>
                          <td className="px-2 py-1.5">{ln.estimated_fish_count ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{ln.estimated_total_weight_kg || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-600">{(ln.notes || '').slice(0, 80)}</td>
                        </>
                      ) : null}
                      {reportType === 'aquaculture-profit-transfers' ? (
                        <>
                          <td className="px-2 py-1.5 whitespace-nowrap">{ln.transfer_date}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{aqBdt(ln.amount)}</td>
                          <td className="px-2 py-1.5 text-gray-600">
                            {ln.debit_account_code} → {ln.credit_account_code}
                          </td>
                          <td className="px-2 py-1.5 text-gray-600">{ln.memo || '—'}</td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  {reportType === 'aquaculture-fish-sales' ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-right text-xs font-semibold text-slate-800">
                        Sub-total — {g.pond_name}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-slate-900">
                        {aqBdt(g.subtotal_amount)}
                      </td>
                      <td />
                    </tr>
                  ) : null}
                  {reportType === 'aquaculture-expenses' ? (
                    <tr>
                      <td colSpan={2} className="px-2 py-2 text-right text-xs font-semibold text-slate-800">
                        Sub-total — {g.pond_name}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-slate-900">
                        {aqBdt(g.subtotal_amount)}
                      </td>
                      <td />
                    </tr>
                  ) : null}
                  {reportType === 'aquaculture-sampling' ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-right text-xs font-semibold text-slate-800">
                        Sub-total — {g.pond_name}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-slate-900">
                        {g.subtotal_samples} sample(s)
                      </td>
                    </tr>
                  ) : null}
                  {reportType === 'aquaculture-profit-transfers' ? (
                    <tr>
                      <td className="px-2 py-2 text-right text-xs font-semibold text-slate-800">
                        Sub-total — {g.pond_name}
                      </td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-slate-900">
                        {aqBdt(g.subtotal_amount)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  ) : null}
                </tfoot>
              </table>
            </div>
          </div>
        ))}
        <div className="rounded-lg border-2 border-slate-300 bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap justify-between gap-2 text-sm font-bold text-slate-900">
            <span>Total — all ponds</span>
            <span className="tabular-nums">
              {reportType === 'aquaculture-fish-sales'
                ? aqBdt(totals.total_amount)
                : reportType === 'aquaculture-expenses'
                  ? aqBdt(totals.total_amount)
                  : reportType === 'aquaculture-profit-transfers'
                    ? aqBdt(totals.total_amount)
                    : `Samples: ${totals.sample_count ?? 0}`}
            </span>
          </div>
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
        <p className="text-sm font-medium text-slate-700">
          Production batches — amounts are informational; money columns are <strong>BDT</strong> elsewhere.
        </p>
        {groups.map((g: any) => (
          <div key={`cyc-${g.pond_id}`} className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-cyan-50/80 px-4 py-2">
              <h4 className="font-semibold text-cyan-950">{g.pond_name}</h4>
            </div>
            <div className="overflow-x-auto p-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Start</th>
                    <th className="px-2 py-1">End</th>
                    <th className="px-2 py-1">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(g.lines || []).map((ln: any) => (
                    <tr key={ln.id}>
                      <td className="px-2 py-1.5 font-medium">{ln.name}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{ln.start_date}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{ln.end_date || '—'}</td>
                      <td className="px-2 py-1.5">{ln.is_active ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <td colSpan={3} className="px-2 py-2 text-right text-xs font-semibold text-slate-800">
                      Sub-total — cycles in this pond
                    </td>
                    <td className="px-2 py-2 text-xs font-bold text-slate-900">{g.subtotal_cycles}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}
        <div className="rounded-lg border-2 border-slate-300 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900">
          Total — cycles listed: {totals.cycle_count ?? 0}
        </div>
      </div>
    )
  }

  // Default: JSON view for other reports
  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-yellow-800 font-medium">Report format not yet implemented</p>
        <p className="text-yellow-600 text-sm mt-1">This report is displaying raw data. A formatted view will be available soon.</p>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-auto max-h-96">
        <pre className="text-sm text-gray-700 font-mono">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  )
}
