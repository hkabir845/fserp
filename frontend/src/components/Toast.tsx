'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string | any // Allow any to handle errors, but convert to string before rendering
  duration?: number
}

interface ToastContextType {
  showToast: (type: ToastType, message: string, duration?: number) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback((type: ToastType, message: string | any, duration = 3000) => {
    // Ensure message is always a string
    let messageString: string
    if (typeof message === 'string') {
      messageString = message
    } else if (typeof message === 'object' && message !== null) {
      // Handle error objects or validation errors
      if (Array.isArray(message)) {
        messageString = (message as any[]).map((item: any) => {
          if (typeof item === 'object' && item !== null) {
            if (item.msg) return item.msg
            if (item.message) return item.message
            if (item.loc) return `${item.loc.join('.')}: ${item.msg || 'Validation error'}`
          }
          return String(item)
        }).join('; ')
      } else if (message.msg) {
        messageString = message.msg
      } else if (message.message) {
        messageString = message.message
      } else if (message.detail) {
        messageString = typeof message.detail === 'string' ? message.detail : JSON.stringify(message.detail)
      } else {
        messageString = JSON.stringify(message)
      }
    } else {
      messageString = String(message || 'An error occurred')
    }
    
    const id = Math.random().toString(36).substring(7)
    const toast: Toast = { id, type, message: messageString, duration }
    
    setToasts((prev) => [...prev, toast])

    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }
  }, [removeToast])

  const success = useCallback((message: string, duration?: number) => {
    showToast('success', message, duration)
  }, [showToast])

  const error = useCallback((message: string, duration?: number) => {
    showToast('error', message, duration)
  }, [showToast])

  const warning = useCallback((message: string, duration?: number) => {
    showToast('warning', message, duration)
  }, [showToast])

  const info = useCallback((message: string, duration?: number) => {
    showToast('info', message, duration)
  }, [showToast])

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
      {children}
      <div className="fixed left-3 right-3 top-4 z-50 space-y-2 sm:left-auto sm:right-4 sm:max-w-md">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-600" />
      case 'error':
        return <XCircle className="h-5 w-5 text-red-600" />
      case 'warning':
        return <AlertCircle className="h-5 w-5 text-yellow-600" />
      case 'info':
        return <Info className="h-5 w-5 text-blue-600" />
    }
  }

  const getBackgroundColor = () => {
    switch (toast.type) {
      case 'success':
        return 'bg-green-50 border-green-200'
      case 'error':
        return 'bg-red-50 border-red-200'
      case 'warning':
        return 'bg-yellow-50 border-yellow-200'
      case 'info':
        return 'bg-blue-50 border-blue-200'
    }
  }

  // Ensure message is always a string
  const messageString = typeof toast.message === 'string' 
    ? toast.message 
    : typeof toast.message === 'object' && toast.message !== null
      ? JSON.stringify(toast.message)
      : String(toast.message || 'An error occurred')

  return (
    <div
      className={`flex items-start space-x-3 p-4 rounded-lg border shadow-lg min-w-[300px] max-w-md animate-slide-in ${getBackgroundColor()}`}
    >
      <div className="flex-shrink-0">{getIcon()}</div>
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900">{messageString}</p>
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}














