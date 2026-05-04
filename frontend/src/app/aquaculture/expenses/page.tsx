'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Package, Plus, RefreshCw, Store, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'

interface Pond {
  id: number
  name: string
}
interface Cat {
  id: string
  label: string
  hint?: string | null
}
interface PondShare {
  pond_id: number
  pond_name: string
  amount: string
}
interface CycleRow {
  id: number
  name: string
}
interface StationRow {
  id: number
  station_name: string
  is_active: boolean
  default_aquaculture_pond_id?: number | null
}
interface ItemOpt {
  id: number
  name: string
  category: string
  tracks_inventory: boolean
}
interface VendorSuggestion {
  id: number
  display_name?: string | null
  company_name?: string | null
  vendor_number?: string | null
  is_active?: boolean
}

function vendorPickLabel(v: VendorSuggestion): string {
  const d = (v.display_name || '').trim()
  if (d) return d
  const c = (v.company_name || '').trim()
  if (c) return c
  const n = (v.vendor_number || '').trim()
  return n ? `Vendor ${n}` : `Vendor #${v.id}`
}

function normalizeVendorsFromApi(data: unknown): VendorSuggestion[] {
  let rows: unknown[] = []
  if (Array.isArray(data)) rows = data
  else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.results)) rows = o.results
  }
  return rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .flatMap((r) => {
      const id = typeof r.id === 'number' ? r.id : Number(r.id)
      if (!Number.isFinite(id)) return []
      if (r.is_active === false) return []
      return [
        {
          id,
          display_name: r.display_name != null ? String(r.display_name) : null,
          company_name: r.company_name != null ? String(r.company_name) : null,
          vendor_number: r.vendor_number != null ? String(r.vendor_number) : null,
          is_active: r.is_active !== false,
        },
      ]
    })
}
interface ExpenseRow {
  id: number
  pond_id: number | null
  pond_name: string
  is_shared?: boolean
  pond_shares?: PondShare[]
  production_cycle_id?: number | null
  production_cycle_name?: string
  expense_category: string
  expense_category_label: string
  expense_date: string
  amount: string
  memo: string
  vendor_name: string
  source_station_id?: number | null
  source_station_name?: string
  feed_sack_count?: string | null
  feed_weight_kg?: string | null
}

type CostMode = 'direct' | 'shared_equal' | 'shared_manual'

