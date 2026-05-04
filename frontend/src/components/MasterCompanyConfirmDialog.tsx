'use client'

import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useCompany } from '@/contexts/CompanyContext'

interface MasterCompanyConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

/**
 * Confirmation Dialog for Master Company Operations
 * Shows a warning when performing operations in Master Company mode
 */
export function MasterCompanyConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  destructive = false
}: MasterCompanyConfirmDialogProps) {
  const { isMasterCompany } = useCompany()

  if (!isOpen) return null

  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className={`p-4 rounded-t-lg ${destructive ? 'bg-red-500' : 'bg-orange-500'} text-white flex items-center justify-between`}>
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5" />
            <h3 className="font-bold text-lg">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:text-gray-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {isMasterCompany && (
            <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="flex items-center space-x-2 text-orange-800">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-semibold">Master Company Mode Active</span>
              </div>
              <p className="text-xs text-orange-700 mt-1">
                This action will affect the master company. Changes may be pushed to all tenants.
              </p>
            </div>
          )}

          <p className="text-gray-700 mb-6">{message}</p>

          {/* Actions */}
          <div className="flex space-x-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {cancelText}
            </button>
            <button
              onClick={handleConfirm}
              className={`px-4 py-2 text-white rounded-lg transition-colors ${
                destructive
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
