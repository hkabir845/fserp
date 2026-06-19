/**
 * Offset pagination helpers aligned with Django list views using `paged=1`, `skip`, `limit`.
 */

type OffsetPaged<T> = {
  count: number
  skip: number
  limit: number
  results: T[]
  stats?: Record<string, unknown>
}

export function isOffsetPagedPayload(x: unknown): x is OffsetPaged<unknown> {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.count === 'number' && Array.isArray(o.results)
}

/** Unwrap list endpoints that return either a bare array or `{ results: [...] }`. */
export function unwrapReferenceList<T>(data: unknown): T[] {
  if (isOffsetPagedPayload(data)) return data.results as T[]
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.results)) return o.results as T[]
    if (Array.isArray(o.data)) return o.data as T[]
  }
  return []
}

export const OFFSET_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const

/** Max rows for dropdown/reference fetches (vendors, customers, items). */
export const REFERENCE_FETCH_LIMIT = 500

export function offsetListParams(opts: {
  page: number
  pageSize: number
  q?: string
  sort?: string
  dir?: 'asc' | 'desc'
  extra?: Record<string, string | number | boolean | undefined | null>
}): Record<string, string> {
  const page = Math.max(1, opts.page)
  const pageSize = Math.max(1, opts.pageSize)
  const skip = (page - 1) * pageSize
  const params: Record<string, string> = {
    paged: '1',
    skip: String(skip),
    limit: String(pageSize),
  }
  const qt = opts.q?.trim()
  if (qt) params.q = qt
  if (opts.sort) params.sort = opts.sort
  if (opts.dir) params.dir = opts.dir
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) {
      if (v === undefined || v === null || v === '') continue
      params[k] = String(v)
    }
  }
  return params
}
