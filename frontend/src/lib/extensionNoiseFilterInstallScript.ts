/**
 * Extension noise filter — source for /public/extension-noise-filter.js and client re-patch.
 * Do not inline via dangerouslySetInnerHTML (breaks HTML parsing / hydration).
 */
export const EXTENSION_NOISE_FILTER_BODY = `
(function () {
  if (typeof window === 'undefined') return
  if (window.__fserpExtNoiseFilter) return
  window.__fserpExtNoiseFilter = 1

  var NOISE =
    /message channel closed before a response was received|listener indicated an asynchronous response|extension context invalidated/i

  function isNoisyReason(reason) {
    if (reason == null) return false
    try {
      if (typeof reason === 'string') return NOISE.test(reason)
      if (reason instanceof Error) {
        var msg = reason.message || ''
        var stack = reason.stack || ''
        return NOISE.test(msg) || NOISE.test(stack) || NOISE.test(String(reason))
      }
      if (typeof reason === 'object') {
        if (reason.message && NOISE.test(String(reason.message))) return true
        if (reason.stack && NOISE.test(String(reason.stack))) return true
      }
      return NOISE.test(String(reason))
    } catch (e) {
      return false
    }
  }

  function argsAreNoisy(args) {
    for (var i = 0; i < args.length; i++) {
      if (isNoisyReason(args[i])) return true
    }
    return NOISE.test(Array.prototype.join.call(args, ' '))
  }

  function swallowRejection(event) {
    if (!event || !isNoisyReason(event.reason)) return false
    event.preventDefault()
    event.stopPropagation()
    try {
      event.stopImmediatePropagation()
    } catch (e) {}
    return true
  }

  function patchConsoleMethod(method) {
    var storageKey = '__fserpOrig_' + method
    var original = console[storageKey]
    if (!original) {
      original = console[method].bind(console)
      console[storageKey] = original
    }
    console[method] = function () {
      if (argsAreNoisy(arguments)) return
      return original.apply(console, arguments)
    }
  }

  function patchConsole() {
    patchConsoleMethod('error')
    patchConsoleMethod('warn')
  }

  function patchReportError() {
    var reportErrorFn = globalThis.reportError
    if (typeof reportErrorFn !== 'function' || reportErrorFn.__fserpPatched) return
    var original = reportErrorFn.bind(globalThis)
    var wrapped = function (err) {
      if (isNoisyReason(err)) return
      return original(err)
    }
    wrapped.__fserpPatched = 1
    globalThis.reportError = wrapped
  }

  function onWindowError(event) {
    if (!event) return false
    if (isNoisyReason(event.message) || isNoisyReason(event.error)) {
      event.preventDefault()
      event.stopPropagation()
      try {
        event.stopImmediatePropagation()
      } catch (e) {}
      return true
    }
    return false
  }

  function installOnce() {
    if (!window.__fserpExtNoiseFilterInstalled) {
      window.__fserpExtNoiseFilterInstalled = 1
      window.addEventListener('unhandledrejection', swallowRejection, true)
      window.addEventListener('error', onWindowError, true)
      var previous = window.onunhandledrejection
      window.onunhandledrejection = function (event) {
        if (swallowRejection(event)) return true
        if (typeof previous === 'function') return previous.call(this, event)
      }
    }
    patchConsole()
    patchReportError()
  }

  window.__fserpRefreshExtensionNoiseFilter = installOnce

  installOnce()
  document.addEventListener('DOMContentLoaded', installOnce)
  window.addEventListener('load', installOnce)
  window.addEventListener('pageshow', installOnce)
  setInterval(installOnce, 1500)
})()
`

/** Re-apply filter after client navigation / HMR. */
export function ensureExtensionNoiseFilter(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & {
    __fserpRefreshExtensionNoiseFilter?: () => void
  }
  if (typeof w.__fserpRefreshExtensionNoiseFilter === 'function') {
    w.__fserpRefreshExtensionNoiseFilter()
    return
  }
  try {
    new Function(EXTENSION_NOISE_FILTER_BODY)()
  } catch {
    /* ignore */
  }
}
