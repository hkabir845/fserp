/**
 * Reusable Modal Component
 */

import { X } from 'lucide-react'
import { ERP_PAGE_VIEWPORT } from '@/lib/modalLayout'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /** sm/md/lg/xl = compact; 2xl/page = wide data-entry (1440px listing width) */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'page'
}

export default function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  if (!isOpen) return null

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    page: ERP_PAGE_VIEWPORT,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overflow-x-hidden bg-foreground/50 p-0 pb-[env(safe-area-inset-bottom,0px)] sm:items-center sm:p-3 md:p-6">
      <div
        className={`my-0 w-full min-w-0 max-w-full overflow-y-auto overscroll-y-contain rounded-t-xl erp-surface p-4 shadow-elevated sm:my-auto sm:max-h-[min(96vh,100%)] sm:rounded-2xl sm:p-6 md:p-8 ${sizeClasses[size]} mx-auto`}
      >
        <div className="mb-4 flex items-start justify-between gap-3 sm:mb-6">
          <h2 className="min-w-0 pr-2 text-lg font-bold text-foreground sm:text-2xl">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="touch-min -m-1 flex shrink-0 items-center justify-center rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close dialog"
          >
            <X className="h-6 w-6" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
