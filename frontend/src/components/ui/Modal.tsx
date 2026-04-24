/**
 * Reusable Modal Component
 */

import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export default function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  if (!isOpen) return null

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overflow-x-hidden bg-black/50 p-0 pb-[env(safe-area-inset-bottom,0px)] sm:items-center sm:p-4">
      <div
        className={`my-0 w-full min-w-0 max-w-full overflow-y-auto overscroll-y-contain rounded-t-xl bg-white p-4 shadow-lg sm:my-auto sm:max-h-[min(100dvh-1.5rem,100%)] sm:rounded-lg sm:p-6 md:p-8 ${sizeClasses[size]} mx-auto`}
      >
        <div className="mb-4 flex items-start justify-between gap-3 sm:mb-6">
          <h2 className="min-w-0 pr-2 text-lg font-bold sm:text-2xl">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="touch-min -m-1 flex shrink-0 items-center justify-center rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
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

















