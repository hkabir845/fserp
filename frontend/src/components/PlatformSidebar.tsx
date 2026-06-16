'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'

interface MenuItem {
  title: string
  href: string
  icon: string
  children?: MenuItem[]
}

const platformMenuItems: MenuItem[] = [
  {
    title: 'Dashboard',
    href: '/platform/dashboard',
    icon: '📊',
  },
  {
    title: 'Quick links',
    href: '/platform',
    icon: '🗂️',
  },
  {
    title: 'Tenants',
    icon: '🏢',
    href: '/platform/tenants',
    children: [
      { title: 'All Tenants', href: '/platform/tenants/browse', icon: '📋' },
      { title: 'New Tenant', href: '/platform/tenants/new', icon: '➕' },
    ],
  },
  {
    title: 'Subscriptions',
    icon: '💳',
    href: '/platform/subscriptions',
    children: [
      { title: 'All Subscriptions', href: '/platform/subscriptions', icon: '📝' },
      { title: 'Subscription Plans', href: '/platform/plans', icon: '📦' },
    ],
  },
  {
    title: 'Billing',
    icon: '💰',
    href: '/platform/billing',
    children: [
      { title: 'Invoices', href: '/platform/invoices', icon: '🧾' },
      { title: 'Payments', href: '/platform/payments', icon: '💵' },
    ],
  },
  {
    title: 'Broadcast',
    icon: '📢',
    href: '/platform/broadcast',
  },
  {
    title: 'Settings',
    icon: '⚙️',
    href: '/platform/settings',
  },
]

interface PlatformSidebarProps {
  isOpen: boolean
  onClose: () => void
  width: number
  onWidthChange: (width: number) => void
}

