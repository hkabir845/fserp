/** Shared PWA / home-screen install helpers. */

export const BRAIN_MANIFEST_URL = '/brain-app/manifest.webmanifest'

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isIosLike(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export function isAndroidBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

export function isDesktopLike(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (isIosLike() || isAndroidBrowser()) return false
  return !/Mobile|Tablet/i.test(ua)
}

/** In-app browsers (WhatsApp, Facebook, etc.) often block install / Add to Home Screen. */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /FBAN|FBAV|Instagram|Line\/|WhatsApp|Twitter|LinkedInApp|GSA\/|MicroMessenger/i.test(ua)
}

export function isIosInAppBrowser(): boolean {
  return isIosLike() && isInAppBrowser()
}

export function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (!isIosLike()) return false
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)
}

/** Copy page URL so user can paste into Safari/Chrome (in-app browsers block install). */
export async function copyPageUrlForExternalBrowser(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const url = window.location.href
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = url
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export type InstallUiMode =
  | 'chromium_prompt'
  | 'ios'
  | 'android_manual'
  | 'desktop_manual'
  | 'in_app'
  | 'generic'

export function detectInstallUiMode(hasInstallPrompt: boolean): InstallUiMode {
  if (hasInstallPrompt) return 'chromium_prompt'
  if (isInAppBrowser()) return 'in_app'
  if (isIosLike()) return 'ios'
  if (isAndroidBrowser()) return 'android_manual'
  if (isDesktopLike()) return 'desktop_manual'
  return 'generic'
}

/** Link Brain manifest + icons so install works on any browser that supports PWAs. */
export function applyBrainPwaDocumentHead(): void {
  if (typeof document === 'undefined') return

  const ensureLink = (rel: string, href: string, attrs?: Record<string, string>) => {
    const selector = `link[rel="${rel}"][data-brain-pwa="1"]`
    let el = document.querySelector<HTMLLinkElement>(selector)
    if (!el) {
      el = document.createElement('link')
      el.rel = rel
      el.setAttribute('data-brain-pwa', '1')
      document.head.appendChild(el)
    }
    el.href = href
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    }
  }

  ensureLink('manifest', BRAIN_MANIFEST_URL)
  ensureLink('apple-touch-icon', '/brain-app/icon-192.png')

  // Root layout adds FS ERP manifest — remove so Brain PWA is installable on this page.
  document.querySelectorAll('link[rel="manifest"]').forEach((node) => {
    const link = node as HTMLLinkElement
    if (!link.hasAttribute('data-brain-pwa')) {
      link.remove()
    }
  })

  const ensureMeta = (name: string, content: string) => {
    const selector = `meta[name="${name}"][data-brain-pwa="1"]`
    let el = document.querySelector<HTMLMetaElement>(selector)
    if (!el) {
      el = document.createElement('meta')
      el.name = name
      el.setAttribute('data-brain-pwa', '1')
      document.head.appendChild(el)
    }
    el.content = content
  }

  ensureMeta('apple-mobile-web-app-capable', 'yes')
  ensureMeta('apple-mobile-web-app-title', 'Company Brain')
  ensureMeta('mobile-web-app-capable', 'yes')
}
