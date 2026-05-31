'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ChevronDown, Building2, Crown, Shield } from 'lucide-react'
import { useCompany } from '@/contexts/CompanyContext'
import api, { isSuperAdminRole, isTenantAdminRole } from '@/lib/api'
import { messageForAdminListError } from '@/utils/adminApiErrors'
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

type SwitcherMode = 'fleet' | 'group' | 'single'

interface CurrentCompanyResponse {
  id?: number
  name?: string
  is_master?: string | boolean
  can_switch_group_company?: boolean
  group_companies?: {
    id: number
    name: string
    is_master?: string | boolean
    company_code?: string
  }[]
}

function readUserRole(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const userStr = localStorage.getItem('user')
    if (!userStr || userStr === 'undefined' || userStr === 'null') return null
    const u = JSON.parse(userStr) as { role?: string }
    return u?.role != null ? String(u.role) : null
  } catch {
    return null
  }
}

export default function CompanySwitcher() {
  const router = useRouter()
  const { selectedCompany, setSelectedCompany, isSaaSDashboard, isMasterCompany, mode } = useCompany()
  const [companies, setCompanies] = useState<Company[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [switcherMode, setSwitcherMode] = useState<SwitcherMode>('single')
  const [readOnlySwitch, setReadOnlySwitch] = useState(false)
  // The switcher lives inside an overflow-y-auto sidebar section, so an absolutely
  // positioned menu would be clipped. Render it in a body portal with fixed coords.
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null)

  const updateMenuPos = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 8, left: r.left, width: r.width })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    updateMenuPos()
    const onChange = () => updateMenuPos()
    window.addEventListener('resize', onChange)
    // Capture phase so scrolling any ancestor (e.g. the sidebar) repositions the menu.
    window.addEventListener('scroll', onChange, true)
    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
    }
  }, [isOpen, updateMenuPos])

  const syncSelectionToContext = useCallback(
    (list: Company[], preferredId: number | null) => {
      if (list.length === 0) return
      try {
        const raw = localStorage.getItem('superadmin_selected_company')
        if (raw && raw !== 'undefined' && raw !== 'null') {
          const p = JSON.parse(raw) as { id?: number; name?: string; is_master?: string | boolean }
          if (p?.id != null && list.some((c) => c.id === p.id)) {
            const row = list.find((c) => c.id === p.id)!
            setSelectedCompany({
              id: row.id,
              name: (p.name && String(p.name).trim()) || row.name,
              is_master: p.is_master ?? row.is_master,
            })
            return
          }
        }
      } catch {
        /* ignore */
      }
      const cur =
        (preferredId != null ? list.find((c) => c.id === preferredId) : null) || list[0]
      if (cur) {
        setSelectedCompany({
          id: cur.id,
          name: cur.name,
          is_master: cur.is_master,
        })
      }
    },
    [setSelectedCompany],
  )

  const fetchAdminFleet = async () => {
    setFetchError(null)
    setLoading(true)
    try {
      const response = await api.get('/admin/companies/')
      if (response.data) {
        const allCompanies: Company[] = response.data.map((c: Record<string, unknown>) => ({
          id: c.id as number,
          name: String(c.name ?? c.company_name ?? '').trim() || `Company #${c.id}`,
          is_master:
            c.is_master === true || String(c.is_master || '').toLowerCase() === 'true'
              ? 'true'
              : 'false',
        }))
        setCompanies(allCompanies)
        setSwitcherMode('fleet')
        setReadOnlySwitch(false)
      }
    } catch (error: unknown) {
      safeLogError('Error fetching companies:', error)
      setFetchError(messageForAdminListError(error, 'companies'))
    } finally {
      setLoading(false)
    }
  }

  const fetchTenantContext = async () => {
    setFetchError(null)
    setLoading(true)
    const role = readUserRole()
    try {
      const { data } = await api.get<CurrentCompanyResponse>('/companies/current/')
      const cid = data?.id
      if (cid == null || typeof cid !== 'number') {
        setFetchError('Could not load company context.')
        setCompanies([])
        setSwitcherMode('single')
        setReadOnlySwitch(true)
        return
      }
      const admin = isTenantAdminRole(role)
      const multi = Boolean(data.can_switch_group_company) && Array.isArray(data.group_companies)
      if (admin && multi && data.group_companies!.length > 1) {
        const list: Company[] = data.group_companies!.map((g) => ({
          id: g.id,
          name: String(g.name || '').trim() || `Company #${g.id}`,
          is_master:
            g.is_master === true || String(g.is_master || '').toLowerCase() === 'true'
              ? 'true'
              : 'false',
        }))
        setCompanies(list)
        setSwitcherMode('group')
        setReadOnlySwitch(false)
        syncSelectionToContext(list, cid)
      } else {
        const list: Company[] = [
          {
            id: cid,
            name: String(data.name || '').trim() || `Company #${cid}`,
            is_master:
              data.is_master === true || String(data.is_master || '').toLowerCase() === 'true'
                ? 'true'
                : 'false',
          },
        ]
        setCompanies(list)
        setSwitcherMode('single')
        setReadOnlySwitch(true)
        syncSelectionToContext(list, cid)
      }
    } catch (error: unknown) {
      safeLogError('Error fetching company context:', error)
      setFetchError(
        messageForAdminListError(error, 'companies') || 'Could not load company context.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const role = readUserRole()
    if (isSuperAdminRole(role)) {
      void fetchAdminFleet()
    } else {
      void fetchTenantContext()
    }
  }, [])

  // FSMS ERP: if no company is picked yet, scope API calls (X-Selected-Company-Id) to a default tenant.
  useEffect(() => {
    if (loading || fetchError) return
    if (mode !== 'fsms_erp') return
    if (selectedCompany?.id) return
    if (companies.length === 0) return
    if (switcherMode === 'fleet') {
      const firstMaster = companies.find(isMasterCompanyRecord)
      const pick = firstMaster ?? companies[0]
      setSelectedCompany({
        id: pick.id,
        name: pick.name,
        is_master: pick.is_master,
      })
      return
    }
    if (switcherMode === 'group' || switcherMode === 'single') {
      const pick = companies[0]
      setSelectedCompany({
        id: pick.id,
        name: pick.name,
        is_master: pick.is_master,
      })
    }
  }, [loading, fetchError, mode, selectedCompany?.id, companies, setSelectedCompany, switcherMode])

  const handleSelect = async (company: Company | null) => {
    if (readOnlySwitch && company !== null) return
    setSelectedCompany(company)
    setIsOpen(false)

    await new Promise((resolve) => setTimeout(resolve, 100))

    if (mode === 'fsms_erp') {
      if (company) {
        router.push('/dashboard')
      }
    } else {
      if (company === null) {
        if (window.location.pathname !== '/admin') {
          router.push('/admin')
        } else {
          router.refresh()
        }
      } else {
        router.push('/dashboard')
      }
    }
  }

  const currentLabel =
    mode === 'fsms_erp'
      ? selectedCompany?.name || 'Select Company'
      : isSaaSDashboard
        ? 'SaaS Dashboard'
        : selectedCompany?.name || 'Select Company'

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
            onClick={() => {
              const role = readUserRole()
              if (isSuperAdminRole(role)) void fetchAdminFleet()
              else void fetchTenantContext()
            }}
            className="mt-2 text-xs font-medium text-amber-300 underline hover:text-amber-100"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const openDisabled = readOnlySwitch && companies.length <= 1

  return (
    <div ref={triggerRef} className="relative z-30 w-full min-w-0 max-w-full sm:max-w-sm">
      <button
        type="button"
        onClick={() => {
          if (openDisabled) return
          if (!isOpen) updateMenuPos()
          setIsOpen(!isOpen)
        }}
        title={currentLabel}
        className={`flex w-full min-w-0 items-start gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-left hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:items-center sm:px-4 ${openDisabled ? 'cursor-default opacity-95' : ''}`}
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
        {!openDisabled && (
          <ChevronDown
            className={`mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform sm:mt-0 ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {switcherMode === 'fleet' && mode === 'fsms_erp' && masterCompanies.length === 0 && companies.length > 0 && (
        <p className="mt-1.5 px-0.5 text-[10px] leading-snug text-gray-500">
          No Master demo company: the first tenant is auto-selected for API scope (like Master Filling Station). Switch
          here if you use multiple tenants.
        </p>
      )}
      {switcherMode === 'group' && (
        <p className="mt-1.5 px-0.5 text-[10px] leading-snug text-gray-500">
          Same login portal — switch legal entity (company books). Data stays scoped per company.
        </p>
      )}

      {isOpen && !openDisabled && menuPos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setIsOpen(false)} aria-hidden />
          <div
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            className="z-[1001] max-h-[min(70vh,24rem)] min-w-0 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 shadow-lg">
            {switcherMode === 'fleet' && mode === 'saas_dashboard' && (
              <>
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  className={`flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-gray-700 ${
                    isSaaSDashboard ? 'border-l-4 border-blue-500 bg-blue-900/50' : ''
                  }`}
                >
                  <Shield className="h-4 w-4 shrink-0 text-blue-400" />
                  <span className="min-w-0 flex-1 font-medium text-white">SaaS Dashboard</span>
                  {isSaaSDashboard && <span className="ml-auto text-xs text-blue-400">Current</span>}
                </button>
                <div className="border-t border-gray-700" />
              </>
            )}

            {switcherMode === 'fleet' && masterCompanies.length > 0 && (
              <>
                <div className="border-b border-yellow-700/50 bg-yellow-900/30 px-4 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-yellow-300">
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
                      selectedCompany?.id === mc.id ? 'border-l-4 border-blue-500 bg-blue-900/50' : ''
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
                <div className="border-t border-gray-700" />
              </>
            )}

            {switcherMode === 'fleet' && (
              <>
                <div className="border-b border-gray-700 bg-gray-700/50 px-4 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
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
                      selectedCompany?.id === company.id ? 'border-l-4 border-blue-500 bg-blue-900/50' : ''
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
              </>
            )}

            {switcherMode === 'group' && (
              <>
                <div className="border-b border-gray-700 bg-gray-700/50 px-4 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Legal entities ({companies.length})
                  </span>
                </div>
                {companies.map((company) => (
                  <button
                    type="button"
                    key={company.id}
                    onClick={() => handleSelect(company)}
                    title={company.name}
                    className={`flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-gray-700 sm:flex-row sm:items-center sm:gap-3 ${
                      selectedCompany?.id === company.id ? 'border-l-4 border-blue-500 bg-blue-900/50' : ''
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      {isMasterCompanyRecord(company) ? (
                        <Crown className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                      ) : (
                        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      )}
                      <span className="min-w-0 flex-1 break-words font-medium leading-snug text-white">
                        {company.name}
                      </span>
                    </div>
                    {selectedCompany?.id === company.id && (
                      <span className="shrink-0 pl-6 text-xs text-blue-400 sm:ml-auto sm:pl-0">Current</span>
                    )}
                  </button>
                ))}
              </>
            )}

            {switcherMode === 'fleet' && regularCompanies.length === 0 && masterCompanies.length === 0 && (
              <div className="space-y-2 px-4 py-3 text-center text-xs leading-snug text-gray-400">
                <p>No companies found.</p>
              </div>
            )}
            {switcherMode === 'fleet' && regularCompanies.length === 0 && masterCompanies.length > 0 && (
              <div className="px-4 py-2 text-center text-xs text-gray-500">No other tenants</div>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
