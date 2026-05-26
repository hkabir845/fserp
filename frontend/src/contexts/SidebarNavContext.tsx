'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const SIDEBAR_NAV_OPEN_KEY = 'fserp_sidebar_nav_open'
/** Sidebar stays docked from this width up (tablets in landscape). */
const DESKTOP_BREAKPOINT_PX = 768

type SidebarNavContextValue = {
  /** Off-canvas drawer open (mobile/tablet); ignored when `isDesktopLayout`. */
  navOpen: boolean
  setNavOpen: (open: boolean) => void
  isDesktopLayout: boolean
}

function persistNavOpen(open: boolean) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(SIDEBAR_NAV_OPEN_KEY, open ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const SidebarNavContext = createContext<SidebarNavContextValue | null>(null)

export function SidebarNavProvider({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpenState] = useState(false)
  const [isDesktopLayout, setIsDesktopLayout] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (sessionStorage.getItem(SIDEBAR_NAV_OPEN_KEY) === '1') {
        setNavOpenState(true)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`)
    const sync = () => setIsDesktopLayout(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const setNavOpen = useCallback((open: boolean) => {
    setNavOpenState(open)
    persistNavOpen(open)
  }, [])

  const value = useMemo(
    () => ({ navOpen, setNavOpen, isDesktopLayout }),
    [navOpen, setNavOpen, isDesktopLayout]
  )

  return <SidebarNavContext.Provider value={value}>{children}</SidebarNavContext.Provider>
}

export function useSidebarNav(): SidebarNavContextValue {
  const ctx = useContext(SidebarNavContext)
  if (!ctx) {
    throw new Error('useSidebarNav must be used within SidebarNavProvider')
  }
  return ctx
}
