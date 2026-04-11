'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useCompany } from '@/contexts/CompanyContext'
import { AlertTriangle, Building2, Lock, TestTube, Crown, X } from 'lucide-react'
import api, { isSuperAdminRole } from '@/lib/api'
import { isConnectionError } from '@/utils/connectionError'
import { isPublicAuthRoute } from '@/utils/publicAuthRoutes'

interface ProtectionStatus {
  is_master: boolean
  is_locked: boolean
  is_testing: boolean
  status: string
  message: string
}

/**
 * Compact Company Alert
 * Displays a compact alert card in free space (top-right area)
 * Shows master company status or tenant company info
 */
export function CompactCompanyAlert() {
  const pathname = usePathname()
  const { selectedCompany, isMasterCompany } = useCompany()
  const [protectionStatus, setProtectionStatus] = useState<ProtectionStatus | null>(null)
  const [isDismissed, setIsDismissed] = useState(false)

  // Check if dismissed in localStorage (persist dismissal)
  // But clear dismissal when company changes
  useEffect(() => {
    const dismissed = localStorage.getItem('company-alert-dismissed')
    const lastCompanyId = localStorage.getItem('last-company-alert-company-id')
    
    // If company changed, reset dismissal
    if (selectedCompany && lastCompanyId !== String(selectedCompany.id)) {
      setIsDismissed(false)
      localStorage.removeItem('company-alert-dismissed')
      localStorage.setItem('last-company-alert-company-id', String(selectedCompany.id))
    } else if (dismissed === 'true') {
      setIsDismissed(true)
    }
  }, [selectedCompany])

  useEffect(() => {
    if (!isMasterCompany || !selectedCompany || typeof window === 'undefined') return
    if (isPublicAuthRoute(pathname)) return

    // Backend requires JWT + super_admin (see admin_views.admin_master_company_protection_status).
    // Non–super-admins would get 403; missing/invalid token yields 401 — avoid calling when unauthorized.
    const token = localStorage.getItem('access_token')?.trim()
    let role: string | null = null
    try {
      const raw = localStorage.getItem('user')
      if (raw && raw !== 'undefined' && raw !== 'null') {
        role = JSON.parse(raw)?.role ?? null
      }
    } catch {
      return
    }
    if (!token || !isSuperAdminRole(role)) return

    fetchProtectionStatus()
  }, [isMasterCompany, selectedCompany, pathname])

  const fetchProtectionStatus = async () => {
    try {
      const response = await api.get('/admin/master-company/protection-status/', {
        params: { company_id: selectedCompany?.id }
      })
      setProtectionStatus(response.data)
    } catch (error: any) {
      const status = error?.response?.status
      // 401: session expired / not logged in; 403: not super_admin — both expected for this optional banner
      if (status === 401 || status === 403) return
      if (!isConnectionError(error)) {
        console.debug('Could not fetch protection status:', error)
      }
    }
  }

  const handleDismiss = () => {
    setIsDismissed(true)
    localStorage.setItem('company-alert-dismissed', 'true')
    if (selectedCompany) {
      localStorage.setItem('last-company-alert-company-id', String(selectedCompany.id))
    }
  }

  // Don't show if no company selected or if dismissed
  if (!selectedCompany || isDismissed) {
    return null
  }

  const isLocked = protectionStatus?.is_locked === true
  const isTesting = protectionStatus?.is_testing === true

  // Master Company Alert
  if (isMasterCompany) {
    let bgColor = 'bg-gradient-to-br from-orange-500 to-red-600'
    let borderColor = 'border-orange-600'
    let icon = Crown
    let title = 'Master Company Active'
    let subtitle = 'Development & Upgradation Mode'

    if (isLocked) {
      bgColor = 'bg-gradient-to-br from-red-600 to-red-800'
      borderColor = 'border-red-700'
      icon = Lock
      title = 'Master Company Locked'
      subtitle = 'All Modifications Blocked'
    } else if (isTesting) {
      bgColor = 'bg-gradient-to-br from-yellow-500 to-orange-600'
      borderColor = 'border-yellow-600'
      icon = TestTube
      title = 'Master Company Testing'
      subtitle = 'Modifications with Warnings'
    }

    const IconComponent = icon

    return (
      <div
        className={`fixed left-3 right-3 top-[4.5rem] z-[100] max-w-none rounded-lg border-2 shadow-2xl sm:left-auto sm:right-4 sm:top-20 sm:max-w-sm ${bgColor} ${borderColor} animate-slide-in text-white`}
      >
        <div className="p-3 sm:p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3 flex-1">
              <IconComponent className="h-5 w-5 mt-0.5 text-yellow-300 animate-pulse flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm mb-0.5">{title}</div>
                <div className="text-xs opacity-90">{subtitle}</div>
                <div className="text-xs mt-1.5 opacity-80 flex items-center space-x-1">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Changes may affect all tenants</span>
                </div>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="ml-2 text-white/70 hover:text-white transition-colors flex-shrink-0"
              aria-label="Dismiss alert"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Tenant Company Info (more subtle)
  return (
    <div className="fixed left-3 right-3 top-[4.5rem] z-[100] max-w-none rounded-lg border-2 border-blue-500 bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg animate-slide-in sm:left-auto sm:right-4 sm:top-20 sm:max-w-xs">
      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            <Building2 className="h-4 w-4 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-xs truncate">{selectedCompany.name}</div>
              <div className="text-xs opacity-80">Production Mode</div>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="ml-2 text-white/70 hover:text-white transition-colors flex-shrink-0"
            aria-label="Dismiss alert"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
