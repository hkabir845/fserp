'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider, useCompany } from '@/contexts/CompanyContext'
import SubscriptionLedger from '@/components/SubscriptionLedger'
import { useToast } from '@/components/Toast'
import { Receipt, Info } from 'lucide-react'
import { safeLogError } from '@/utils/connectionError'
import { useRequireSaasDashboardMode } from '@/hooks/useRequireSaasDashboardMode'

function SubscriptionLedgerPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  useRequireSaasDashboardMode()
  const { mode } = useCompany()
  const companyIdParam = searchParams.get('company_id')
  const initialCompanyId =
    companyIdParam != null && companyIdParam !== '' && !Number.isNaN(parseInt(companyIdParam, 10))
      ? parseInt(companyIdParam, 10)
      : undefined

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }

    // Get user role
    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const user = JSON.parse(userStr)
        const role = user.role?.toLowerCase() || null
        
        // Only allow SUPER_ADMIN to access this page
        if (role !== 'super_admin') {
          toast.error('Access denied. Super Admin access required.')
          router.push('/dashboard')
          return
        }
      } catch (error) {
        safeLogError('Error parsing user data:', error)
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, router])

  return (
    <div className="page-with-sidebar flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          {/* Header Section - Removed duplicate header since SubscriptionLedger component has its own */}

          {/* Info Banner - How SaaS Subscription Billing Works */}
          <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <Info className="h-6 w-6 text-blue-600 mt-0.5" />
              </div>
              <div className="ml-4 flex-1">
                <h3 className="text-lg font-semibold text-blue-900 mb-3">How SaaS Subscription Billing Works</h3>
                <div className="space-y-3 text-sm text-blue-800">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-semibold mb-2">📋 Subscription Invoicing</h4>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Create invoices for tenant subscriptions (monthly, quarterly, yearly)</li>
                        <li>Automatic discount calculation based on billing cycle</li>
                        <li>Track payment periods and due dates</li>
                        <li>Apply discounts for upfront/annual payments</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2">💰 Payment Management</h4>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Record payments when tenants pay invoices</li>
                        <li>Track payment status (pending, paid, overdue)</li>
                        <li>Monitor outstanding balances per tenant</li>
                        <li>Generate payment history reports</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2">📊 Financial Tracking</h4>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Total subscription revenue received</li>
                        <li>Outstanding payments due from tenants</li>
                        <li>Total billed vs. total paid per company</li>
                        <li>Revenue analytics and forecasting</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2">🎯 Billing Cycles</h4>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li><strong>Monthly:</strong> No discount, billed every month</li>
                        <li><strong>Quarterly:</strong> 5% discount for upfront payment</li>
                        <li><strong>Half-Yearly:</strong> 10% discount for upfront payment</li>
                        <li><strong>Annual:</strong> 15% discount for upfront payment</li>
                      </ul>
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-blue-100 rounded border border-blue-200">
                    <p className="font-semibold text-blue-900">💡 Best Practice:</p>
                    <p className="text-blue-800">
                      Create invoices at the start of each billing period. Mark them as paid when tenants make payments. 
                      Use the filters to track overdue invoices and follow up with tenants on outstanding balances.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Subscription Ledger Component */}
          <div className="bg-white rounded-lg shadow p-6">
            <SubscriptionLedger initialCompanyId={initialCompanyId} />
          </div>
        </div>
      </div>
    </div>
  )
}

function SubscriptionLedgerPageFallback() {
  return (
    <div className="flex h-screen bg-gray-50 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
    </div>
  )
}

export default function SubscriptionLedgerPage() {
  return (
    <CompanyProvider>
      <Suspense fallback={<SubscriptionLedgerPageFallback />}>
        <SubscriptionLedgerPageContent />
      </Suspense>
    </CompanyProvider>
  )
}
