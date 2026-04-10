'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { useCompany } from '@/contexts/CompanyContext'
import { 
  FileText, TrendingUp, DollarSign, Users, Package, 
  BarChart3, Calendar, Download, Filter, RefreshCw, Printer,
  Gauge, Droplet, ClipboardList
} from 'lucide-react'
import api from '@/lib/api'
import { formatDate, formatDateOnly, formatDateRange, localDateISO, toDateInputValue } from '@/utils/date'
import { formatCurrency, formatNumber } from '@/utils/formatting'
import { escapeHtml, printDocument } from '@/utils/printDocument'

type ReportType = 
  | 'trial-balance'
  | 'balance-sheet'
  | 'income-statement'
  | 'customer-balances'
  | 'vendor-balances'
  | 'fuel-sales'
  | 'tank-inventory'
  | 'shift-summary'
  | 'tank-dip-variance'
  | 'tank-dip-register'
  | 'meter-readings'
  | 'sales-by-nozzle'
  | 'daily-summary'

interface ReportCard {
  id: ReportType
  title: string
  description: string
  icon: React.ElementType
  category: 'financial' | 'operational' | 'analytical'
}

const reports: ReportCard[] = [
  // Financial Reports (QuickBooks-Style)
  {
    id: 'trial-balance',
    title: 'Trial Balance',
    description: 'All accounts with debits and credits',
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
    description: 'Income and Expenses summary',
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
  }
]

const SUMMARY_EXCLUDED_REPORTS: ReportType[] = [
  'daily-summary',
  'shift-summary',
  'sales-by-nozzle',
  'tank-dip-variance',
  'tank-dip-register',
  'meter-readings',
];

