/**
 * User-visible message from a failed API JSON body (Django/DRF shapes + empty {}).
 */
export function formatJsonApiError(
  data: unknown,
  fallback: string,
  response?: Pick<Response, 'status' | 'statusText'>
): string {
  if (data === null || data === undefined) {
    return withStatus(fallback, response)
  }
  if (typeof data === 'string' && data.trim()) {
    return data.trim()
  }
  if (typeof data !== 'object') {
    return withStatus(fallback, response)
  }

  const d = data as Record<string, unknown>

  if (typeof d.detail === 'string' && d.detail.trim()) {
    return d.detail.trim()
  }
  if (Array.isArray(d.detail)) {
    const parts = d.detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg?: unknown }).msg ?? '')
        }
        try {
          return JSON.stringify(item)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    if (parts.length) return parts.join(' ')
  }
  if (d.detail !== null && typeof d.detail === 'object') {
    try {
      const s = JSON.stringify(d.detail)
      if (s !== '{}') return s
    } catch {
      /* fall through */
    }
  }

  if (typeof d.message === 'string' && d.message.trim()) {
    return d.message.trim()
  }
  if (typeof d.error === 'string' && d.error.trim()) {
    return d.error.trim()
  }

  const fieldParts: string[] = []
  for (const [key, val] of Object.entries(d)) {
    if (key === 'detail' || key === 'message' || key === 'error') continue
    if (typeof val === 'string' && val.trim()) {
      fieldParts.push(`${key}: ${val.trim()}`)
    } else if (Array.isArray(val)) {
      const inner = val
        .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
        .filter(Boolean)
      if (inner.length) fieldParts.push(`${key}: ${inner.join(', ')}`)
    }
  }
  if (fieldParts.length) return fieldParts.join('; ')

  if (Object.keys(d).length === 0) {
    return withStatus(fallback, response)
  }

  return withStatus(fallback, response)
}

function withStatus(fallback: string, response?: Pick<Response, 'status' | 'statusText'>): string {
  if (!response?.status) return fallback
  const code = response.status
  const text = (response.statusText || '').trim()
  if (text) return `${fallback} (HTTP ${code} ${text})`
  return `${fallback} (HTTP ${code})`
}
