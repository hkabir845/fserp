'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import { useCompany } from '@/contexts/CompanyContext'
import { FinancialAnalyticsPanel } from './FinancialAnalyticsPanel'

/** Re-read saved site filter when tenant or tab context changes (Reports page clears stale ids on switch). */
function FinancialAnalyticsWithStationSync() {
  const { selectedCompany } = useCompany()
  const [reportStationKey, setReportStationKey] = useState('')
  useEffect(() => {
    const sync = () => setReportStationKey(localStorage.getItem('fserp_report_station_id')?.trim() ?? '')
    sync()
    const onVis = () => {
      if (document.visibilityState === 'visible') sync()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [selectedCompany?.id])
  return <FinancialAnalyticsPanel reportStationKey={reportStationKey} />
}

export default function FinancialAnalyticsPage() {
  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="min-h-0 flex-1 overflow-auto app-scroll-pad">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
            <p className="mt-1 text-gray-600">
              Analytics and KPIs — sales, purchases, cash movement, and income-statement metrics for the
              selected period.
            </p>
            <Link
              href="/reports"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to report list
            </Link>
          </div>

          <FinancialAnalyticsWithStationSync />
        </div>
      </div>
    </div>
  )
}