export default function ReportsPage() {
  const router = useRouter()
  const { selectedCompany } = useCompany()
  /** Legal / display name for print & CSV — from API (same tenant as reports). */
  const [reportCompanyLabel, setReportCompanyLabel] = useState('')
  const [selectedReport, setSelectedReport] = useState<ReportType | null>(null)
  const [reportData, setReportData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState({
    startDate: localDateISO(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    endDate: localDateISO(),
  })
  const [filterCategory, setFilterCategory] = useState<'all' | 'financial' | 'operational' | 'analytical'>('all')
  
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

  const resolveReportCompanyName = () =>
    reportCompanyLabel.trim() ||
    (selectedCompany?.name && String(selectedCompany.name).trim()) ||
    (typeof window !== 'undefined' ? (localStorage.getItem('company_name') || '').trim() : '') ||
    'Company'

  // Get user role from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const userStr = localStorage.getItem('user')
      if (userStr && userStr !== 'undefined' && userStr !== 'null') {
        try {
          const parsedUser = JSON.parse(userStr)
          if (parsedUser && typeof parsedUser === 'object') {
            setUserRole(parsedUser.role?.toLowerCase() || null)
          }
        } catch (error) {
          console.error('Error parsing user data:', error)
        }
      }
    }
  }, [])
  
  // Filter reports based on user role and category
  const getFilteredReports = () => {
    let roleFilteredReports = reports
    
    // First filter by role
    if (userRole === 'cashier') {
      // Cashiers see only: Sales and Stock reports
      roleFilteredReports = reports.filter(report => 
        report.id === 'fuel-sales' ||
        report.id === 'sales-by-nozzle' ||
        report.id === 'shift-summary' ||
        report.id === 'tank-inventory' ||
        report.id === 'tank-dip-register' ||
        report.id === 'daily-summary'
      )
    }
    
    // Then filter by category
    if (filterCategory === 'all') {
      return roleFilteredReports
    }
    return roleFilteredReports.filter(r => r.category === filterCategory)
  }
  
  const filteredReports = getFilteredReports()

  const fetchReport = useCallback(async (reportId: ReportType) => {
    setLoading(true)
    setReportData(null) // Clear previous data

    const params: Record<string, string> = {}
    const withPeriod = new Set<ReportType>([
      'trial-balance',
      'balance-sheet',
      'income-statement',
      'customer-balances',
      'vendor-balances',
      'daily-summary',
      'shift-summary',
      'sales-by-nozzle',
      'fuel-sales',
      'tank-inventory',
      'tank-dip-variance',
      'tank-dip-register',
      'meter-readings',
    ])
    if (withPeriod.has(reportId)) {
      params.start_date = dateRange.startDate
      params.end_date = dateRange.endDate
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
  }, [dateRange, router])
  
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
  
  // Keep backward compatibility with meter-readings specific handler
  const handleMeterReadingsDateChange = useCallback((field: 'startDate' | 'endDate', value: string) => {
    handleReportDateChange(field, value, 'meter-readings')
  }, [handleReportDateChange])

  const printReport = () => {
    if (!reportData || !selectedReport) return

    const reportTitle = reports.find(r => r.id === selectedReport)?.title || selectedReport
    const companyName = resolveReportCompanyName()
    
    // Generate HTML content from report data
    let contentHTML = ''
    
    // Add summary if available
    if (reportData.summary && Object.keys(reportData.summary).length > 0 && !SUMMARY_EXCLUDED_REPORTS.includes(selectedReport)) {
      contentHTML += '<div class="summary"><h2>Summary</h2><table>'
      Object.entries(reportData.summary).forEach(([key, value]) => {
        const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
        const formattedValue = typeof value === 'number' 
          ? (key.includes('amount') || key.includes('value') || key.includes('sales') ? `$${Number(value).toFixed(2)}` : Number(value).toLocaleString())
          : String(value)
        contentHTML += `<tr><td><strong>${formattedKey}:</strong></td><td>${formattedValue}</td></tr>`
      })
      contentHTML += '</table></div>'
    }
    
    // Generate table based on report type
    if (selectedReport === 'trial-balance' && reportData.accounts) {
      contentHTML += '<h2>Accounts</h2><table><thead><tr><th>Account Code</th><th>Account Name</th><th>Type</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead><tbody>'
      reportData.accounts.forEach((acc: any) => {
        contentHTML += `<tr><td>${acc.account_code || ''}</td><td>${acc.account_name || ''}</td><td>${acc.account_type || ''}</td><td style="text-align:right">$${Number(acc.debit || 0).toFixed(2)}</td><td style="text-align:right">$${Number(acc.credit || 0).toFixed(2)}</td><td style="text-align:right">$${Number(acc.balance || 0).toFixed(2)}</td></tr>`
      })
      contentHTML += `<tfoot><tr><td colspan="3"><strong>Totals:</strong></td><td style="text-align:right"><strong>$${Number(reportData.total_debit || 0).toFixed(2)}</strong></td><td style="text-align:right"><strong>$${Number(reportData.total_credit || 0).toFixed(2)}</strong></td><td style="text-align:right"><strong>$${Number((reportData.total_debit || 0) - (reportData.total_credit || 0)).toFixed(2)}</strong></td></tr></tfoot></tbody></table>`
    } else if (selectedReport === 'balance-sheet') {
      const sections = [
        { title: 'Assets', data: reportData.assets },
        { title: 'Liabilities', data: reportData.liabilities },
        { title: 'Equity', data: reportData.equity }
      ]
      sections.forEach(section => {
        if (section.data?.accounts?.length > 0) {
          contentHTML += `<h2>${section.title}</h2><p><strong>Total: $${Number(section.data.total || 0).toFixed(2)}</strong></p><table><thead><tr><th>Account Code</th><th>Account Name</th><th style="text-align:right">Balance</th></tr></thead><tbody>`
          section.data.accounts.forEach((acc: any) => {
            contentHTML += `<tr><td>${acc.account_code || ''}</td><td>${acc.account_name || ''}</td><td style="text-align:right">$${Number(acc.balance || 0).toFixed(2)}</td></tr>`
          })
          contentHTML += '</tbody></table>'
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
          contentHTML += `<h2>${section.title}</h2><p><strong>Total: $${Number(section.data.total || 0).toFixed(2)}</strong></p><table><thead><tr><th>Account Code</th><th>Account Name</th><th style="text-align:right">Balance</th></tr></thead><tbody>`
          section.data.accounts.forEach((acc: any) => {
            contentHTML += `<tr><td>${acc.account_code || ''}</td><td>${acc.account_name || ''}</td><td style="text-align:right">$${Number(acc.balance || 0).toFixed(2)}</td></tr>`
          })
          contentHTML += '</tbody></table>'
        }
      })
      contentHTML += `<div class="summary"><h2>Summary</h2><p><strong>Gross Profit:</strong> $${Number(reportData.gross_profit || 0).toFixed(2)}</p><p><strong>Net Income:</strong> $${Number(reportData.net_income || 0).toFixed(2)}</p></div>`
    } else if ((selectedReport === 'customer-balances' || selectedReport === 'vendor-balances') && reportData.customers || reportData.vendors) {
      const entries = reportData.customers || reportData.vendors || []
      const type = selectedReport === 'customer-balances' ? 'Customer' : 'Vendor'
      contentHTML += `<h2>${type} Balances</h2><table><thead><tr><th>${type} #</th><th>${type} Name</th><th>Email</th><th>Phone</th><th style="text-align:right">Balance</th></tr></thead><tbody>`
      entries.forEach((entry: any) => {
        contentHTML += `<tr><td>${entry.customer_number || entry.vendor_number || ''}</td><td>${entry.display_name || entry.company_name || ''}</td><td>${entry.email || '—'}</td><td>${entry.phone || '—'}</td><td style="text-align:right">$${Math.abs(Number(entry.balance || 0)).toFixed(2)}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'meter-readings' && reportData.meters) {
      contentHTML += '<h2>Meter Details</h2><table><thead><tr><th>Meter Number</th><th>Meter Name</th><th style="text-align:right">Opening</th><th style="text-align:right">Closing</th><th style="text-align:right">Dispensed</th><th style="text-align:right">Sales</th><th style="text-align:right">Liters</th><th style="text-align:right">Amount</th></tr></thead><tbody>'
      reportData.meters.forEach((meter: any) => {
        contentHTML += `<tr><td>${meter.meter_number || ''}</td><td>${meter.meter_name || ''}</td><td style="text-align:right">${Number(meter.opening_reading || 0).toFixed(2)}L</td><td style="text-align:right">${Number(meter.closing_reading || 0).toFixed(2)}L</td><td style="text-align:right">${Number(meter.period_dispensed || 0).toFixed(2)}L</td><td style="text-align:right">${meter.total_sales || 0}</td><td style="text-align:right">${Number(meter.total_liters || 0).toFixed(2)}L</td><td style="text-align:right">$${Number(meter.total_amount || 0).toFixed(2)}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'sales-by-nozzle' && reportData.nozzles) {
      contentHTML += '<h2>Sales by Nozzle</h2><table><thead><tr><th>Nozzle</th><th>Product</th><th>Station</th><th style="text-align:right">Transactions</th><th style="text-align:right">Liters</th><th style="text-align:right">Amount</th><th style="text-align:right">Avg Sale</th></tr></thead><tbody>'
      reportData.nozzles.forEach((nozzle: any) => {
        contentHTML += `<tr><td>${nozzle.nozzle_name || nozzle.nozzle_number || ''}</td><td>${nozzle.product_name || ''}</td><td>${nozzle.station_name || ''}</td><td style="text-align:right">${nozzle.total_transactions || 0}</td><td style="text-align:right">${Number(nozzle.total_liters || 0).toFixed(2)}L</td><td style="text-align:right">$${Number(nozzle.total_amount || 0).toFixed(2)}</td><td style="text-align:right">$${Number(nozzle.average_sale_amount || 0).toFixed(2)}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'tank-inventory' && reportData.inventory) {
      contentHTML += '<h2>Tank Inventory</h2><table><thead><tr><th>Tank</th><th>Station</th><th>Product</th><th style="text-align:right">Capacity (L)</th><th style="text-align:right">Stock (L)</th><th style="text-align:right">Fill %</th><th>Needs Refill</th></tr></thead><tbody>'
      reportData.inventory.forEach((tank: any) => {
        contentHTML += `<tr><td>${tank.tank_name || ''}</td><td>${tank.station_name || ''}</td><td>${tank.product_name || ''}</td><td style="text-align:right">${Number(tank.capacity || 0).toLocaleString()}</td><td style="text-align:right">${Number(tank.current_stock || 0).toLocaleString()}</td><td style="text-align:right">${Number(tank.fill_percentage || 0).toFixed(1)}%</td><td>${tank.needs_refill ? 'Yes' : 'No'}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'shift-summary' && reportData.sessions) {
      contentHTML += '<h2>Session Details</h2><table><thead><tr><th>Cashier</th><th>Station</th><th>Opened</th><th>Closed</th><th style="text-align:right">Transactions</th><th style="text-align:right">Sales</th><th style="text-align:right">Liters</th><th style="text-align:right">Cash Expected</th><th style="text-align:right">Cash Counted</th><th style="text-align:right">Variance</th><th>Status</th></tr></thead><tbody>'
      reportData.sessions.forEach((session: any) => {
        const openedDate = formatDate(session.opened_at, true)
        const closedDate = session.closed_at ? formatDate(session.closed_at, true) : '—'
        contentHTML += `<tr><td>${session.cashier_name || ''}</td><td>${session.station_name || ''}</td><td>${openedDate}</td><td>${closedDate}</td><td style="text-align:right">${session.transaction_count || 0}</td><td style="text-align:right">$${Number(session.total_sales || 0).toFixed(2)}</td><td style="text-align:right">${Number(session.total_liters || 0).toFixed(2)}L</td><td style="text-align:right">$${Number(session.cash_expected || 0).toFixed(2)}</td><td style="text-align:right">$${Number(session.cash_counted || 0).toFixed(2)}</td><td style="text-align:right">$${Number(session.variance || 0).toFixed(2)}</td><td>${session.status || ''}</td></tr>`
      })
      contentHTML += '</tbody></table>'
    } else if (selectedReport === 'tank-dip-register' && reportData.entries) {
      contentHTML += '<h2>Tank Dip Register</h2><table><thead><tr><th>#</th><th>Date</th><th>Station</th><th>Tank</th><th>Product</th><th style="text-align:right">Book (L)</th><th style="text-align:right">Stick (L)</th><th style="text-align:right">Variance (L)</th><th style="text-align:right">% Cap</th><th style="text-align:right">Est. value</th><th>Notes</th></tr></thead><tbody>'
      ;(reportData.entries as any[]).forEach((row: any, idx: number) => {
        const d = row.dip_date ? formatDate(row.dip_date) : ''
        const book = row.book_before_liters != null ? Number(row.book_before_liters).toFixed(2) : '—'
        const varL = row.variance_liters != null ? Number(row.variance_liters).toFixed(2) : '—'
        const pct = row.variance_pct_of_capacity != null ? `${Number(row.variance_pct_of_capacity).toFixed(2)}%` : '—'
        const val = row.variance_value_estimate != null ? formatCurrency(row.variance_value_estimate) : '—'
        contentHTML += `<tr><td>${idx + 1}</td><td>${d}</td><td>${row.station_name || ''}</td><td>${row.tank_name || ''}</td><td>${row.product_name || ''}</td><td style="text-align:right">${book}</td><td style="text-align:right">${Number(row.measured_liters || 0).toFixed(2)}</td><td style="text-align:right">${varL}</td><td style="text-align:right">${pct}</td><td style="text-align:right">${val}</td><td>${(row.notes || '').replace(/</g, '')}</td></tr>`
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
        contentHTML += `<tr><td>${date}</td><td>${dip.tank_name || ''}</td><td>${dip.product_name || ''}</td><td style="text-align:right">${sys.toFixed(2)}</td><td style="text-align:right">${meas.toFixed(2)}</td><td style="text-align:right">${vt === 'GAIN' ? '+' : ''}${vq.toFixed(2)}</td><td style="text-align:right">${formatCurrency(dip.variance_value)}</td><td>${vt}</td><td>${dip.recorded_by || '—'}</td></tr>`
      })
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

    const ok = printDocument({
      title: reportTitle,
      bodyHtml: `
          <h1>${escapeHtml(reportTitle)}</h1>
          <div class="period">
            <strong>Company:</strong> ${escapeHtml(companyName)}<br>
            <strong>Generated:</strong> ${escapeHtml(formatDate(new Date(), true))}<br>
            ${periodLine}
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
      } else if (selectedReport === 'tank-inventory' && reportData.inventory) {
        csvContent += 'Tank,Station,Product,Capacity (L),Current Stock (L),Fill %,Needs Refill\n'
        reportData.inventory.forEach((tank: any) => {
          csvContent += `${escapeCsv(tank.tank_name)},${escapeCsv(tank.station_name)},${escapeCsv(tank.product_name)},${tank.capacity || 0},${tank.current_stock || 0},${Number(tank.fill_percentage || 0).toFixed(1)},${tank.needs_refill ? 'Yes' : 'No'}\n`
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
      <div className="flex-1 overflow-auto p-8">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
              <p className="text-gray-600 mt-1">Generate comprehensive business and operational reports</p>
            </div>
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
                onClick={() => setFilterCategory('analytical')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filterCategory === 'analytical' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Analytical
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Report Cards */}
            <div className="lg:col-span-1 space-y-3">
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
                          'bg-purple-100 text-purple-700'
                        }`}>
                          {report.category.charAt(0).toUpperCase() + report.category.slice(1)}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Report Display */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg border border-gray-200 min-h-[600px]">
                {loading ? (
                  <div className="flex items-center justify-center h-[600px]">
                    <div className="text-center">
                      <RefreshCw className="h-12 w-12 text-blue-500 animate-spin mx-auto mb-4" />
                      <p className="text-gray-600">Loading report...</p>
                    </div>
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

                    {/* Report Content */}
                    <div className="space-y-6">
                      {/* Summary Section */}
                      {reportData.summary &&
                        (!selectedReport || !SUMMARY_EXCLUDED_REPORTS.includes(selectedReport)) ? (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-3">Summary</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {Object.entries(reportData.summary as Record<string, unknown>).map(([key, value], idx) => {
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
                                <div key={key} className={`bg-gradient-to-br ${colorClass} border rounded-lg p-4 shadow-sm`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                      <p className={`text-xs uppercase tracking-wide font-medium ${colorClass.split(' ')[2]}`}>
                                  {key.replace(/_/g, ' ')}
                                </p>
                                      <p className={`text-xl font-bold mt-1 ${colorClass.split(' ')[2].replace('600', '900')}`}>
                                  {typeof value === 'number' ? (
                                    key.includes('percentage') ? `${Number(value).toFixed(2)}%` :
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
                      {renderReportTable(selectedReport, reportData, dateRange, setDateRange, fetchReport, handleReportDateChange)}

                      {/* Alerts */}
                      {reportData.alerts && reportData.alerts.low_stock_tanks && reportData.alerts.low_stock_tanks.length > 0 && (
                        <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                          <h4 className="font-semibold text-red-800 mb-2">⚠️ Low Stock Alerts</h4>
                          <ul className="space-y-1">
                            {reportData.alerts.low_stock_tanks.map((tank: any, idx: number) => (
                              <li key={idx} className="text-sm text-red-700">
                                {tank.tank_name} ({tank.product}): {Number(tank.fill_percentage).toFixed(1)}% full
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

function renderReportTable(
  reportType: ReportType,
  data: any,
  dateRange?: { startDate: string; endDate: string },
  setDateRange?: (range: { startDate: string; endDate: string }) => void,
  fetchReport?: (reportId: ReportType) => Promise<void>,
  handleReportDateChange?: (field: 'startDate' | 'endDate', value: string, reportId?: ReportType) => void
) {
  // Period-based reports that should show editable filters
  const periodBasedReports = new Set<ReportType>([
    'trial-balance',
    'balance-sheet',
    'income-statement',
    'customer-balances',
    'vendor-balances',
    'daily-summary',
    'shift-summary',
    'sales-by-nozzle',
    'fuel-sales',
    'tank-inventory',
    'tank-dip-variance',
    'tank-dip-register',
    'meter-readings'
  ])
  
  // Get period info if available
  const period = data?.period || {}
  const hasPeriod = periodBasedReports.has(reportType) && (period.start_date || period.end_date || dateRange?.startDate || dateRange?.endDate)
  
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
                    <p className="text-xl font-bold text-blue-900 mt-1">{Number(summary.total_liters_dispensed || 0).toFixed(2)}L</p>
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
                      <tr key={meter.meter_number || index} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{meter.meter_number || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{meter.meter_name || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {openingReading.toFixed(2)}L
                          {meter.opening_reading_date && (
                            <span className="block text-xs text-gray-400 mt-1">
                              {formatDate(meter.opening_reading_date)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                          {closingReading.toFixed(2)}L
                          {meter.closing_reading_date && (
                            <span className="block text-xs text-gray-400 mt-1">
                              {formatDateOnly(meter.closing_reading_date)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-blue-600 font-medium">
                          {periodDispensed.toFixed(2)}L
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {meter.total_sales || 0}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {Number(meter.total_liters || 0).toFixed(2)}L
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
              { label: 'Total Liters', value: `${Number(summary.total_liters ?? 0).toFixed(2)} L`, icon: Droplet, color: 'blue' },
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
                  {Object.entries(byProduct as Record<string, { transactions?: number; liters?: number; amount?: number }>).map(([product, metrics]) => (
                    <tr key={product}>
                      <td className="px-4 py-3 text-sm text-gray-900">{product}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">{metrics.transactions}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">
                        {Number(metrics.liters ?? 0).toFixed(2)} L
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">
                        ${Number(metrics.amount ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
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
                        {Number(tank.fill_percentage ?? 0).toFixed(1)}%
                      </td>
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
                  (payload?.accounts ?? []).map((account: any) => (
                    <div
                      key={account.account_code}
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
                  (payload?.accounts ?? []).map((account: any) => (
                    <div key={account.account_code} className="px-4 py-3 flex justify-between hover:bg-gray-50 transition-colors">
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
                 item.format === 'liters' ? `${item.value.toFixed(2)} L` :
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
                      {Number(tank.fill_percentage ?? 0).toFixed(1)}%
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
          </table>
        </div>
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
            { label: 'Total Liters', value: `${Number(summary.total_liters ?? 0).toFixed(2)} L`, icon: Droplet, color: 'purple' },
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
                  <tr key={nozzle.nozzle_number || idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{nozzle.nozzle_name || nozzle.nozzle_number || 'N/A'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{nozzle.product_name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{nozzle.station_name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{nozzle.total_transactions || 0}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {Number(nozzle.total_liters ?? 0).toFixed(2)} L
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
          </table>
        </div>
      </div>
    )
  }

  // Customer & Vendor Balances
  if ((reportType === 'customer-balances' || reportType === 'vendor-balances') && data) {
    const isCustomer = reportType === 'customer-balances'
    const entries = Array.isArray(data.customers) ? data.customers : (Array.isArray(data.vendors) ? data.vendors : (Array.isArray(data) ? data : []))
    const totalBalance = isCustomer ? (data?.total_ar || entries.reduce((sum: number, entry: any) => sum + (Number(entry.balance) || 0), 0)) : (data?.total_ap || entries.reduce((sum: number, entry: any) => sum + (Number(entry.balance) || 0), 0))
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
            <p className={`text-2xl font-semibold mt-2 ${totalBalance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                      {formatCurrency(Math.abs(totalBalance))}
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
                    <tr key={entry.vendor_number || entry.customer_number || idx} className="hover:bg-gray-50">
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
                      {Number(summary.total_liters || 0).toFixed(2)} Liters
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
                      Counted: ${Number(summary.total_cash_counted || 0).toFixed(2)}
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
                      {Number(summary.variance_percentage || 0).toFixed(2)}% of expected
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
              {Object.entries(byCashier).map(([cashier, stats]: [string, any]) => (
                <div key={cashier} className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow">
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
                        {Number(stats.total_liters || 0).toFixed(2)} L
                      </span>
                    </div>
                    
                    {stats.total_cash_sales !== undefined && (
                      <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                        <span className="text-sm text-gray-600">Cash Sales</span>
                        <span className="text-base font-semibold text-green-700">
                          ${Number(stats.total_cash_sales || 0).toFixed(2)}
                        </span>
                      </div>
                    )}
                    
                    {stats.total_non_cash_sales !== undefined && (
                      <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                        <span className="text-sm text-gray-600">Non-Cash Sales</span>
                        <span className="text-base font-semibold text-blue-700">
                          ${Number(stats.total_non_cash_sales || 0).toFixed(2)}
                        </span>
                      </div>
                    )}
                    
                    <div className="pt-2">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium text-gray-700">Cash Variance</span>
                        <span className={`text-base font-bold ${
                          (stats.cash_variance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          ${Math.abs(Number(stats.cash_variance || 0)).toFixed(2)}
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
                          {Number(stats.variance_percentage || 0).toFixed(2)}% variance rate
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
                          {Number(session.total_liters || 0).toFixed(2)} L
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm text-gray-700">
                          ${Number(session.cash_expected || 0).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm text-gray-700">
                          ${Number(session.cash_counted || 0).toFixed(2)}
                        </span>
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-right`}>
                        <span className={`text-sm font-semibold ${
                          (session.variance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {(session.variance || 0) >= 0 ? '+' : ''}${Number(session.variance || 0).toFixed(2)}
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
                  {netV.toFixed(2)} L
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
                  {byTank.map((row: any) => (
                    <tr key={row.tank_name}>
                      <td className="px-4 py-2 text-gray-900">{row.tank_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{row.readings ?? 0}</td>
                      <td
                        className={`px-4 py-2 text-right font-medium tabular-nums ${
                          Number(row.net_variance_liters ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {Number(row.net_variance_liters ?? 0) >= 0 ? '+' : ''}
                        {Number(row.net_variance_liters ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
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
                      <tr key={row.id ?? idx} className="hover:bg-slate-50/80">
                        <td className="px-3 py-2.5 text-gray-500 tabular-nums">{idx + 1}</td>
                        <td className="px-3 py-2.5 text-gray-900 whitespace-nowrap">
                          {row.dip_date ? formatDate(row.dip_date) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-700">{row.station_name || '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-gray-900">{row.tank_name || '—'}</td>
                        <td className="px-3 py-2.5 text-gray-600">{row.product_name || '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                          {row.book_before_liters != null ? Number(row.book_before_liters).toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                          {Number(row.measured_liters ?? 0).toFixed(2)}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-medium tabular-nums ${
                            vn == null ? 'text-gray-500' : vn > 0 ? 'text-emerald-700' : vn < 0 ? 'text-red-700' : 'text-gray-800'
                          }`}
                        >
                          {vn == null ? '—' : `${vn > 0 ? '+' : ''}${vn.toFixed(2)}`}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                          {row.variance_pct_of_capacity != null && row.variance_pct_of_capacity !== ''
                            ? `${Number(row.variance_pct_of_capacity).toFixed(2)}%`
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                          {row.variance_value_estimate != null && row.variance_value_estimate !== ''
                            ? formatCurrency(row.variance_value_estimate)
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                          {row.water_level_liters != null ? Number(row.water_level_liters).toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 max-w-xs truncate" title={row.notes || ''}>
                          {row.notes || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
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
                    <p className="text-xl font-bold text-green-900 mt-1">{Number(summary.total_gain_quantity_liters || 0).toFixed(2)}L</p>
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
                    <p className="text-xl font-bold text-red-900 mt-1">{Number(summary.total_loss_quantity_liters || 0).toFixed(2)}L</p>
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
                      {Number(summary.net_variance_quantity || 0).toFixed(2)}L ({formatCurrency(summary.net_variance_value)})
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
              {Object.entries(byTank).map(([tank, stats]: [string, any]) => (
                <div key={tank} className="border rounded-lg p-4">
                  <h5 className="font-medium text-gray-900">{tank}</h5>
                  <p className="text-sm text-gray-500">{stats.product}</p>
                  <div className="mt-2 space-y-1 text-sm">
                    <p className="text-green-600">Gain: {Number(stats.total_gain_qty || 0).toFixed(2)}L (${Number(stats.total_gain_value || 0).toFixed(2)})</p>
                    <p className="text-red-600">Loss: {Number(stats.total_loss_qty || 0).toFixed(2)}L (${Number(stats.total_loss_value || 0).toFixed(2)})</p>
                    <p className={`font-medium ${(stats.net_variance_qty || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      Net: {Number(stats.net_variance_qty || 0).toFixed(2)}L (${Number(stats.net_variance_value || 0).toFixed(2)})
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
                    <tr key={dip.id ?? idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {dateRaw ? formatDate(dateRaw) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{dip.tank_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{dip.product_name}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 tabular-nums">
                        {sys.toFixed(2)}L
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 tabular-nums">
                        {meas.toFixed(2)}L
                      </td>
                      <td className={`px-4 py-3 text-sm text-right font-medium tabular-nums ${
                        vType === 'GAIN' ? 'text-green-600' : vType === 'LOSS' ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {vType === 'GAIN' ? '+' : ''}{vq.toFixed(2)}L
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
