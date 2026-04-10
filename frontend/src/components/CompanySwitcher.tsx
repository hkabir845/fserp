'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Building2, Crown, Shield } from 'lucide-react'
import { useCompany } from '@/contexts/CompanyContext'
import api from '@/lib/api'
import { safeLogError } from '@/utils/connectionError'

interface Company {
  id: number
  name: string
  is_master?: string | boolean
}

function isMasterCompanyRecord(c: Company): boolean {
  const v = c.is_master
  if (v === true) return true
  if (typeof v === 'string') return v.toLowerCase() === 'true'
  return false
}

export default function CompanySwitcher() {
  const router = useRouter()
  const { selectedCompany, setSelectedCompany, isSaaSDashboard, isMasterCompany, mode } = useCompany()
  const [companies, setCompanies] = useState<Company[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    fetchCompanies()
  }, [])

  // FSMS ERP: if no tenant is picked yet, scope API calls to the first Master company (e.g. Master Filling Station).
  useEffect(() => {
    if (loading || fetchError) return
    if (mode !== 'fsms_erp') return
    if (selectedCompany?.id) return
    const firstMaster = companies.find(isMasterCompanyRecord)
    if (!firstMaster) return
    setSelectedCompany({
      id: firstMaster.id,
      name: firstMaster.name,
      is_master: firstMaster.is_master,
    })
  }, [loading, fetchError, mode, selectedCompany?.id, companies, setSelectedCompany])

  const fetchCompanies = async () => {
    setFetchError(null)
    setLoading(true)
    try {
      const response = await api.get('/admin/companies/')
      if (response.data) {
        // Include all companies
        const allCompanies: Company[] = response.data.map((c: any) => ({
          id: c.id,
          name: String(c.name ?? c.company_name ?? '').trim() || `Company #${c.id}`,
          is_master:
            c.is_master === true || String(c.is_master || '').toLowerCase() === 'true'
              ? 'true'
              : 'false',
        }))
        setCompanies(allCompanies)
      }
    } catch (error: any) {
      safeLogError('Error fetching companies:', error)
      const status = error?.response?.status
      const detail = error?.response?.data?.detail
      if (status === 403) {
        setFetchError(
          typeof detail === 'string'
            ? detail
            : 'Super Admin access is required to load the company list.'
        )
      } else if (status === 401) {
        setFetchError('Session expired. Sign in again to load companies.')
      } else if (error?.code === 'ERR_NETWORK' || error?.message?.includes('Network Error')) {
        setFetchError('Cannot reach the API. Is the backend running?')
      } else {
        setFetchError(
          typeof detail === 'string' ? detail : 'Could not load companies. Check the API and try again.'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = async (company: Company | null) => {
    setSelectedCompany(company)
    setIsOpen(false)
    
    // Wait a bit to ensure state is saved to localStorage
    await new Promise(resolve => setTimeout(resolve, 100))
    
    if (mode === 'fsms_erp') {
      // In FSMS ERP mode, always redirect to dashboard when company is selected
      if (company) {
        router.push('/dashboard')
      }
    } else {
      // In SaaS Dashboard mode, selecting null means SaaS dashboard
      if (company === null) {
        if (window.location.pathname !== '/admin') {
          router.push('/admin')
        } else {
          // Already on admin page, just refresh the data by re-rendering
          router.refresh()
        }
      } else {
        // Company selected in SaaS mode - redirect to dashboard
        router.push('/dashboard')
      }
    }
  }

  const currentLabel = mode === 'fsms_erp'
    ? (selectedCompany?.name || 'Select Company')
    : (isSaaSDashboard ? 'SaaS Dashboard' : selectedCompany?.name || 'Select Company')

  const masterCompanies = companies.filter(isMasterCompanyRecord)
  const regularCompanies = companies.filter((c) => !isMasterCompanyRecord(c))

  if (loading) {
    return (
      <div className="relative w-full min-w-0 max-w-full sm:max-w-sm">
        <div className="rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 sm:px-4">
          <span className="text-sm text-gray-400">Loading...</span>
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="relative w-full min-w-0 max-w-full sm:max-w-sm">
        <div className="rounded-lg border border-amber-700/80 bg-amber-950/40 px-3 py-2.5 sm:px-4">
          <p className="text-xs leading-snug text-amber-200">{fetchError}</p>
          <button
            type="button"
            onClick={() => fetchCompanies()}
            className="mt-2 text-xs font-medium text-amber-300 underline hover:text-amber-100"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative z-30 w-full min-w-0 max-w-full sm:max-w-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={currentLabel}
        className="flex w-full min-w-0 items-start gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-left hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:items-center sm:px-4"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {mode === 'fsms_erp' ? (
              isMasterCompany ? (
                <Crown className="h-4 w-4 shrink-0 text-yellow-400" />
              ) : (
                <Building2 className="h-4 w-4 shrink-0 text-gray-400" />
              )
            ) : isSaaSDashboard ? (
              <Shield className="h-4 w-4 shrink-0 text-blue-400" />
            ) : isMasterCompany ? (
              <Crown className="h-4 w-4 shrink-0 text-yellow-400" />
            ) : (
              <Building2 className="h-4 w-4 shrink-0 text-gray-400" />
            )}
            <span className="line-clamp-2 min-w-0 break-words text-sm font-medium text-white">
              {currentLabel}
            </span>
          </div>
          {isMasterCompany && (
            <span className="shrink-0 self-start rounded bg-yellow-900 px-1.5 py-0.5 text-[10px] text-yellow-300 sm:self-center sm:text-xs">
              Master
            </span>
          )}
        </div>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform sm:mt-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-[25]" 
            onClick={() => setIsOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 right-0 top-full z-[35] mt-2 max-h-[min(70vh,24rem)] w-full min-w-0 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 shadow-lg sm:left-auto sm:right-0 sm:w-80 sm:max-w-[min(100vw-2rem,22rem)]">
            {/* SaaS Dashboard Option - Only show in SaaS Dashboard mode */}
            {mode === 'saas_dashboard' && (
              <>
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  className={`flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-gray-700 ${
                    isSaaSDashboard ? 'bg-blue-900/50 border-l-4 border-blue-500' : ''
                  }`}
                >
                  <Shield className="h-4 w-4 shrink-0 text-blue-400" />
                  <span className="min-w-0 flex-1 font-medium text-white">SaaS Dashboard</span>
                  {isSaaSDashboard && (
                    <span className="ml-auto text-xs text-blue-400">Current</span>
                  )}
                </button>
                <div className="border-t border-gray-700"></div>
              </>
            )}

            {/* Master company row(s) — every org flagged master appears here so tenants are not hidden */}
            {masterCompanies.length > 0 && (
              <>
                <div className="px-4 py-2 bg-yellow-900/30 border-b border-yellow-700/50">
                  <span className="text-xs font-semibold text-yellow-300 uppercase tracking-wide">
                    Master {masterCompanies.length > 1 ? `(${masterCompanies.length})` : 'Company'}
                  </span>
                </div>
                {masterCompanies.map((mc) => (
                  <button
                    key={mc.id}
                    type="button"
                    onClick={() => handleSelect(mc)}
                    title={mc.name}
                    className={`flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-gray-700 sm:flex-row sm:items-center sm:gap-3 ${
                      selectedCompany?.id === mc.id ? 'bg-blue-900/50 border-l-4 border-blue-500' : ''
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <Crown className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                      <span className="min-w-0 flex-1 break-words font-medium leading-snug text-white">
                        {mc.name}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 pl-6 sm:ml-auto sm:pl-0">
                      <span className="rounded bg-yellow-900 px-2 py-0.5 text-xs text-yellow-300">Master</span>
                      {selectedCompany?.id === mc.id && (
                        <span className="text-xs text-blue-400">Current</span>
                      )}
                    </div>
                  </button>
                ))}
                <div className="border-t border-gray-700"></div>
              </>
            )}

            {/* Regular Companies */}
            <div className="px-4 py-2 bg-gray-700/50 border-b border-gray-700">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Companies ({regularCompanies.length})
              </span>
            </div>
            {regularCompanies.map((company) => (
              <button
                type="button"
                key={company.id}
                onClick={() => handleSelect(company)}
                title={company.name}
                className={`flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-gray-700 sm:flex-row sm:items-center sm:gap-3 ${
                  selectedCompany?.id === company.id ? 'bg-blue-900/50 border-l-4 border-blue-500' : ''
                }`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1 break-words font-medium leading-snug text-white">
                    {company.name}
                  </span>
                </div>
                {selectedCompany?.id === company.id && (
                  <span className="shrink-0 pl-6 text-xs text-blue-400 sm:ml-auto sm:pl-0">Current</span>
                )}
              </button>
            ))}

            {regularCompanies.length === 0 && masterCompanies.length === 0 && (
              <div className="space-y-2 px-4 py-3 text-center text-xs leading-snug text-gray-400">
                <p>No companies found.</p>
                <p className="text-gray-500">
                  From the <span className="text-gray-400">backend</span> folder run{' '}
                  <code className="rounded bg-gray-900 px-1 py-0.5 text-[11px] text-gray-300">
                    python manage.py seed_master_chart_of_accounts
                  </code>{' '}
                  to create <span className="text-gray-300">Master Filling Station</span>, or{' '}
                  <code className="rounded bg-gray-900 px-1 py-0.5 text-[11px] text-gray-300">
                    python manage.py promote_default_to_master
                  </code>{' '}
                  if you still have an old &quot;Default Company&quot; row.
                </p>
              </div>
            )}
            {regularCompanies.length === 0 && masterCompanies.length > 0 && (
              <div className="px-4 py-2 text-center text-xs text-gray-500">No other tenants</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}


