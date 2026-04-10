'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface Company {
  id: number | null
  name: string
  is_master?: string | boolean
}

interface CompanyContextType {
  selectedCompany: Company | null
  setSelectedCompany: (company: Company | null) => void
  isSaaSDashboard: boolean
  isMasterCompany: boolean
  mode: 'fsms_erp' | 'saas_dashboard'
  setMode: (mode: 'fsms_erp' | 'saas_dashboard') => void
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined)

export const CompanyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedCompany, setSelectedCompanyState] = useState<Company | null>(null)
  const [mode, setModeState] = useState<'fsms_erp' | 'saas_dashboard'>('saas_dashboard')
  const [mounted, setMounted] = useState(false)

  // Load from localStorage on mount (client-side only) - CRITICAL: Only after mount to prevent hydration errors
  useEffect(() => {
    // Mark as mounted
    setMounted(true)
    
    // Only access localStorage after component mounts (client-side)
    if (typeof window === 'undefined') return
    
    try {
      // Load selected company
      const saved = localStorage.getItem('superadmin_selected_company')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed && typeof parsed === 'object' && parsed.id && parsed.name) {
            const im = parsed.is_master
            const isMasterStr =
              im === true || im === 'true' ? 'true' : 'false'
            setSelectedCompanyState({
              id: parsed.id,
              name: parsed.name,
              is_master: isMasterStr,
            })
          }
        } catch (e) {
          // Invalid data, remove it
          localStorage.removeItem('superadmin_selected_company')
        }
      }
      
      // Load mode
      const savedMode = localStorage.getItem('sidebar_mode')
      if (savedMode === 'fsms_erp' || savedMode === 'saas_dashboard') {
        setModeState(savedMode)
      }
    } catch (error) {
      // Silently handle any localStorage errors - don't break the app
      console.warn('Error accessing localStorage in CompanyContext:', error)
    }
  }, [])

  // Always render children immediately - don't wait for mount to prevent hydration issues
  // The state will update after mount, but structure stays the same

  // Save to localStorage when changed (only after mount)
  const setSelectedCompany = (company: Company | null) => {
    setSelectedCompanyState(company)
    if (mounted && typeof window !== 'undefined') {
      try {
        if (company) {
          localStorage.setItem('superadmin_selected_company', JSON.stringify(company))
        } else {
          localStorage.removeItem('superadmin_selected_company')
        }
      } catch (error) {
        console.warn('Error saving to localStorage:', error)
      }
    }
  }

  const setMode = (newMode: 'fsms_erp' | 'saas_dashboard') => {
    setModeState(newMode)
    if (mounted && typeof window !== 'undefined') {
      try {
        localStorage.setItem('sidebar_mode', newMode)
      } catch (error) {
        console.warn('Error saving mode to localStorage:', error)
      }
    }
  }

  const isSaaSDashboard = mode === 'saas_dashboard' || selectedCompany === null
  const isMasterCompany =
    selectedCompany?.is_master === 'true' || selectedCompany?.is_master === true

  return (
    <CompanyContext.Provider
      value={{
        selectedCompany,
        setSelectedCompany,
        isSaaSDashboard,
        isMasterCompany,
        mode,
        setMode,
      }}
    >
      {children}
    </CompanyContext.Provider>
  )
}

export const useCompany = () => {
  const context = useContext(CompanyContext)
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider')
  }
  return context
}