export default function AquacultureExpensesPage() {
  const toast = useToast()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [cats, setCats] = useState<Cat[]>([])
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [currency, setCurrency] = useState('BDT')
  const [filterPond, setFilterPond] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<ExpenseRow | null>(null)
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [stations, setStations] = useState<StationRow[]>([])
  const [shopIssueOpen, setShopIssueOpen] = useState(false)
  const [shopCatalog, setShopCatalog] = useState<ItemOpt[]>([])
  const [shopCatalogLoading, setShopCatalogLoading] = useState(false)
  const [shopStationId, setShopStationId] = useState('')
  const [shopPondId, setShopPondId] = useState('')
  const [shopCycleId, setShopCycleId] = useState('')
  const [shopCategory, setShopCategory] = useState('')
  const [shopDate, setShopDate] = useState('')
  const [shopMemo, setShopMemo] = useState('')
  const [shopVendor, setShopVendor] = useState('Shop stock')
  const [shopLines, setShopLines] = useState<{ item_id: string; quantity: string }[]>([
    { item_id: '', quantity: '' },
  ])
  const [shopCycles, setShopCycles] = useState<CycleRow[]>([])
  const [shopIssueBusy, setShopIssueBusy] = useState(false)
  const [shopFeedSackCount, setShopFeedSackCount] = useState('')
  const [shopFeedWeightKg, setShopFeedWeightKg] = useState('')
  const [vendors, setVendors] = useState<VendorSuggestion[]>([])
  const [form, setForm] = useState({
    cost_mode: 'direct' as CostMode,
    pond_id: '',
    production_cycle_id: '',
    expense_category: '',
    expense_date: '',
    amount: '',
    vendor_name: '',
    memo: '',
    feed_sack_count: '',
    feed_weight_kg: '',
    shared_pond_ids: [] as string[],
    manual_shares: [] as { pond_id: string; amount: string }[],
  })

  const loadMeta = useCallback(async () => {
    try {
      const [co, pRes, cRes, stRes, vRes] = await Promise.all([
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<Pond[]>('/aquaculture/ponds/'),
        api.get<Cat[]>('/aquaculture/expense-categories/'),
        api.get<StationRow[]>('/stations/'),
        api.get<unknown>('/vendors/').catch(() => ({ data: [] })),
      ])
      setCurrency(String(co.data?.currency || 'BDT').slice(0, 3))
      setPonds(Array.isArray(pRes.data) ? pRes.data : [])
      setCats(Array.isArray(cRes.data) ? cRes.data : [])
      const stList = (Array.isArray(stRes.data) ? stRes.data : []).filter((s) => s.is_active !== false)
      setStations(stList)
      setVendors(normalizeVendorsFromApi(vRes.data))
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load form data'))
    }
  }, [toast])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterPond ? { pond_id: filterPond } : undefined
      const { data } = await api.get<ExpenseRow[]>('/aquaculture/expenses/', { params })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load expenses'))
    } finally {
      setLoading(false)
    }
  }, [toast, filterPond])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  useEffect(() => {
    if (!stations.length) return
    if (!shopStationId || !stations.some((s) => String(s.id) === shopStationId)) {
      setShopStationId(String(stations[0].id))
    }
  }, [stations, shopStationId])

  useEffect(() => {
    const st = stations.find((s) => String(s.id) === shopStationId)
    if (st?.default_aquaculture_pond_id != null) {
      setShopPondId(String(st.default_aquaculture_pond_id))
    }
  }, [shopStationId, stations])

  useEffect(() => {
    if (!shopIssueOpen) return
    setShopDate((d) => d || new Date().toISOString().slice(0, 10))
    setShopCategory((c) => {
      if (c) return c
      if (!cats.length) return ''
      const feed = cats.find((x) => x.id === 'feed_purchase')
      return feed?.id ?? cats[0].id
    })
  }, [shopIssueOpen, cats])

  useEffect(() => {
    if (!shopIssueOpen || shopCatalog.length > 0 || shopCatalogLoading) return
    void (async () => {
      setShopCatalogLoading(true)
      try {
        const { data } = await api.get<ItemOpt[]>('/items/', { params: { pos_only: 'true' } })
        const rows = (Array.isArray(data) ? data : []).filter((it) => it.tracks_inventory)
        setShopCatalog(rows)
      } catch (e) {
        toast.error(extractErrorMessage(e, 'Could not load items for shop issue'))
      } finally {
        setShopCatalogLoading(false)
      }
    })()
  }, [shopIssueOpen, shopCatalog.length, shopCatalogLoading, toast])

  useEffect(() => {
    if (!shopPondId) {
      setShopCycles([])
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', {
          params: { pond_id: shopPondId },
        })
        setShopCycles(Array.isArray(data) ? data : [])
      } catch {
        setShopCycles([])
      }
    })()
  }, [shopPondId])

  useEffect(() => {
    const pid = form.pond_id
    if (!modal || form.cost_mode !== 'direct' || !pid) {
      setCycles([])
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', { params: { pond_id: pid } })
        setCycles(Array.isArray(data) ? data : [])
      } catch {
        setCycles([])
      }
    })()
  }, [modal, form.cost_mode, form.pond_id])

  const sym = getCurrencySymbol(currency)

  const toggleSharedPond = (id: string) => {
    setForm((f) => {
      const has = f.shared_pond_ids.includes(id)
      const shared_pond_ids = has ? f.shared_pond_ids.filter((x) => x !== id) : [...f.shared_pond_ids, id]
      return { ...f, shared_pond_ids }
    })
  }

  const openNew = () => {
    setEditing(null)
    const today = new Date().toISOString().slice(0, 10)
    const defaultPond =
      filterPond && ponds.some((p) => String(p.id) === filterPond)
        ? filterPond
        : ponds[0]
          ? String(ponds[0].id)
          : ''
    setForm({
      cost_mode: 'direct',
      pond_id: defaultPond,
      production_cycle_id: '',
      expense_category: cats[0]?.id || '',
      expense_date: today,
      amount: '',
      vendor_name: '',
      memo: '',
      feed_sack_count: '',
      feed_weight_kg: '',
      shared_pond_ids: [],
      manual_shares: [
        { pond_id: '', amount: '' },
        { pond_id: '', amount: '' },
      ],
    })
    setModal(true)
  }

  const openEdit = (r: ExpenseRow) => {
    setEditing(r)
    if (r.is_shared) {
      const sh = r.pond_shares ?? []
      setForm({
        cost_mode: sh.length >= 2 ? 'shared_manual' : 'shared_equal',
        pond_id: '',
        production_cycle_id: '',
        expense_category: r.expense_category,
        expense_date: r.expense_date.slice(0, 10),
        amount: r.amount,
        vendor_name: r.vendor_name || '',
        memo: r.memo || '',
        feed_sack_count: r.feed_sack_count != null ? String(r.feed_sack_count) : '',
        feed_weight_kg: r.feed_weight_kg != null ? String(r.feed_weight_kg) : '',
        shared_pond_ids: sh.map((s) => String(s.pond_id)),
        manual_shares:
          sh.length >= 2
            ? sh.map((s) => ({ pond_id: String(s.pond_id), amount: s.amount }))
            : [
                { pond_id: '', amount: '' },
                { pond_id: '', amount: '' },
              ],
      })
    } else {
      setForm({
        cost_mode: 'direct',
        pond_id: String(r.pond_id ?? ''),
        production_cycle_id: r.production_cycle_id != null ? String(r.production_cycle_id) : '',
        expense_category: r.expense_category,
        expense_date: r.expense_date.slice(0, 10),
        amount: r.amount,
        vendor_name: r.vendor_name || '',
        memo: r.memo || '',
        feed_sack_count: r.feed_sack_count != null ? String(r.feed_sack_count) : '',
        feed_weight_kg: r.feed_weight_kg != null ? String(r.feed_weight_kg) : '',
        shared_pond_ids: [],
        manual_shares: [
          { pond_id: '', amount: '' },
          { pond_id: '', amount: '' },
        ],
      })
    }
    setModal(true)
  }

  const save = async () => {
    if (!form.expense_category || !form.expense_date) {
      toast.error('Category and date are required')
      return
    }
    const amt = Number(form.amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Amount must be a positive number')
      return
    }
    const base = {
      expense_category: form.expense_category,
      expense_date: form.expense_date,
      amount: amt,
      vendor_name: form.vendor_name.trim(),
      memo: form.memo.trim(),
    }
    const mergeFeedPurchaseMetrics = (payload: Record<string, unknown>) => {
      if (form.expense_category !== 'feed_purchase') return
      const pairs: [string, string, string][] = [
        ['feed_sack_count', 'Number of sacks', form.feed_sack_count.trim()],
        ['feed_weight_kg', 'Feed weight (kg)', form.feed_weight_kg.trim()],
      ]
      for (const [apiKey, label, val] of pairs) {
        if (val === '') {
          if (editing) payload[apiKey] = null
          continue
        }
        const n = Number(val)
        if (!Number.isFinite(n) || n < 0) {
          toast.error(`${label} must be a non-negative number`)
          throw new Error('validation')
        }
        payload[apiKey] = n
      }
    }
    try {
      if (form.cost_mode !== 'direct') {
        if (form.cost_mode === 'shared_equal') {
          const ids = form.shared_pond_ids.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n))
          if (ids.length < 2) {
            toast.error('Pick at least two ponds for an equal split')
            return
          }
          const payload: Record<string, unknown> = { ...base, shared_equal_pond_ids: ids }
          mergeFeedPurchaseMetrics(payload)
          if (editing) {
            await api.put(`/aquaculture/expenses/${editing.id}/`, { ...payload, pond_id: null })
            toast.success('Updated')
          } else {
            await api.post('/aquaculture/expenses/', { ...payload, pond_id: null })
            toast.success('Saved')
          }
        } else {
          const lines = form.manual_shares
            .map((l) => ({
              pond_id: parseInt(l.pond_id, 10),
              amount: Number(l.amount),
            }))
            .filter((l) => Number.isFinite(l.pond_id) && Number.isFinite(l.amount) && l.amount > 0)
          if (lines.length < 2) {
            toast.error('Enter at least two pond share lines with positive amounts')
            return
          }
          const payload: Record<string, unknown> = {
            ...base,
            pond_shares: lines.map((l) => ({ pond_id: l.pond_id, amount: String(l.amount) })),
          }
          mergeFeedPurchaseMetrics(payload)
          if (editing) {
            await api.put(`/aquaculture/expenses/${editing.id}/`, { ...payload, pond_id: null })
            toast.success('Updated')
          } else {
            await api.post('/aquaculture/expenses/', { ...payload, pond_id: null })
            toast.success('Saved')
          }
        }
      } else {
        if (!form.pond_id) {
          toast.error('Pond is required for a direct cost')
          return
        }
        const payload: Record<string, unknown> = {
          ...base,
          pond_id: parseInt(form.pond_id, 10),
        }
        if (form.production_cycle_id) {
          payload.production_cycle_id = parseInt(form.production_cycle_id, 10)
        }
        mergeFeedPurchaseMetrics(payload)
        if (editing) {
          await api.put(`/aquaculture/expenses/${editing.id}/`, payload)
          toast.success('Updated')
        } else {
          await api.post('/aquaculture/expenses/', payload)
          toast.success('Saved')
        }
      }
      setModal(false)
      void loadRows()
    } catch (e) {
      if (e instanceof Error && e.message === 'validation') return
      toast.error(extractErrorMessage(e, 'Save failed'))
    }
  }

  const remove = async (r: ExpenseRow) => {
    if (!window.confirm('Delete this expense?')) return
    try {
      await api.delete(`/aquaculture/expenses/${r.id}/`)
      toast.success('Deleted')
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  const submitShopStockIssue = async () => {
    const sid = parseInt(shopStationId, 10)
    const pid = parseInt(shopPondId, 10)
    if (!Number.isFinite(sid) || !Number.isFinite(pid)) {
      toast.error('Choose station and pond')
      return
    }
    if (!shopCategory || !shopDate) {
      toast.error('Category and date are required')
      return
    }
    const lines = shopLines
      .map((l) => ({
        item_id: parseInt(l.item_id, 10),
        quantity: Number(l.quantity),
      }))
      .filter((l) => Number.isFinite(l.item_id) && Number.isFinite(l.quantity) && l.quantity > 0)
    if (!lines.length) {
      toast.error('Add at least one line with item and quantity')
      return
    }
    setShopIssueBusy(true)
    try {
      const body: Record<string, unknown> = {
        station_id: sid,
        pond_id: pid,
        expense_category: shopCategory,
        expense_date: shopDate,
        items: lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
        memo: shopMemo.trim(),
        vendor_name: shopVendor.trim() || 'Shop stock',
      }
      if (shopCycleId) {
        const cy = parseInt(shopCycleId, 10)
        if (Number.isFinite(cy)) body.production_cycle_id = cy
      }
      if (shopCategory === 'feed_purchase') {
        const fs = shopFeedSackCount.trim()
        const fk = shopFeedWeightKg.trim()
        if (fs !== '') {
          const n = Number(fs)
          if (!Number.isFinite(n) || n < 0) {
            toast.error('Number of sacks must be a non-negative number')
            return
          }
          body.feed_sack_count = n
        }
        if (fk !== '') {
          const n = Number(fk)
          if (!Number.isFinite(n) || n < 0) {
            toast.error('Feed weight (kg) must be a non-negative number')
            return
          }
          body.feed_weight_kg = n
        }
      }
      await api.post('/aquaculture/shop-stock-issue/', body)
      toast.success('Internal stock issue recorded (at-cost path; not a POS sale)')
      setShopLines([{ item_id: '', quantity: '' }])
      setShopFeedSackCount('')
      setShopFeedWeightKg('')
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Issue failed'))
    } finally {
      setShopIssueBusy(false)
    }
  }

  const pondCell = (r: ExpenseRow) => {
    if (r.is_shared) {
      const n = r.pond_shares?.length ?? 0
      return (
        <span className="text-slate-700">
          Shared <span className="text-slate-500">({n} ponds)</span>
        </span>
      )
    }
    return r.pond_name || '—'
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <datalist id="aquaculture-vendor-suggestions">
        {vendors.map((v) => (
          <option key={v.id} value={vendorPickLabel(v)} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="aq-expenses-title" className="text-xl font-bold tracking-tight text-slate-900">
            Operating expenses
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            <span className="font-medium text-slate-800">Shop inventory (feed sacks, medicine SKUs):</span> ring them
            out on <Link href="/cashier" className="font-medium text-teal-800 underline">Cashier (POS)</Link> on account
            to the customer linked on each pond (
            <Link href="/aquaculture/ponds" className="font-medium text-teal-800 underline">
              Ponds
            </Link>
            )—that keeps perpetual SKU quantity and GL aligned with{' '}
            <Link href="/inventory" className="font-medium text-teal-800 underline">Inventory</Link>. Fish kg and head
            in the pond are tracked under{' '}
            <Link href="/aquaculture/stock" className="font-medium text-teal-800 underline">Fish stock</Link> and{' '}
            <Link href="/aquaculture/sales" className="font-medium text-teal-800 underline">Pond sales</Link>, not here.{' '}
            <span className="font-medium text-slate-800">This screen</span> is for operating costs paid in cash, shared
            splits, vendor bills not through POS, and management categories (lease, power, labour, etc.).{' '}
            <span className="font-medium text-slate-800">Direct cost:</span> one pond (optional production cycle).{' '}
            <span className="font-medium text-slate-800">Shared cost:</span> leave pond unset and split across at least
            two ponds; shared lines cannot use a production cycle.{' '}
            <span className="font-medium text-slate-800">Miscellaneous</span> covers boats, repairs, casual labour, site
            meals, and anything else—use Memo. For feed lines, add sacks/kg when the category is Feed purchase.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            Filter pond
            <select
              className="ml-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={filterPond}
              onChange={(e) => setFilterPond(e.target.value)}
            >
              <option value="">All</option>
              {ponds.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadRows()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={loading || ponds.length === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add expense
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : ponds.length === 0 ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-950">
          <p className="font-medium">Create a pond first</p>
          <Link href="/aquaculture/ponds" className="mt-2 inline-block font-medium text-teal-800 underline">
            Go to Ponds
          </Link>
        </div>
      ) : (
        <>
        <div className="mt-6 rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50/90 to-white px-4 py-4 text-sm text-slate-800 shadow-sm">
          <p className="font-semibold text-teal-950">Recommended: stock to ponds via POS on account</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-slate-700">
            <li>
              On <Link href="/aquaculture/ponds" className="font-medium text-teal-800 underline">Ponds</Link>, each new
              production unit gets a POS customer automatically; change or clear there if you use a different AR
              account.
            </li>
            <li>
              Open{' '}
              <Link href="/cashier" className="inline-flex items-center gap-1 font-medium text-teal-800 underline">
                <Store className="h-3.5 w-3.5" aria-hidden />
                Cashier
              </Link>{' '}
              (or use “Open POS” from the pond row), add inventoried lines, and settle on account for that customer.
            </li>
            <li>
              On the pond list, use <span className="font-medium text-slate-800">Ledger</span> or{' '}
              <span className="font-medium text-slate-800">POS</span> shortcuts on each row to review A/R or sell again.
            </li>
          </ol>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Record non-POS spend below. Only use the advanced internal issue if you intentionally move stock at average
            cost without a POS sale—and never for the same physical goods already invoiced on POS.
          </p>
        </div>
        <details
          className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-800"
          open={shopIssueOpen}
          onToggle={(e) => setShopIssueOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer select-none font-medium text-slate-800">
            <Package className="mr-1 inline h-4 w-4 align-text-bottom text-slate-600" aria-hidden />
            Advanced: internal stock issue at cost (optional)
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Bypasses POS: decrements station quantity, posts COGS / inventory at average cost, and creates one pond
            expense. Use sparingly—for example a true internal transfer with no sale document. Items need cost or unit
            price and sufficient per-station QOH. You can set each station&apos;s default pond on the{' '}
            <Link href="/stations" className="font-medium text-teal-800 underline">
              Stations
            </Link>{' '}
            page (optional prefill only).
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-700">
              Station
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={shopStationId}
                onChange={(e) => setShopStationId(e.target.value)}
              >
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.station_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Pond
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={shopPondId}
                onChange={(e) => {
                  setShopPondId(e.target.value)
                  setShopCycleId('')
                }}
              >
                <option value="">Select pond</option>
                {ponds.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700 sm:col-span-2">
              Production cycle (optional)
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={shopCycleId}
                onChange={(e) => setShopCycleId(e.target.value)}
                disabled={!shopPondId}
              >
                <option value="">None</option>
                {shopCycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700 sm:col-span-2">
              Category
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={shopCategory}
                onChange={(e) => {
                  setShopCategory(e.target.value)
                  setShopFeedSackCount('')
                  setShopFeedWeightKg('')
                }}
              >
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {shopCategory === 'feed_purchase' ? (
              <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-700">
                  Feed sacks (optional)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                    value={shopFeedSackCount}
                    onChange={(e) => setShopFeedSackCount(e.target.value)}
                    placeholder="e.g. 12"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  Feed total kg (optional)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                    value={shopFeedWeightKg}
                    onChange={(e) => setShopFeedWeightKg(e.target.value)}
                    placeholder="Equivalent kg"
                  />
                </label>
              </div>
            ) : null}
            <label className="block text-xs font-medium text-slate-700">
              Date
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={shopDate}
                onChange={(e) => setShopDate(e.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Vendor (optional)
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                list="aquaculture-vendor-suggestions"
                autoComplete="off"
                placeholder={vendors.length ? 'Pick from list or type a name' : 'Type vendor name'}
                value={shopVendor}
                onChange={(e) => setShopVendor(e.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-slate-700 sm:col-span-2">
              Memo
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={shopMemo}
                onChange={(e) => setShopMemo(e.target.value)}
                placeholder="e.g. Pond A — weekly feed from depot"
              />
            </label>
          </div>
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium text-slate-600">Lines (inventory items)</p>
            {shopCatalogLoading ? (
              <p className="text-xs text-slate-500">Loading items…</p>
            ) : null}
            {shopLines.map((row, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-2">
                <label className="min-w-[10rem] flex-1 text-xs text-slate-600">
                  Item
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    value={row.item_id}
                    onChange={(e) => {
                      const next = [...shopLines]
                      next[idx] = { ...next[idx], item_id: e.target.value }
                      setShopLines(next)
                    }}
                  >
                    <option value="">—</option>
                    {shopCatalog.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                        {it.category ? ` (${it.category})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-28 text-xs text-slate-600">
                  Qty
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                    value={row.quantity}
                    onChange={(e) => {
                      const next = [...shopLines]
                      next[idx] = { ...next[idx], quantity: e.target.value }
                      setShopLines(next)
                    }}
                  />
                </label>
                {shopLines.length > 1 ? (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => setShopLines((lines) => lines.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="text-xs font-medium text-teal-800 hover:underline"
              onClick={() => setShopLines((lines) => [...lines, { item_id: '', quantity: '' }])}
            >
              Add line
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={shopIssueBusy || !shopPondId}
              onClick={() => void submitShopStockIssue()}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {shopIssueBusy ? 'Working…' : 'Issue stock & record pond cost'}
            </button>
          </div>
        </details>
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm" aria-labelledby="aq-expenses-title">
            <caption className="sr-only">Aquaculture operating expenses</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Date
                </th>
                <th scope="col" className="px-3 py-2">
                  Pond / split
                </th>
                <th scope="col" className="px-3 py-2">
                  Cycle
                </th>
                <th scope="col" className="px-3 py-2">
                  Category
                </th>
                <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">
                  Sacks
                </th>
                <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">
                  Kg
                </th>
                <th scope="col" className="px-3 py-2 max-w-[100px]">
                  Source
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Amount
                </th>
                <th scope="col" className="px-3 py-2">
                  Vendor
                </th>
                <th scope="col" className="px-3 py-2 w-24">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateOnly(r.expense_date)}</td>
                  <td className="px-3 py-2">{pondCell(r)}</td>
                  <td className="px-3 py-2 text-slate-600">{r.production_cycle_name || '—'}</td>
                  <td className="px-3 py-2">{r.expense_category_label || r.expense_category}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {r.feed_sack_count != null && r.feed_sack_count !== '' ? r.feed_sack_count : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {r.feed_weight_kg != null && r.feed_weight_kg !== '' ? r.feed_weight_kg : '—'}
                  </td>
                  <td className="px-3 py-2 max-w-[120px] truncate text-slate-600" title={r.source_station_name || ''}>
                    {r.source_station_name ? (
                      <span className="text-teal-800">{r.source_station_name}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {sym}
                    {formatNumber(Number(r.amount))}
                  </td>
                  <td className="px-3 py-2 max-w-[140px] truncate text-slate-600">{r.vendor_name || '—'}</td>
                  <td className="px-3 py-2">
                    <button type="button" className="text-blue-600 hover:underline mr-2" onClick={() => openEdit(r)}>
                      Edit
                    </button>
                    <button type="button" className="text-red-600 hover:underline" onClick={() => void remove(r)}>
                      <Trash2 className="h-4 w-4 inline" />
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                    No expenses in this view.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">{editing ? 'Edit expense' : 'New expense'}</h2>
            <div className="mt-4 space-y-3">
              <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
                <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Cost type</legend>
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="cost_mode"
                    checked={form.cost_mode === 'direct'}
                    onChange={() => setForm((f) => ({ ...f, cost_mode: 'direct' }))}
                  />
                  Direct to one pond
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="cost_mode"
                    checked={form.cost_mode === 'shared_equal'}
                    onChange={() => setForm((f) => ({ ...f, cost_mode: 'shared_equal' }))}
                  />
                  Shared — equal split
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="cost_mode"
                    checked={form.cost_mode === 'shared_manual'}
                    onChange={() => setForm((f) => ({ ...f, cost_mode: 'shared_manual' }))}
                  />
                  Shared — manual amounts
                </label>
              </fieldset>

              {form.cost_mode === 'direct' ? (
                <>
                  <label className="block text-sm font-medium text-slate-700">
                    Pond
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={form.pond_id}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, pond_id: e.target.value, production_cycle_id: '' }))
                      }
                    >
                      {ponds.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Production cycle (optional)
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={form.production_cycle_id}
                      onChange={(e) => setForm((f) => ({ ...f, production_cycle_id: e.target.value }))}
                    >
                      <option value="">None</option>
                      {cycles.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : form.cost_mode === 'shared_equal' ? (
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-medium text-slate-600">Select at least two ponds</p>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {ponds.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={form.shared_pond_ids.includes(String(p.id))}
                            onChange={() => toggleSharedPond(String(p.id))}
                          />
                          {p.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-600">Each line: pond and amount (≥2 rows; amounts must sum to total)</p>
                  {form.manual_shares.map((row, idx) => (
                    <div key={idx} className="flex flex-wrap gap-2">
                      <select
                        className="min-w-[8rem] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        value={row.pond_id}
                        onChange={(e) => {
                          const next = [...form.manual_shares]
                          next[idx] = { ...next[idx], pond_id: e.target.value }
                          setForm((f) => ({ ...f, manual_shares: next }))
                        }}
                      >
                        <option value="">Pond</option>
                        {ponds.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Amount"
                        className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
                        value={row.amount}
                        onChange={(e) => {
                          const next = [...form.manual_shares]
                          next[idx] = { ...next[idx], amount: e.target.value }
                          setForm((f) => ({ ...f, manual_shares: next }))
                        }}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-sm text-teal-800 underline"
                    onClick={() =>
                      setForm((f) => ({ ...f, manual_shares: [...f.manual_shares, { pond_id: '', amount: '' }] }))
                    }
                  >
                    Add row
                  </button>
                </div>
              )}

              <label className="block text-sm font-medium text-slate-700">
                Category
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.expense_category}
                  onChange={(e) => {
                    const v = e.target.value
                    setForm((f) => ({
                      ...f,
                      expense_category: v,
                      ...(v !== 'feed_purchase' ? { feed_sack_count: '', feed_weight_kg: '' } : {}),
                    }))
                  }}
                >
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              {(() => {
                const hint = cats.find((c) => c.id === form.expense_category)?.hint
                if (!hint) return null
                return (
                  <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                    {hint}
                  </p>
                )
              })()}
              <label className="block text-sm font-medium text-slate-700">
                Date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.expense_date}
                  onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Amount ({sym})
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </label>
              {form.expense_category === 'feed_purchase' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Feed sacks (optional)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
                      value={form.feed_sack_count}
                      onChange={(e) => setForm((f) => ({ ...f, feed_sack_count: e.target.value }))}
                      placeholder="Number of sacks"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Feed total kg (optional)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
                      value={form.feed_weight_kg}
                      onChange={(e) => setForm((f) => ({ ...f, feed_weight_kg: e.target.value }))}
                      placeholder="Equivalent kg"
                    />
                  </label>
                </div>
              ) : null}
              <label className="block text-sm font-medium text-slate-700">
                Vendor (optional)
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  list="aquaculture-vendor-suggestions"
                  autoComplete="off"
                  placeholder={vendors.length ? 'Pick from list or type a name' : 'Type vendor name'}
                  value={form.vendor_name}
                  onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Memo
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  rows={2}
                  value={form.memo}
                  onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(false)}
                className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
