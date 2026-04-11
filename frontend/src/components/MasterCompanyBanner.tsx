'use client'

import { useState, useEffect, useCallback } from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { AlertTriangle, Building2, Lock, Unlock, TestTube, Crown } from 'lucide-react'
import api, { isSuperAdminRole } from '@/lib/api'
import { isConnectionError } from '@/utils/connectionError'

interface ProtectionStatus {
  is_master: boolean
  is_locked: boolean
  is_testing: boolean
  status: string
  message: string
}

/**
 * Master Company Banner
 * Displays a prominent warning banner when working in Master Company mode
 * to prevent accidental modifications that affect all tenants
 */
export function MasterCompanyBanner() {
  const { selectedCompany, isMasterCompany } = useCompany()
  const [protectionStatus, setProtectionStatus] = useState<ProtectionStatus | null>(null)

  const fetchProtectionStatus = useCallback(async () => {
    try {
      const response = await api.get('/admin/master-company/protection-status/', {
        params: { company_id: selectedCompany?.id }
      })
      setProtectionStatus(response.data)
    } catch (error: any) {
      // Silently fail - protection status is optional
      // Don't log connection errors (backend may not be running)
      if (!isConnectionError(error)) {
        console.debug('Could not fetch protection status:', error)
      }
    }
  }, [selectedCompany?.id])

  useEffect(() => {
    if (!isMasterCompany || !selectedCompany || typeof window === 'undefined') return
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
  }, [isMasterCompany, selectedCompany, fetchProtectionStatus])

  if (!isMasterCompany || !selectedCompany) {
    return null
  }

  const isLocked = protectionStatus?.is_locked === true
  const isTesting = protectionStatus?.is_testing === true

  // Different banner styles based on protection status
  let bgColor = 'from-orange-500 to-red-600'
  let borderColor = 'border-orange-700'
  let icon = AlertTriangle

  if (isLocked) {
    bgColor = 'from-red-600 to-red-800'
    borderColor = 'border-red-900'
    icon = Lock
  } else if (isTesting) {
    bgColor = 'from-yellow-500 to-orange-600'
    borderColor = 'border-yellow-700'
    icon = TestTube
  }

  return (
    <div className={`bg-gradient-to-r ${bgColor} text-white px-4 py-3 shadow-lg border-b-2 ${borderColor}`}>
      <div className="flex items-center justify-center space-x-3">
        {icon === Lock ? (
          <Lock className="h-5 w-5 animate-pulse" />
        ) : icon === TestTube ? (
          <TestTube className="h-5 w-5 animate-pulse" />
        ) : (
          <Crown className="h-5 w-5 text-yellow-300 animate-pulse" />
        )}
        <div className="flex items-center space-x-2">
          <Building2 className="h-4 w-4" />
          <span className="font-bold text-sm md:text-base">
            {isLocked 
              ? 'MASTER COMPANY LOCKED - All Modifications Blocked'
              : isTesting
              ? 'MASTER COMPANY TESTING MODE - Modifications with Warnings'
              : 'MASTER COMPANY ACTIVE - Development & Upgradation Mode'
            }
          </span>
        </div>
        {icon === Lock ? (
          <Lock className="h-5 w-5 animate-pulse" />
        ) : icon === TestTube ? (
          <TestTube className="h-5 w-5 animate-pulse" />
        ) : (
          <Crown className="h-5 w-5 text-yellow-300 animate-pulse" />
        )}
      </div>
      <div className="text-center mt-1 text-xs md:text-sm opacity-90">
        {isLocked 
          ? '🔒 Master company is LOCKED. All modifications are blocked. Please unlock to make changes.'
          : isTesting
          ? '🧪 Master company is in TESTING mode. Modifications allowed with warnings. Changes may affect all tenants.'
          : '⚠️ Changes made here may affect all tenant companies. Use with caution.'
        }
      </div>
    </div>
  )
}

/**
 * Tenant Company Banner
 * Displays company name when working in a specific tenant
 */
export function TenantCompanyBanner() {
  const { selectedCompany, isMasterCompany } = useCompany()

  if (isMasterCompany || !selectedCompany) {
    return null
  }

  return (
    <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white px-4 py-2 shadow-md border-b border-blue-800">
      <div className="flex items-center justify-center space-x-2">
        <Building2 className="h-4 w-4" />
        <span className="font-semibold text-sm md:text-base">
          {selectedCompany.name} - Production Mode
        </span>
      </div>
    </div>
  )
}
