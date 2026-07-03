'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Briefcase,
  Calendar,
  ChevronRight,
  Fish,
  Landmark,
  LayoutGrid,
  Package,
  Store,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { PondGoLiveFishTab } from './PondGoLiveFishTab'
import { PondGoLiveInventoryTab } from './PondGoLiveInventoryTab'
import { PondGoLiveOverview } from './PondGoLiveOverview'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { MODAL_BACKDROP, MODAL_FORM_PANEL } from '@/lib/modalLayout'
import { formatDateOnly } from '@/utils/date'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'
import {
  formatSigned,
  linesOfKind,
  parseMoney,
  partyEditHref,
  plRowsForPond,
  pondLines,
  signedTone,
  type CategoryCatalog,
  type OpeningBalancesResponse,
  type OpeningPartyLine,
  type PlCategoryRow,
  type PlKind,
  type PondOpeningSummary,
} from './pondOpeningShared'

/** @deprecated Use PondOpeningSummary from API; kept for ponds page list compatibility */
export interface PondOpeningSource {
  id: number
  name: string
  code: string
  is_active: boolean
  lease_paid_to_landlord: string
  lease_balance_due?: string | null
  pos_customer_id?: number | null
  pos_customer_display?: string | null
  pos_customer_opening_balance?: string | null
  pos_customer_opening_balance_date?: string | null
  tilapia_net_fish_count?: number | null
  tilapia_net_weight_kg?: string | null
  landlord_pond_shares?: {
    landlord_id: number
    landlord_name: string
    opening_balance?: string
    opening_balance_date?: string | null
    opening_balance_locked?: boolean
  }[]
}

type TabId =
  | 'overview'
  | PlKind
  | 'customer'
  | 'vendor'
  | 'employee'
  | 'loan'
  | 'landlords'
  | 'fish'
  | 'inventory'
  | 'lease_paid'

type LeaseDraft = { leasePaid: string }
type PartyDraft = { opening: string; asOf: string; postToGl?: boolean }
type PlDraft = { amount: string; asOf: string; memo: string }

type Props = {
  open: boolean
  currency: string
  onClose: () => void
  onSaved: () => void
}

function fmtMoney(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return formatNumber(n, digits)
}

const TAB_META: { id: TabId; label: string; icon: typeof Wallet }[] = [
  { id: 'overview', label: 'Go-live checklist', icon: LayoutGrid },
  { id: 'income', label: 'Income', icon: TrendingUp },
  { id: 'expense', label: 'Expense', icon: TrendingDown },
  { id: 'customer', label: 'Customers (A/R)', icon: Store },
  { id: 'fish', label: 'Fish biomass', icon: Fish },
  { id: 'inventory', label: 'Feed & medicine', icon: Package },
  { id: 'vendor', label: 'Vendors (A/P)', icon: Truck },
  { id: 'employee', label: 'Employees (A/P)', icon: Users },
  { id: 'loan', label: 'Loans', icon: Briefcase },
  { id: 'lease_paid', label: 'Lease prepaid', icon: Wallet },
  { id: 'landlords', label: 'Landlords', icon: Landmark },
]

