'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { useCompany } from '@/contexts/CompanyContext'
import api, { isSuperAdminRole } from '@/lib/api'
import { isConnectionError } from '@/utils/connectionError'
import { isPublicAuthRoute } from '@/utils/publicAuthRoutes'

export interface ProtectionStatus {
  is_master: boolean
  is_locked: boolean
  is_testing: boolean
  status: string
  message: string
}

/**
 * Shared loader for the master-company protection status banner data.
 *
 * Only fetches when a master company is selected, the route is not a public
 * auth page, and the current user is a super admin (the backend endpoint
 * requires JWT + super_admin and otherwise returns 401/403). Failures are
 * swallowed because the banner is purely informational.
 */
export function useMasterCompanyProtectionStatus(): ProtectionStatus | null {
  const pathname = usePathname()
  const { selectedCompany, isMasterCompany } = useCompany()
  const [protectionStatus, setProtectionStatus] = useState<ProtectionStatus | null>(null)

  const fetchProtectionStatus = useCallback(async () => {
    try {
      const response = await api.get('/admin/master-company/protection-status/', {
        params: { company_id: selectedCompany?.id },
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
  }, [selectedCompany?.id])

  useEffect(() => {
    if (!isMasterCompany || !selectedCompany || typeof window === 'undefined') return
    if (isPublicAuthRoute(pathname)) return

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

    void fetchProtectionStatus()
  }, [isMasterCompany, selectedCompany, pathname, fetchProtectionStatus])

  return protectionStatus
}