export function PlatformSidebar({ isOpen, onClose, width, onWidthChange }: PlatformSidebarProps) {
  const pathname = usePathname()
  const [expandedItems, setExpandedItems] = useState<string[]>([])
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const resizeHandleRef = useRef<HTMLDivElement>(null)

  // Handle resize
  useEffect(() => {
    if (!isResizing) {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      return
    }

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      
      const newWidth = Math.max(0, e.clientX)
      const minWidth = 200
      const maxWidth = 600
      
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))
      onWidthChange(clampedWidth)
    }

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsResizing(false)
    }

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.body.style.pointerEvents = 'auto'
    
    document.addEventListener('mousemove', handleMouseMove, { passive: false })
    document.addEventListener('mouseup', handleMouseUp, { passive: false })
    document.addEventListener('mouseleave', handleMouseUp, { passive: false })

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mouseleave', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.body.style.pointerEvents = ''
    }
  }, [isResizing, onWidthChange])

  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.button !== 0) return
    setIsResizing(true)
  }

  const handleDoubleClick = () => {
    onWidthChange(256)
  }

  // Load expanded items from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('platform-sidebar-expanded')
    if (saved) {
      try {
        setExpandedItems(JSON.parse(saved))
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, [])

  // Save expanded items to localStorage
  useEffect(() => {
    if (expandedItems.length > 0) {
      localStorage.setItem('platform-sidebar-expanded', JSON.stringify(expandedItems))
    }
  }, [expandedItems])

  // Auto-expand parent items if child is active or section hub is open
  useEffect(() => {
    const activeParents: string[] = []
    platformMenuItems.forEach((item) => {
      if (item.children) {
        const onHub = pathname === item.href
        const hasActiveChild = item.children.some((child) => {
          if (child.href === '#') return false
          return pathname === child.href || pathname?.startsWith(`${child.href}/`)
        })
        if (hasActiveChild || onHub) {
          activeParents.push(item.title)
        }
      }
    })
    if (activeParents.length > 0) {
      setExpandedItems((prev) => {
        return Array.from(new Set([...prev, ...activeParents]))
      })
    }
  }, [pathname])

  const toggleExpanded = (title: string) => {
    setExpandedItems((prev) =>
      prev.includes(title)
        ? prev.filter((item) => item !== title)
        : [...prev, title]
    )
  }

  const isActive = (href: string) => {
    if (href === '#') return false
    if (href === '/platform/settings') {
      return pathname === '/platform/settings' || pathname?.startsWith('/platform/settings/')
    }
    // Hub at `/platform` must match only that page; a prefix check would mark "Quick links"
    // active on every `/platform/...` route (Dashboard, Tenants, etc.).
    if (href === '/platform') {
      return pathname === '/platform' || pathname === '/platform/'
    }
    return pathname === href || pathname?.startsWith(`${href}/`)
  }

  const isParentActive = (item: MenuItem) => {
    if (!item.children) return false
    return item.children.some((child) => isActive(child.href))
  }

  const renderMenuItem = (item: MenuItem, level: number = 0) => {
    const hasChildren = item.children && item.children.length > 0
    const hubActive = Boolean(item.href && item.href !== '#' && pathname === item.href)
    const parentActive = isParentActive(item) || hubActive
    const isExpanded = expandedItems.includes(item.title)

    if (hasChildren) {
      // Section hub URL: same solid active block as leaf items; child-only routes keep the lighter parent row.
      const parentRowClass = hubActive
        ? 'border-r-2 border-purple-800 bg-purple-600 text-white'
        : parentActive
          ? 'border-r-2 border-purple-600 bg-purple-50 text-purple-700'
          : 'text-gray-700 hover:bg-gray-50'

      return (
        <div key={item.title}>
          <div
            className={`
              flex w-full min-w-0 items-stretch
              transition-colors duration-150
              ${parentRowClass}
              ${level > 0 ? 'pl-0' : ''}
            `}
          >
            <Link
              href={item.href}
              onClick={onClose}
              className={`flex min-w-0 flex-1 items-center space-x-3 px-4 py-3 ${level > 0 ? 'pl-8' : ''}`}
            >
              <span className="flex-shrink-0 text-lg">{item.icon}</span>
              <span className="truncate font-medium">{item.title}</span>
            </Link>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                toggleExpanded(item.title)
              }}
              className={
                hubActive
                  ? 'flex shrink-0 items-center px-2 text-purple-100 hover:text-white'
                  : 'flex shrink-0 items-center px-2 text-gray-500 hover:text-gray-800'
              }
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.title}`}
            >
              <svg
                className={`h-4 w-4 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          {isExpanded && (
            <div className="bg-gray-50">
              {item.children?.map((child) => renderMenuItem(child, level + 1))}
            </div>
          )}
        </div>
      )
    }

    const active = isActive(item.href)
    return (
      <Link
        key={item.title}
        href={item.href}
        onClick={onClose}
        className={`
          flex items-center space-x-3 px-4 py-3
          transition-colors duration-150
          ${active
            ? 'bg-purple-600 text-white border-r-2 border-purple-800'
            : 'text-gray-700 hover:bg-gray-50'
          }
          ${level > 0 ? 'pl-8' : ''}
          min-w-0
        `}
      >
        <span className="text-lg flex-shrink-0">{item.icon}</span>
        <span className="font-medium truncate">{item.title}</span>
      </Link>
    )
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`
          fixed top-0 left-0 h-screen bg-white border-r border-gray-200
          z-50 transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:fixed
          overflow-y-auto overflow-x-hidden
          ${isResizing ? 'select-none' : ''}
          flex flex-col
        `}
        style={{ 
          width: `${width}px`,
          transition: isResizing ? 'none' : 'width 0.2s ease-in-out'
        }}
      >
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-purple-600 whitespace-nowrap">SaaS Platform</h2>
            <button
              onClick={onClose}
              className="lg:hidden text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>
        </div>

        <nav className="py-2 flex-1 min-w-0">
          {platformMenuItems.map((item) => renderMenuItem(item))}
        </nav>

        {/* Resize Handle - Only visible on desktop */}
        <div
          ref={resizeHandleRef}
          onMouseDown={handleResizeStart}
          onDoubleClick={handleDoubleClick}
          className={`
            hidden lg:block absolute top-0 right-0 h-full cursor-col-resize
            hover:bg-purple-300 hover:bg-opacity-60 transition-colors
            ${isResizing ? 'bg-purple-500 bg-opacity-80' : 'bg-gray-300 bg-opacity-50'}
            group
          `}
          style={{ 
            touchAction: 'none',
            zIndex: 50,
            width: '8px',
            marginRight: '-4px',
            pointerEvents: 'auto'
          }}
          title="Drag to resize sidebar • Double-click to reset"
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-48 bg-purple-500 rounded-l opacity-50 group-hover:opacity-100 transition-opacity" />
          
          <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-60 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="flex flex-col gap-2">
              <div className="w-2 h-2 rounded-full bg-purple-700"></div>
              <div className="w-2 h-2 rounded-full bg-purple-700"></div>
              <div className="w-2 h-2 rounded-full bg-purple-700"></div>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