export function PondOpeningBalancesModal({ open, currency, onClose, onSaved }: Props) {
  const toast = useToast()
  const sym = useMemo(() => getCurrencySymbol(currency), [currency])
  const [tab, setTab] = useState<TabId>('overview')
  const [loading, setLoading] = useState(false)
  const [summaries, setSummaries] = useState<PondOpeningSummary[]>([])
  const [catalog, setCatalog] = useState<CategoryCatalog | null>(null)
  const [conventions, setConventions] = useState<Record<string, string>>({})
  const [leaseDrafts, setLeaseDrafts] = useState<Record<number, LeaseDraft>>({})
  const [customerDrafts, setCustomerDrafts] = useState<Record<number, PartyDraft>>({})
  const [vendorDrafts, setVendorDrafts] = useState<Record<string, PartyDraft>>({})
  const [employeeDrafts, setEmployeeDrafts] = useState<Record<string, PartyDraft>>({})
  const [plDrafts, setPlDrafts] = useState<Record<string, PlDraft>>({})
  const [plPostGlDrafts, setPlPostGlDrafts] = useState<Record<number, boolean>>({})
  const plPostGlDraftsRef = useRef<Record<number, boolean>>({})
  const [plZeroConfirmDrafts, setPlZeroConfirmDrafts] = useState<Record<number, boolean>>({})
  const plZeroConfirmDraftsRef = useRef<Record<number, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [cutoverDate, setCutoverDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [goLiveSummary, setGoLiveSummary] = useState<OpeningBalancesResponse['go_live'] | null>(null)
  const [focusPondId, setFocusPondId] = useState<number | null>(null)

  const draftKey = (pondId: number, partyId: number) => `${pondId}:${partyId}`
  const plDraftKey = (pondId: number, kind: PlKind, code: string) => `${pondId}:${kind}:${code}`

  const setPlZeroConfirmForPond = useCallback((pondId: number, confirmed: boolean) => {
    setPlZeroConfirmDrafts((prev) => {
      const next = { ...prev, [pondId]: confirmed }
      plZeroConfirmDraftsRef.current = next
      return next
    })
  }, [])

  const setPlPostGlForPond = useCallback((pondId: number, postToGl: boolean) => {
    setPlPostGlDrafts((prev) => {
      const next = { ...prev, [pondId]: postToGl }
      plPostGlDraftsRef.current = next
      return next
    })
  }, [])

  const initDrafts = useCallback((ponds: PondOpeningSummary[], cat: CategoryCatalog | null, asOfDefault: string) => {
    const lease: Record<number, LeaseDraft> = {}
    const cust: Record<number, PartyDraft> = {}
    const vend: Record<string, PartyDraft> = {}
    const emp: Record<string, PartyDraft> = {}
    const pl: Record<string, PlDraft> = {}
    const plPostGl: Record<number, boolean> = {}
    const plZeroConfirm: Record<number, boolean> = {}
    const today = asOfDefault || new Date().toISOString().slice(0, 10)
    for (const p of ponds) {
      lease[p.pond_id] = { leasePaid: p.lease_paid_to_landlord ?? '0' }
      if (p.pos_customer_id) {
        const custLine = linesOfKind(p, 'customer')[0]
        cust[p.pond_id] = {
          opening: custLine?.opening_balance ?? '0',
          asOf: custLine?.opening_balance_date?.slice(0, 10) || today,
          postToGl: !custLine?.opening_balance_journal_id,
        }
      }
      for (const ln of pondLines(p)) {
        const asOf = ln.opening_balance_date?.slice(0, 10) || today
        if (ln.kind === 'customer') {
          if (!cust[p.pond_id]) {
            cust[p.pond_id] = { opening: ln.opening_balance, asOf }
          }
        }
        if (ln.kind === 'vendor') {
          vend[draftKey(p.pond_id, ln.party_id)] = {
            opening: ln.opening_balance,
            asOf,
            postToGl: !ln.opening_balance_journal_id,
          }
        }
        if (ln.kind === 'employee') {
          emp[draftKey(p.pond_id, ln.party_id)] = {
            opening: ln.opening_balance,
            asOf,
            postToGl: !ln.opening_balance_journal_id,
          }
        }
      }
      for (const kind of ['income', 'expense'] as const) {
        for (const row of plRowsForPond(p, kind, cat)) {
          pl[plDraftKey(p.pond_id, kind, row.category_code)] = {
            amount: row.amount,
            asOf: row.as_of_date?.slice(0, 10) || today,
            memo: row.memo ?? '',
          }
        }
      }
      plPostGl[p.pond_id] = Boolean(p.pl_openings?.pl_opening_gl_locked)
      plZeroConfirm[p.pond_id] = Boolean(p.prior_pl_zero_confirmed_at)
    }
    setLeaseDrafts(lease)
    setCustomerDrafts(cust)
    setVendorDrafts(vend)
    setEmployeeDrafts(emp)
    setPlDrafts(pl)
    setPlPostGlDrafts(plPostGl)
    plPostGlDraftsRef.current = plPostGl
    setPlZeroConfirmDrafts(plZeroConfirm)
    plZeroConfirmDraftsRef.current = plZeroConfirm
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<OpeningBalancesResponse>('/aquaculture/ponds/opening-balances/')
      const ponds = Array.isArray(data?.ponds) ? data.ponds : []
      setSummaries(ponds)
      const cat = data?.catalog ?? null
      setCatalog(cat)
      setConventions(data?.conventions ?? {})
      const cut = data?.cutover_date?.slice(0, 10) || new Date().toISOString().slice(0, 10)
      setCutoverDate(cut)
      setGoLiveSummary(data?.go_live ?? null)
      initDrafts(ponds, cat, cut)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load opening balances'))
      setSummaries([])
    } finally {
      setLoading(false)
    }
  }, [initDrafts, toast])

  useEffect(() => {
    if (!open) return
    setTab('overview')
    setFocusPondId(null)
    void load()
  }, [open, load])

  const applyCutoverToDrafts = useCallback(() => {
    setCustomerDrafts((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[Number(k)] = { ...next[Number(k)], asOf: cutoverDate }
      }
      return next
    })
    setVendorDrafts((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], asOf: cutoverDate }
      }
      return next
    })
    setEmployeeDrafts((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], asOf: cutoverDate }
      }
      return next
    })
    setPlDrafts((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], asOf: cutoverDate }
      }
      return next
    })
    toast.success('Applied cutover date to all draft as-of fields')
  }, [cutoverDate, toast])

  const goToTab = useCallback((nextTab: string, pondId?: number) => {
    setTab(nextTab as TabId)
    if (pondId) setFocusPondId(pondId)
  }, [])

  const sorted = useMemo(
    () =>
      [...summaries].sort((a, b) =>
        (a.pond_code || a.pond_name).localeCompare(b.pond_code || b.pond_name, undefined, {
          sensitivity: 'base',
        }),
      ),
    [summaries],
  )

  const visiblePonds = useMemo(() => {
    if (focusPondId == null) return sorted
    return sorted.filter((p) => p.pond_id === focusPondId)
  }, [sorted, focusPondId])

  const buildUpdates = useCallback(() => {
    const updates: Record<string, unknown>[] = []
    for (const p of sorted) {
      const patch: Record<string, unknown> = { pond_id: p.pond_id }
      let dirty = false

      const ld = leaseDrafts[p.pond_id]
      if (ld && parseMoney(ld.leasePaid) !== parseMoney(p.lease_paid_to_landlord)) {
        patch.lease_paid_to_landlord = parseMoney(ld.leasePaid)
        dirty = true
      }

      const cd = customerDrafts[p.pond_id]
      if (cd && p.pos_customer_id) {
        const custLine = linesOfKind(p, 'customer')[0]
        const ob = parseMoney(cd.opening)
        const origOb = custLine ? parseMoney(custLine.opening_balance) : 0
        const origDate = (custLine?.opening_balance_date || '').slice(0, 10)
        const origPost = !custLine?.opening_balance_journal_id
        if (ob !== origOb || cd.asOf !== origDate || (cd.postToGl !== false) !== origPost) {
          patch.customer = {
            opening_balance: ob,
            opening_balance_date: ob !== 0 ? cd.asOf : null,
            post_opening_to_gl: cd.postToGl !== false,
          }
          dirty = true
        }
      }

      const vendors: Record<string, unknown>[] = []
      for (const ln of linesOfKind(p, 'vendor')) {
        const d = vendorDrafts[draftKey(p.pond_id, ln.party_id)]
        if (!d) continue
        const ob = parseMoney(d.opening)
        if (
          ob !== parseMoney(ln.opening_balance) ||
          d.asOf !== (ln.opening_balance_date || '').slice(0, 10) ||
          (d.postToGl !== false) !== !ln.opening_balance_journal_id
        ) {
          vendors.push({
            id: ln.party_id,
            opening_balance: ob,
            opening_balance_date: ob !== 0 ? d.asOf : null,
            post_opening_to_gl: d.postToGl !== false,
          })
        }
      }
      if (vendors.length) {
        patch.vendors = vendors
        dirty = true
      }

      const employees: Record<string, unknown>[] = []
      for (const ln of linesOfKind(p, 'employee')) {
        const d = employeeDrafts[draftKey(p.pond_id, ln.party_id)]
        if (!d) continue
        const ob = parseMoney(d.opening)
        if (ob !== parseMoney(ln.opening_balance) || d.asOf !== (ln.opening_balance_date || '').slice(0, 10)) {
          employees.push({
            id: ln.party_id,
            opening_balance: ob,
            opening_balance_date: ob !== 0 ? d.asOf : null,
            post_opening_to_gl: d.postToGl !== false,
          })
        }
      }
      if (employees.length) {
        patch.employees = employees
        dirty = true
      }

      for (const kind of ['income', 'expense'] as const) {
        const plChanged: Record<string, unknown>[] = []
        for (const row of plRowsForPond(p, kind, catalog)) {
          const d = plDrafts[plDraftKey(p.pond_id, kind, row.category_code)]
          if (!d) continue
          const amt = parseMoney(d.amount)
          const origAmt = parseMoney(row.amount)
          const origDate = (row.as_of_date || '').slice(0, 10)
          const origMemo = (row.memo || '').trim()
          const amountChanged = amt !== origAmt
          const memoChanged = d.memo.trim() !== origMemo
          const dateChanged = d.asOf !== origDate
          if (amountChanged || memoChanged || (amt !== 0 && dateChanged)) {
            plChanged.push({
              category_code: row.category_code,
              amount: amt,
              as_of_date: amt !== 0 ? d.asOf : null,
              memo: d.memo.trim(),
            })
          }
        }
        if (plChanged.length) {
          patch[kind === 'income' ? 'pl_income' : 'pl_expense'] = plChanged
          dirty = true
        }
      }
      const glAlreadyPosted = Boolean(p.pl_openings?.pl_opening_gl_locked)
      const wantsPostGl = plPostGlDraftsRef.current[p.pond_id] ?? glAlreadyPosted
      if (wantsPostGl && !glAlreadyPosted) {
        patch.post_pl_opening_to_gl = true
        dirty = true
      }

      const origZeroConfirm = Boolean(p.prior_pl_zero_confirmed_at)
      const draftZeroConfirm = plZeroConfirmDraftsRef.current[p.pond_id] ?? origZeroConfirm
      if (draftZeroConfirm !== origZeroConfirm) {
        patch.confirm_prior_pl_zero = draftZeroConfirm
        dirty = true
      }

      if (dirty) updates.push(patch)
    }
    return updates
  }, [sorted, leaseDrafts, customerDrafts, vendorDrafts, employeeDrafts, plDrafts, catalog])

  const pendingCount = buildUpdates().length

  const save = async () => {
    const updates = buildUpdates()
    setSaving(true)
    try {
      const { data } = await api.put<OpeningBalancesResponse>(
        '/aquaculture/ponds/opening-balances/',
        { cutover_date: cutoverDate, updates },
      )
      const errs = Array.isArray(data?.errors) ? data.errors : []
      const savedCount = typeof data?.saved === 'number' ? data.saved : 0
      if (errs.length) {
        toast.error(errs[0]?.detail || 'Some rows could not be saved')
      } else if (updates.length > 0 && savedCount === 0) {
        toast.error('No changes were saved. Check cutover date and try again.')
      } else if (updates.length) {
        toast.success(`Saved go-live data (${savedCount || updates.length} pond update(s))`)
      } else {
        toast.success('Cutover date saved')
      }
      if (Array.isArray(data?.ponds)) {
        setSummaries(data.ponds)
        const catAfterSave = data.catalog ?? catalog
        if (data.catalog) setCatalog(data.catalog)
        const cut = data.cutover_date?.slice(0, 10) || cutoverDate
        setCutoverDate(cut)
        setGoLiveSummary(data.go_live ?? null)
        initDrafts(data.ponds, catAfterSave, cut)
      } else {
        await load()
      }
      onSaved()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className={MODAL_BACKDROP}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pond-opening-balances-title"
    >
      <div className={MODAL_FORM_PANEL}>
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-gradient-to-r from-teal-50 via-white to-slate-50 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="pond-opening-balances-title" className="text-xl font-bold tracking-tight text-foreground">
              Pond go-live setup
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Enter each pond&apos;s state as of cutover: prior P&amp;L, A/R and A/P, fish biomass, feed on hand, and
              lease. Landlord rent ledger is on Aquaculture → Landlords.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-foreground/85">
                <Calendar className="h-4 w-4 text-primary" aria-hidden />
                <span className="font-medium">Cutover date</span>
                <input
                  type="date"
                  className="rounded-lg border border-border px-2.5 py-1.5 text-sm"
                  value={cutoverDate}
                  onChange={(e) => setCutoverDate(e.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={applyCutoverToDrafts}
                className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground/85 hover:bg-muted/40"
              >
                Apply date to all as-of fields
              </button>
              {focusPondId != null ? (
                <button
                  type="button"
                  onClick={() => setFocusPondId(null)}
                  className="rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/85"
                >
                  Show all ponds
                </button>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 overflow-x-auto border-b border-border/70 bg-muted/50 px-3 py-2 sm:px-5">
          <div className="flex min-w-max gap-1.5" role="tablist">
            {TAB_META.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium sm:text-sm ${
                  tab === id
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-white text-foreground/85 ring-1 ring-border hover:bg-muted/40'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-primary" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No ponds to show. Create ponds first.</p>
          ) : (
            <>
              {tab === 'overview' ? (
                <PondGoLiveOverview
                  ponds={sorted}
                  sym={sym}
                  cutoverDate={cutoverDate}
                  readyPonds={goLiveSummary?.ready_ponds ?? 0}
                  totalPonds={goLiveSummary?.total_ponds ?? sorted.length}
                  onGoToTab={goToTab}
                />
              ) : null}

              {tab === 'income' || tab === 'expense' ? (
                <PlOpeningTab
                  ponds={visiblePonds}
                  kind={tab}
                  sym={sym}
                  catalog={catalog}
                  conventions={conventions}
                  drafts={plDrafts}
                  setDrafts={setPlDrafts}
                  plPostGlDrafts={plPostGlDrafts}
                  setPlPostGlForPond={setPlPostGlForPond}
                  plZeroConfirmDrafts={plZeroConfirmDrafts}
                  setPlZeroConfirmForPond={setPlZeroConfirmForPond}
                  plDraftKey={plDraftKey}
                  focusPondId={focusPondId}
                  cutoverDate={cutoverDate}
                />
              ) : tab === 'fish' ? (
                <PondGoLiveFishTab
                  ponds={visiblePonds}
                  cutoverDate={cutoverDate}
                  currency={currency}
                  onSaved={() => void load()}
                />
              ) : tab === 'inventory' ? (
                <PondGoLiveInventoryTab ponds={visiblePonds} sym={sym} />
              ) : tab === 'lease_paid' ? (
                <LeasePaidTab
                  ponds={visiblePonds}
                  sym={sym}
                  leaseDrafts={leaseDrafts}
                  setLeaseDrafts={setLeaseDrafts}
                />
              ) : tab === 'landlords' ? (
                <LandlordsTab ponds={visiblePonds} />
              ) : tab === 'loan' ? (
                <ReadOnlyPartyTab ponds={visiblePonds} sym={sym} />
              ) : tab === 'customer' ? (
                <CustomerOpeningTab
                  ponds={visiblePonds}
                  sym={sym}
                  drafts={customerDrafts}
                  setDrafts={setCustomerDrafts}
                />
              ) : tab === 'vendor' ? (
                <EditablePartyTab
                  ponds={visiblePonds}
                  kind="vendor"
                  sym={sym}
                  drafts={vendorDrafts}
                  setDrafts={setVendorDrafts}
                  draftKeyFn={(pondId, partyId) => draftKey(pondId, partyId)}
                />
              ) : tab === 'employee' ? (
                <EditablePartyTab
                  ponds={visiblePonds}
                  kind="employee"
                  sym={sym}
                  drafts={employeeDrafts}
                  setDrafts={setEmployeeDrafts}
                  draftKeyFn={(pondId, partyId) => draftKey(pondId, partyId)}
                />
              ) : null}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/50 px-4 py-3 sm:px-6">
          <p className="text-xs text-muted-foreground">
            {pendingCount > 0 ? (
              <>
                <span className="font-medium text-foreground">{pendingCount} pond(s)</span> with unsaved monetary
                edits. Fish and feed use their tabs; landlords on Landlords screen.
              </>
            ) : (
              'Save stores cutover date. Use checklist tabs to complete each pond, then save monetary changes.'
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40"
            >
              {pendingCount ? 'Cancel' : 'Close'}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : pendingCount > 0 ? 'Save changes' : 'Save cutover date'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LeasePaidTab({
  ponds,
  sym,
  leaseDrafts,
  setLeaseDrafts,
}: {
  ponds: PondOpeningSummary[]
  sym: string
  leaseDrafts: Record<number, LeaseDraft>
  setLeaseDrafts: React.Dispatch<React.SetStateAction<Record<number, LeaseDraft>>>
}) {
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Cumulative rent paid on the pond lease contract <strong>before</strong> go-live (reduces contract balance due).
        Distinct from landlord sub-ledger opening on the Landlords tab.
      </p>
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="border-b border-border text-xs font-semibold uppercase text-muted-foreground">
          <tr>
            <th className="py-2">Pond</th>
            <th className="py-2">Prepaid / paid ({sym})</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {ponds.map((p) => (
            <tr key={p.pond_id}>
              <td className="py-2 font-medium">{p.pond_name}</td>
              <td className="py-2">
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full max-w-[10rem] rounded-lg border border-border px-2.5 py-1.5 tabular-nums"
                  value={leaseDrafts[p.pond_id]?.leasePaid ?? ''}
                  onChange={(e) =>
                    setLeaseDrafts((prev) => ({ ...prev, [p.pond_id]: { leasePaid: e.target.value } }))
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function EditablePartyTab({
  ponds,
  kind,
  sym,
  drafts,
  setDrafts,
  draftKeyFn,
}: {
  ponds: PondOpeningSummary[]
  kind: 'customer' | 'vendor' | 'employee'
  sym: string
  drafts: Record<string, PartyDraft>
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, PartyDraft>>>
  draftKeyFn: (pondId: number, partyId: number) => string
}) {
  const rows: { pond: PondOpeningSummary; line: OpeningPartyLine }[] = []
  for (const p of ponds) {
    for (const ln of linesOfKind(p, kind)) {
      rows.push({ pond: p, line: ln })
    }
  }
  const linkLabel = kind === 'customer' ? 'Ledger' : 'Open module'

  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        {kind === 'customer'
          ? 'Positive = they owe you (A/R). Linked via pond POS customer.'
          : kind === 'vendor'
            ? 'Positive = you owe vendor (A/P). Vendors with this pond as default delivery pond.'
            : 'Positive = you owe employee (payroll A/P). Employees with home pond set here.'}
      </p>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No {kind} openings linked to any pond yet.</p>
      ) : (
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-border text-xs font-semibold uppercase text-muted-foreground">
            <tr>
              <th className="py-2">Pond</th>
              <th className="py-2">Party</th>
              <th className="py-2">Opening ({sym})</th>
              <th className="py-2">As of</th>
              {kind === 'vendor' || kind === 'employee' ? <th className="py-2">Post G/L</th> : null}
              <th className="py-2 text-right">Signed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {rows.map(({ pond, line }) => {
              const key = draftKeyFn(pond.pond_id, line.party_id)
              const d = drafts[key]
              const signed = parseMoney(line.signed_contribution)
              return (
                <tr key={`${pond.pond_id}-${line.party_id}`}>
                  <td className="py-2 font-medium">{pond.pond_name}</td>
                  <td className="py-2">
                    <span className="font-medium text-foreground">{line.name}</span>
                    <Link
                      href={partyEditHref(kind, line.party_id)}
                      className="ml-2 inline-flex items-center gap-0.5 text-xs text-primary underline"
                    >
                      <BookOpen className="h-3 w-3" aria-hidden />
                      {linkLabel}
                    </Link>
                  </td>
                  <td className="py-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full max-w-[9rem] rounded-lg border border-border px-2.5 py-1.5 tabular-nums"
                      value={d?.opening ?? ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [key]: { ...prev[key], opening: e.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="date"
                      className="rounded-lg border border-border px-2 py-1.5 text-sm"
                      value={d?.asOf ?? ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [key]: { ...prev[key], asOf: e.target.value },
                        }))
                      }
                    />
                  </td>
                  {kind === 'vendor' || kind === 'employee' ? (
                    <td className="py-2">
                      <label className="inline-flex items-center gap-1.5 text-xs text-foreground/85">
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={d?.postToGl !== false}
                          disabled={Boolean(line.opening_balance_journal_id)}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], postToGl: e.target.checked },
                            }))
                          }
                        />
                        {kind === 'vendor' ? 'Dr/Cr AP + equity' : 'Dr/Cr payroll + equity'}
                      </label>
                      {line.opening_balance_journal_number ? (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{line.opening_balance_journal_number}</p>
                      ) : null}
                    </td>
                  ) : null}
                  <td className={`py-2 text-right tabular-nums text-xs ${signedTone(signed)}`}>
                    {formatSigned(signed, sym)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

function ReadOnlyPartyTab({
  ponds,
  sym,
}: {
  ponds: PondOpeningSummary[]
  sym: string
}) {
  const rows: { pond: PondOpeningSummary; line: OpeningPartyLine }[] = []
  for (const p of ponds) {
    for (const ln of linesOfKind(p, 'loan')) {
      rows.push({ pond: p, line: ln })
    }
  }

  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Loan counterparty openings linked to this pond — edit on Loans (posts to principal + opening equity).
      </p>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No loan lines for these ponds.</p>
      ) : (
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead className="border-b border-border text-xs font-semibold uppercase text-muted-foreground">
            <tr>
              <th className="py-2">Pond</th>
              <th className="py-2">Party</th>
              <th className="py-2 text-right">Opening</th>
              <th className="py-2 text-right">Signed (pond)</th>
              <th className="py-2 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {rows.map(({ pond, line }) => {
              const signed = parseMoney(line.signed_contribution)
              return (
                <tr key={`${pond.pond_id}-${line.party_id}-${line.kind}`}>
                  <td className="py-2 font-medium">{pond.pond_name}</td>
                  <td className="py-2">
                    <span className="font-medium">{line.name}</span>
                    {line.code ? <span className="ml-1 text-xs text-muted-foreground">{line.code}</span> : null}
                    {line.label ? <p className="text-[11px] text-muted-foreground">{line.label}</p> : null}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {fmtMoney(parseMoney(line.opening_balance))}
                    {line.opening_balance_date ? (
                      <span className="block text-[11px] text-muted-foreground">
                        {formatDateOnly(line.opening_balance_date)}
                      </span>
                    ) : null}
                  </td>
                  <td className={`py-2 text-right tabular-nums font-medium ${signedTone(signed)}`}>
                    {formatSigned(signed, sym)}
                  </td>
                  <td className="py-2 text-right">
                    <Link
                      href={partyEditHref('loan', line.party_id)}
                      className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:text-teal-950"
                    >
                      {line.locked ? 'View' : 'Set opening'}
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

function LandlordsTab({ ponds }: { ponds: PondOpeningSummary[] }) {
  const note = ponds[0]?.landlord_note
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        {note ||
          'Landlord / lease rent opening balances are managed on Aquaculture → Landlords, not on this screen.'}
      </p>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs font-semibold uppercase text-muted-foreground">
          <tr>
            <th className="py-2">Pond</th>
            <th className="py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {ponds.map((p) => (
            <tr key={p.pond_id}>
              <td className="py-2 font-medium">{p.pond_name}</td>
              <td className="py-2 text-right">
                <Link
                  href="/aquaculture/landlords"
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-primary underline"
                >
                  <Landmark className="h-3.5 w-3.5" aria-hidden />
                  Open landlords
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function CustomerOpeningTab({
  ponds,
  sym,
  drafts,
  setDrafts,
}: {
  ponds: PondOpeningSummary[]
  sym: string
  drafts: Record<number, PartyDraft>
  setDrafts: React.Dispatch<React.SetStateAction<Record<number, PartyDraft>>>
}) {
  return (
    <>
      <p className="mb-4 text-sm text-foreground/85">
        <strong className="text-foreground">On-account A/R opening</strong> — unpaid feed and supplies sold to the
        pond&apos;s POS customer before go-live. This is separate from income-type P&amp;L openings on the Income tab.
      </p>
      <div className="space-y-4">
        {ponds.map((p) => {
          const d = drafts[p.pond_id]
          const hasCustomer = Boolean(p.pos_customer_id)
          return (
            <div
              key={p.pond_id}
              className="rounded-xl border border-border bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 pb-3">
                <div>
                  <h3 className="font-semibold text-foreground">{p.pond_name}</h3>
                  {p.pond_code ? <p className="text-xs text-muted-foreground">Code {p.pond_code}</p> : null}
                </div>
                {!hasCustomer ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
                    No POS customer
                  </span>
                ) : null}
              </div>
              {!hasCustomer ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Link or create an &quot;Aquaculture — …&quot; customer on the pond profile, or use{' '}
                  <strong>Create missing POS customers</strong> on the ponds list.
                </p>
              ) : (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium text-muted-foreground">POS customer</p>
                    <p className="text-sm font-medium text-primary">
                      {p.pos_customer_display?.trim() || `Customer #${p.pos_customer_id}`}
                    </p>
                    {p.pos_customer_id ? (
                      <Link
                        href={`/customers/${p.pos_customer_id}/ledger`}
                        className="mt-1 inline-flex items-center gap-0.5 text-xs text-primary underline"
                      >
                        <BookOpen className="h-3 w-3" aria-hidden />
                        View A/R ledger
                      </Link>
                    ) : null}
                  </div>
                  <label className="block text-sm">
                    <span className="font-medium text-foreground">Opening balance ({sym})</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      Positive = they owe you for past on-account sales
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 tabular-nums focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                      placeholder="0.00"
                      value={d?.opening ?? ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [p.pond_id]: { ...prev[p.pond_id], opening: e.target.value, asOf: prev[p.pond_id]?.asOf ?? '' },
                        }))
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-foreground">As-of date</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      Required when balance is not zero
                    </span>
                    <input
                      type="date"
                      className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                      value={d?.asOf ?? ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [p.pond_id]: { ...prev[p.pond_id], asOf: e.target.value, opening: prev[p.pond_id]?.opening ?? '' },
                        }))
                      }
                    />
                  </label>
                  <label className="flex items-start gap-2 text-sm sm:col-span-2">
                    <input
                      type="checkbox"
                      className="mt-1 rounded border-border"
                      checked={d?.postToGl !== false}
                      disabled={Boolean(linesOfKind(p, 'customer')[0]?.opening_balance_journal_id)}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [p.pond_id]: { ...prev[p.pond_id], postToGl: e.target.checked },
                        }))
                      }
                    />
                    <span>
                      <span className="font-medium text-foreground">Post to general ledger</span>
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        Dr 1100 A/R, Cr 3200 Opening Balance Equity when balance is non-zero
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function PlOpeningTab({
  ponds,
  kind,
  sym,
  catalog,
  conventions,
  drafts,
  setDrafts,
  plPostGlDrafts,
  setPlPostGlForPond,
  plZeroConfirmDrafts,
  setPlZeroConfirmForPond,
  plDraftKey,
  focusPondId,
  cutoverDate,
}: {
  ponds: PondOpeningSummary[]
  kind: PlKind
  sym: string
  catalog: CategoryCatalog | null
  conventions: Record<string, string>
  drafts: Record<string, PlDraft>
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, PlDraft>>>
  plPostGlDrafts: Record<number, boolean>
  setPlPostGlForPond: (pondId: number, postToGl: boolean) => void
  plZeroConfirmDrafts: Record<number, boolean>
  setPlZeroConfirmForPond: (pondId: number, confirmed: boolean) => void
  plDraftKey: (pondId: number, kind: PlKind, code: string) => string
  focusPondId: number | null
  cutoverDate: string
}) {
  const [pondFilter, setPondFilter] = useState<string>(
    focusPondId != null ? String(focusPondId) : 'all',
  )
  const [showAllCategories, setShowAllCategories] = useState(true)

  useEffect(() => {
    if (focusPondId != null) setPondFilter(String(focusPondId))
  }, [focusPondId])

  const convention =
    kind === 'income' ? conventions.pl_income : conventions.pl_expense
  const kindLabel = kind === 'income' ? 'Income type' : 'Expense category'

  const visiblePonds =
    pondFilter === 'all' ? ponds : ponds.filter((p) => String(p.pond_id) === pondFilter)

  return (
    <>
      <p className="mb-3 text-sm text-foreground/85">
        {convention ||
          (kind === 'income'
            ? 'Enter prior revenue for each income type, per pond.'
            : 'Enter prior costs for each expense category, per pond.')}{' '}
        As-of date defaults to cutover <strong>{cutoverDate}</strong>.
      </p>
      {kind === 'expense' && catalog?.expense_excluded?.length ? (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
          <strong>Lease / landlord rent</strong> is not entered here — use{' '}
          <Link href="/aquaculture/landlords" className="font-semibold underline">
            Aquaculture → Landlords
          </Link>
          .
        </div>
      ) : null}

      <div className="mb-4 space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">General ledger (optional)</p>
        {ponds.map((p) => (
          <label key={`pl-gl-${p.pond_id}`} className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-border"
              checked={Boolean(plPostGlDrafts[p.pond_id])}
              disabled={Boolean(p.pl_openings?.pl_opening_gl_locked)}
              onChange={(e) => setPlPostGlForPond(p.pond_id, e.target.checked)}
            />
            <span>
              Post prior P&amp;L to G/L for <strong>{p.pond_name}</strong>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Per category: Dr/Cr income or expense accounts with 3200 Opening Balance Equity
              </span>
              {p.pl_openings?.pl_opening_journal_number ? (
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {p.pl_openings.pl_opening_journal_number}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-foreground/85">
          <span className="font-medium">Pond</span>
          <select
            className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm"
            value={pondFilter}
            onChange={(e) => setPondFilter(e.target.value)}
          >
            <option value="all">All ponds</option>
            {ponds.map((p) => (
              <option key={p.pond_id} value={String(p.pond_id)}>
                {p.pond_name}
                {p.pond_code ? ` (${p.pond_code})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={showAllCategories}
            onChange={(e) => setShowAllCategories(e.target.checked)}
          />
          Show all categories (including zero)
        </label>
      </div>

      <div className="space-y-6">
        {visiblePonds.map((pond) => {
          const categories = plRowsForPond(pond, kind, catalog)
          const toShow = showAllCategories
            ? categories
            : categories.filter((row) => {
                const key = plDraftKey(pond.pond_id, kind, row.category_code)
                const d = drafts[key]
                return parseMoney(d?.amount ?? row.amount) !== 0
              })
          if (toShow.length === 0 && !showAllCategories) {
            return (
              <div key={pond.pond_id} className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground/85">{pond.pond_name}</p>
                <p className="mt-1 text-xs">No amounts entered yet. Turn on &quot;Show all categories&quot; to add lines.</p>
              </div>
            )
          }
          return (
            <section key={pond.pond_id} className="rounded-xl border border-border bg-muted/40 p-4">
              <h3 className="mb-3 text-base font-semibold text-foreground">
                {pond.pond_name}
                {pond.pond_code ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">{pond.pond_code}</span>
                ) : null}
              </h3>
              {kind === 'income' ? (
                <label className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-border"
                    checked={Boolean(plZeroConfirmDrafts[pond.pond_id])}
                    disabled={Boolean(pond.pl_openings?.pl_opening_gl_locked)}
                    onChange={(e) => setPlZeroConfirmForPond(pond.pond_id, e.target.checked)}
                  />
                  <span>
                    <strong>No prior P&amp;L before cutover</strong> — confirm all income and expense categories are
                    zero (new crop or no history to import). Saves with the button below; requires cutover date{' '}
                    <strong>{cutoverDate}</strong>.
                    {pond.prior_pl_zero_confirmed_at ? (
                      <span className="mt-1 block text-xs font-normal text-emerald-900">
                        Confirmed on {pond.prior_pl_zero_confirmed_at.slice(0, 10)}.
                      </span>
                    ) : null}
                  </span>
                </label>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {toShow.map((row) => {
                  const key = plDraftKey(pond.pond_id, kind, row.category_code)
                  const d = drafts[key]
                  const amt = parseMoney(d?.amount ?? row.amount)
                  const signed = kind === 'income' ? amt : amt > 0 ? -amt : 0
                  return (
                    <div
                      key={key}
                      className="rounded-lg border border-border bg-white p-3 shadow-sm"
                    >
                      <p className="text-sm font-semibold text-foreground">{row.category_label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {kindLabel}: {row.category_code}
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs sm:col-span-1">
                          <span className="font-medium text-foreground/85">Prior amount ({sym})</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="mt-1 w-full rounded-md border border-border px-2.5 py-2 text-sm tabular-nums"
                            placeholder="0"
                            value={d?.amount ?? ''}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [key]: {
                                  amount: e.target.value,
                                  asOf: prev[key]?.asOf ?? new Date().toISOString().slice(0, 10),
                                  memo: prev[key]?.memo ?? '',
                                },
                              }))
                            }
                          />
                        </label>
                        <label className="block text-xs sm:col-span-1">
                          <span className="font-medium text-foreground/85">As-of date</span>
                          <input
                            type="date"
                            className="mt-1 w-full rounded-md border border-border px-2.5 py-2 text-sm"
                            value={d?.asOf ?? ''}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [key]: {
                                  amount: prev[key]?.amount ?? '',
                                  asOf: e.target.value,
                                  memo: prev[key]?.memo ?? '',
                                },
                              }))
                            }
                          />
                        </label>
                      </div>
                      <p className={`mt-2 text-xs tabular-nums ${signedTone(signed)}`}>
                        P&amp;L effect: {formatSigned(signed, sym)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}
