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
import { ArrowLeft, ChevronRight, Loader2, Search, X } from 'lucide-react'
import api from '@/lib/api'
import { formatCurrency } from '@/utils/formatting'
import { formatDateOnly } from '@/utils/date'
import { parseReportSiteScopeKey } from '@/app/reports/reportSiteScope'
import {
  hasTransactionTextSearch,
  transactionDateParams,
} from '@/lib/transactionListFilters'

export type DrillContactEntity = 'customers' | 'vendors'

export type AgingDrillDocument = {
  document_type?: string
  document_number?: string
  document_date?: string
  due_date?: string | null
  days_past_due?: number
  bucket?: string
  amount?: number | string
  status?: string
  invoice_id?: number
  bill_id?: number
}

export type ReportDrillTarget =
  | {
      kind: 'gl-account'
      accountId: number
      label?: string
      startDate?: string
      endDate?: string
      stationId?: number | null
      pondId?: number | null
    }
  | {
      kind: 'journal-entry'
      entryId: number
      label?: string
    }
  | {
      kind: 'contact-ledger'
      entity: DrillContactEntity
      entityId: number
      label?: string
      startDate?: string
      endDate?: string
    }
  | {
      kind: 'invoice'
      invoiceId: number
      label?: string
    }
  | {
      kind: 'bill'
      billId: number
      label?: string
    }
  | {
      kind: 'aging-documents'
      title: string
      subtitle?: string
      entityType: DrillContactEntity
      documents: AgingDrillDocument[]
    }
  | {
      kind: 'invoice-list'
      customerId: number
      label?: string
      startDate?: string
      endDate?: string
      stationId?: number | null
      paymentFilter?: 'cash' | 'credit' | 'all'
    }
  | {
      kind: 'bill-list'
      vendorId: number
      label?: string
      startDate?: string
      endDate?: string
      stationId?: number | null
    }
  | {
      kind: 'item-stock-ledger'
      itemId: number
      label?: string
      startDate?: string
      endDate?: string
    }
  | {
      kind: 'loan-statement'
      loanId: number
      label?: string
      startDate?: string
      endDate?: string
    }
    | {
      kind: 'scoped-pl'
      stationId?: number | null
      pondId?: number | null
      label?: string
      startDate?: string
      endDate?: string
    }
  | {
      kind: 'account-breakdown'
      title: string
      amountField: string
      accounts: {
        account_id: number
        account_code?: string
        account_name?: string
        amount: number | string
      }[]
      startDate?: string
      endDate?: string
      stationId?: number | null
      pondId?: number | null
    }
  | {
      kind: 'item-breakdown'
      title: string
      amountField: string
      items: {
        item_id: number
        sku?: string
        name?: string
        amount: number | string
      }[]
      startDate?: string
      endDate?: string
    }
  | {
      kind: 'loan-breakdown'
      title: string
      amountField: string
      loans: {
        loan_id: number
        loan_no?: string
        counterparty_name?: string
        amount: number | string
      }[]
      startDate?: string
      endDate?: string
    }
  | {
      kind: 'contact-breakdown'
      title: string
      entityType: DrillContactEntity
      amountField: string
      contacts: {
        entity_id: number
        display_name?: string
        amount: number | string
      }[]
      startDate?: string
      endDate?: string
    }
  | {
      kind: 'scoped-pl-breakdown'
      title: string
      amountField: string
      entities: {
        pond_id?: number
        station_id?: number
        name?: string
        amount: number | string
      }[]
      startDate?: string
      endDate?: string
    }

type ReportDrillFrame = ReportDrillTarget & { id: string }

type ReportDrillScope = {
  startDate?: string
  endDate?: string
  siteScopeKey?: string
}

type ReportDrillContextValue = {
  push: (target: ReportDrillTarget) => void
  pop: () => void
  closeAll: () => void
  stackDepth: number
  isOpen: boolean
}

const ReportDrillContext = createContext<ReportDrillContextValue | null>(null)

function frameTitle(target: ReportDrillTarget): string {
  switch (target.kind) {
    case 'gl-account':
      return target.label || 'GL account statement'
    case 'journal-entry':
      return target.label || 'Journal entry'
    case 'contact-ledger':
      return target.label || 'Contact ledger'
    case 'invoice':
      return target.label || 'Invoice detail'
    case 'bill':
      return target.label || 'Bill detail'
    case 'aging-documents':
      return target.title
    case 'invoice-list':
      return target.label || 'Customer invoices'
    case 'bill-list':
      return target.label || 'Vendor bills'
    case 'item-stock-ledger':
      return target.label || 'Item stock ledger'
    case 'loan-statement':
      return target.label || 'Loan statement'
    case 'scoped-pl':
      return target.label || 'Profit & Loss detail'
    case 'account-breakdown':
    case 'item-breakdown':
    case 'loan-breakdown':
    case 'contact-breakdown':
    case 'scoped-pl-breakdown':
      return target.title
    default:
      return 'Detail'
  }
}

function nextFrameId() {
  return `drill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function ReportDrillProvider({
  children,
  scope,
}: {
  children: ReactNode
  scope: ReportDrillScope
}) {
  const [stack, setStack] = useState<ReportDrillFrame[]>([])

  const push = useCallback((target: ReportDrillTarget) => {
    setStack((prev) => [...prev, { ...target, id: nextFrameId() }])
  }, [])

  const pop = useCallback(() => {
    setStack((prev) => (prev.length <= 1 ? [] : prev.slice(0, -1)))
  }, [])

  const closeAll = useCallback(() => {
    setStack([])
  }, [])

  const value = useMemo(
    () => ({
      push,
      pop,
      closeAll,
      stackDepth: stack.length,
      isOpen: stack.length > 0,
    }),
    [push, pop, closeAll, stack.length],
  )

  const siteScope = parseReportSiteScopeKey(scope.siteScopeKey || '')
  const defaultStationId = siteScope.kind === 'station' ? siteScope.id : null
  const defaultPondId = siteScope.kind === 'pond' ? siteScope.id : null

  return (
    <ReportDrillContext.Provider value={value}>
      {children}
      {stack.length > 0 ? (
        <ReportDrillModal
          stack={stack}
          onPop={pop}
          onCloseAll={closeAll}
          defaultStartDate={scope.startDate}
          defaultEndDate={scope.endDate}
          defaultStationId={defaultStationId}
          defaultPondId={defaultPondId}
          onPush={push}
        />
      ) : null}
    </ReportDrillContext.Provider>
  )
}

export function useReportDrill(): ReportDrillContextValue {
  const ctx = useContext(ReportDrillContext)
  if (!ctx) {
    throw new Error('useReportDrill must be used within ReportDrillProvider')
  }
  return ctx
}

export function useReportDrillOptional(): ReportDrillContextValue | null {
  return useContext(ReportDrillContext)
}

const DRILL_BTN =
  'cursor-pointer rounded px-0.5 underline decoration-dotted underline-offset-2 hover:bg-accent hover:text-primary/80 focus:outline-none focus:ring-2 focus:ring-ring/60'

export function DrillAmount({
  amount,
  drill,
  className = '',
  disabled = false,
  title,
  currency,
}: {
  amount: number | string
  drill?: ReportDrillTarget | null
  className?: string
  disabled?: boolean
  title?: string
  currency?: string
}) {
  const ctx = useReportDrillOptional()
  const formatted = formatCurrency(Number(amount ?? 0), currency)
  const canDrill = !disabled && drill && ctx && isDrillTargetActionable(drill)

  if (!canDrill) {
    return <span className={`tabular-nums ${className}`}>{formatted}</span>
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className={`${DRILL_BTN} tabular-nums ${className}`}
      title={title || 'Click to view source detail'}
      onClick={(e) => {
        e.stopPropagation()
        ctx.push(drill)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          ctx.push(drill)
        }
      }}
    >
      {formatted}
    </span>
  )
}

export function isDrillTargetActionable(target: ReportDrillTarget): boolean {
  switch (target.kind) {
    case 'gl-account':
      return Number(target.accountId) > 0
    case 'journal-entry':
      return Number(target.entryId) > 0
    case 'contact-ledger':
      return Number(target.entityId) > 0
    case 'invoice':
      return Number(target.invoiceId) > 0
    case 'bill':
      return Number(target.billId) > 0
    case 'aging-documents':
      return Array.isArray(target.documents) && target.documents.length > 0
    case 'invoice-list':
      return Number(target.customerId) > 0
    case 'bill-list':
      return Number(target.vendorId) > 0
    case 'item-stock-ledger':
      return Number(target.itemId) > 0
    case 'loan-statement':
      return Number(target.loanId) > 0
    case 'scoped-pl':
      return (
        Number(target.stationId ?? 0) > 0 ||
        Number(target.pondId ?? 0) > 0 ||
        Boolean(target.label)
      )
    case 'account-breakdown':
      return Array.isArray(target.accounts) && target.accounts.length > 0
    case 'item-breakdown':
      return Array.isArray(target.items) && target.items.length > 0
    case 'loan-breakdown':
      return Array.isArray(target.loans) && target.loans.length > 0
    case 'contact-breakdown':
      return Array.isArray(target.contacts) && target.contacts.length > 0
    case 'scoped-pl-breakdown':
      return Array.isArray(target.entities) && target.entities.length > 0
    default:
      return false
  }
}

function ReportDrillModal({
  stack,
  onPop,
  onCloseAll,
  onPush,
  defaultStartDate,
  defaultEndDate,
  defaultStationId,
  defaultPondId,
}: {
  stack: ReportDrillFrame[]
  onPop: () => void
  onCloseAll: () => void
  onPush: (target: ReportDrillTarget) => void
  defaultStartDate?: string
  defaultEndDate?: string
  defaultStationId?: number | null
  defaultPondId?: number | null
}) {
  const top = stack[stack.length - 1]

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close drill-down"
        onClick={onCloseAll}
      />
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span>Report drill-down</span>
              {stack.map((frame, idx) => (
                <span key={frame.id} className="inline-flex items-center gap-1">
                  <ChevronRight className="h-3 w-3" />
                  <span className={idx === stack.length - 1 ? 'font-medium text-foreground' : ''}>
                    {frameTitle(frame)}
                  </span>
                </span>
              ))}
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-foreground">{frameTitle(top)}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {stack.length > 1 ? (
              <button
                type="button"
                onClick={onPop}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={onCloseAll}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
            >
              <X className="h-4 w-4" />
              Close
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <ReportDrillPanel
            key={top.id}
            frame={top}
            onPush={onPush}
            defaultStartDate={defaultStartDate}
            defaultEndDate={defaultEndDate}
            defaultStationId={defaultStationId}
            defaultPondId={defaultPondId}
          />
        </div>
      </div>
    </div>
  )
}

function ReportDrillPanel({
  frame,
  onPush,
  defaultStartDate,
  defaultEndDate,
  defaultStationId,
  defaultPondId,
}: {
  frame: ReportDrillFrame
  onPush: (target: ReportDrillTarget) => void
  defaultStartDate?: string
  defaultEndDate?: string
  defaultStationId?: number | null
  defaultPondId?: number | null
}) {
  switch (frame.kind) {
    case 'gl-account':
      return (
        <GlStatementPanel
          accountId={frame.accountId}
          label={frame.label}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          stationId={frame.stationId ?? defaultStationId}
          onPush={onPush}
        />
      )
    case 'journal-entry':
      return <JournalEntryPanel entryId={frame.entryId} onPush={onPush} />
    case 'contact-ledger':
      return (
        <ContactLedgerPanel
          entity={frame.entity}
          entityId={frame.entityId}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          onPush={onPush}
        />
      )
    case 'invoice':
      return <InvoiceDetailPanel invoiceId={frame.invoiceId} onPush={onPush} />
    case 'bill':
      return <BillDetailPanel billId={frame.billId} onPush={onPush} />
    case 'aging-documents':
      return (
        <AgingDocumentsPanel
          title={frame.title}
          subtitle={frame.subtitle}
          entityType={frame.entityType}
          documents={frame.documents}
          onPush={onPush}
        />
      )
    case 'invoice-list':
      return (
        <InvoiceListPanel
          customerId={frame.customerId}
          label={frame.label}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          stationId={frame.stationId ?? defaultStationId}
          onPush={onPush}
        />
      )
    case 'bill-list':
      return (
        <BillListPanel
          vendorId={frame.vendorId}
          label={frame.label}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          stationId={frame.stationId ?? defaultStationId}
          onPush={onPush}
        />
      )
    case 'item-stock-ledger':
      return (
        <ItemStockLedgerPanel
          itemId={frame.itemId}
          label={frame.label}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          onPush={onPush}
        />
      )
    case 'loan-statement':
      return (
        <LoanStatementPanel
          loanId={frame.loanId}
          label={frame.label}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          onPush={onPush}
        />
      )
    case 'scoped-pl':
      return (
        <ScopedPlPanel
          stationId={frame.stationId ?? defaultStationId}
          pondId={frame.pondId ?? defaultPondId}
          label={frame.label}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          onPush={onPush}
        />
      )
    case 'account-breakdown':
      return (
        <AccountBreakdownPanel
          title={frame.title}
          amountField={frame.amountField}
          accounts={frame.accounts}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          stationId={frame.stationId ?? defaultStationId}
          pondId={frame.pondId ?? defaultPondId}
          onPush={onPush}
        />
      )
    case 'item-breakdown':
      return (
        <ItemBreakdownPanel
          title={frame.title}
          amountField={frame.amountField}
          items={frame.items}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          onPush={onPush}
        />
      )
    case 'loan-breakdown':
      return (
        <LoanBreakdownPanel
          title={frame.title}
          amountField={frame.amountField}
          loans={frame.loans}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          onPush={onPush}
        />
      )
    case 'contact-breakdown':
      return (
        <ContactBreakdownPanel
          title={frame.title}
          entityType={frame.entityType}
          contacts={frame.contacts}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          onPush={onPush}
        />
      )
    case 'scoped-pl-breakdown':
      return (
        <ScopedPlBreakdownPanel
          title={frame.title}
          entities={frame.entities}
          startDate={frame.startDate ?? defaultStartDate}
          endDate={frame.endDate ?? defaultEndDate}
          onPush={onPush}
        />
      )
    default:
      return null
  }
}

function LoadingPanel() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      Loading…
    </div>
  )
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">{message}</div>
  )
}

type GlStatementPayload = {
  account?: { account_code?: string; account_name?: string; account_type?: string; account_sub_type?: string }
  opening_balance?: string
  ending_balance?: string
  start_date?: string | null
  end_date?: string | null
  filter_station_id?: number | null
  search_q?: string | null
  date_range_ignored?: boolean
  transactions?: {
    journal_entry_id?: number
    entry_number?: string
    date?: string
    description?: string
    journal_description?: string
    debit?: string
    credit?: string
    balance?: string
    other_account_id?: number | null
    other_account_name?: string | null
    other_account_code?: string | null
  }[]
}

function GlStatementPanel({
  accountId,
  label,
  startDate,
  endDate,
  stationId,
  onPush,
}: {
  accountId: number
  label?: string
  startDate?: string
  endDate?: string
  stationId?: number | null
  onPush: (target: ReportDrillTarget) => void
}) {
  const [data, setData] = useState<GlStatementPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQ, setSearchQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchQ.trim()), 350)
    return () => window.clearTimeout(t)
  }, [searchQ])

  const hasTextSearch = hasTransactionTextSearch({ q: debouncedQ })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Record<string, string> = {}
    const dates = transactionDateParams(startDate || '', endDate || '', hasTextSearch)
    if (dates.start_date) params.start_date = dates.start_date
    if (dates.end_date) params.end_date = dates.end_date
    if (debouncedQ) params.q = debouncedQ
    if (stationId) params.station_id = String(stationId)
    void api
      .get(`/chart-of-accounts/${accountId}/statement/`, { params })
      .then((res) => {
        if (!cancelled) setData(res.data as GlStatementPayload)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load GL account statement.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountId, startDate, endDate, stationId, debouncedQ, hasTextSearch])

  if (loading) return <LoadingPanel />
  if (error) return <ErrorPanel message={error} />
  if (!data) return <ErrorPanel message="No statement data." />

  const acct = data.account || {}
  const rows = data.transactions || []

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
        <p className="font-semibold text-foreground">
          {acct.account_code} — {acct.account_name || label}
        </p>
        <p className="text-muted-foreground">
          {acct.account_type}
          {acct.account_sub_type ? ` / ${acct.account_sub_type}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <span>
            Opening: <strong>{formatCurrency(Number(data.opening_balance ?? 0))}</strong>
          </span>
          <span>
            Ending: <strong>{formatCurrency(Number(data.ending_balance ?? 0))}</strong>
          </span>
          {data.start_date || data.end_date ? (
            <span className="text-muted-foreground">
              Period: {data.start_date || '…'} → {data.end_date || '…'}
            </span>
          ) : hasTextSearch ? (
            <span className="text-muted-foreground">All dates (search active)</span>
          ) : null}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-white px-4 py-3">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Search (all dates)</label>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Entry #, description, account…"
            disabled={loading}
            className="w-full rounded-md border border-border py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {hasTextSearch && (startDate || endDate) ? (
          <p className="mt-1 text-xs text-muted-foreground">Date range paused while searching.</p>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Date</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Entry</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Description</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Debit</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Credit</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  {hasTextSearch
                    ? 'No journal lines match your search.'
                    : 'No journal lines in this period.'}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const debit = Number(row.debit ?? 0)
                const credit = Number(row.credit ?? 0)
                const otherLabel =
                  row.other_account_code && row.other_account_name
                    ? `${row.other_account_code} — ${row.other_account_name}`
                    : row.other_account_name || ''
                return (
                  <tr key={`${row.journal_entry_id}-${idx}`} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateOnly(row.date)}</td>
                    <td className="px-3 py-2">
                      {row.journal_entry_id ? (
                        <button
                          type="button"
                          className="font-mono text-xs text-primary underline hover:text-blue-900"
                          onClick={() =>
                            onPush({
                              kind: 'journal-entry',
                              entryId: row.journal_entry_id!,
                              label: row.entry_number || `JE #${row.journal_entry_id}`,
                            })
                          }
                        >
                          {row.entry_number || `#${row.journal_entry_id}`}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div>{row.description || row.journal_description || '—'}</div>
                      {otherLabel ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Offset:{' '}
                          {row.other_account_id ? (
                            <button
                              type="button"
                              className="text-primary underline hover:text-blue-900"
                              onClick={() =>
                                onPush({
                                  kind: 'gl-account',
                                  accountId: row.other_account_id!,
                                  label: otherLabel,
                                  startDate,
                                  endDate,
                                  stationId,
                                })
                              }
                            >
                              {otherLabel}
                            </button>
                          ) : (
                            otherLabel
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {debit ? (
                        <DrillAmount
                          amount={debit}
                          drill={
                            row.journal_entry_id
                              ? {
                                  kind: 'journal-entry',
                                  entryId: row.journal_entry_id,
                                  label: row.entry_number,
                                }
                              : null
                          }
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {credit ? (
                        <DrillAmount
                          amount={credit}
                          drill={
                            row.journal_entry_id
                              ? {
                                  kind: 'journal-entry',
                                  entryId: row.journal_entry_id,
                                  label: row.entry_number,
                                }
                              : null
                          }
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatCurrency(Number(row.balance ?? 0))}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type JournalEntryPayload = {
  entry_number?: string
  entry_date?: string
  description?: string
  station_name?: string
  total_debit?: string
  total_credit?: string
  lines?: {
    line_number?: number
    account_id?: number
    account_code?: string
    account_name?: string
    debit?: string
    credit?: string
    description?: string
    station_name?: string
    pond_name?: string
    aquaculture_pond_name?: string
  }[]
}

function JournalEntryPanel({
  entryId,
  onPush,
}: {
  entryId: number
  onPush: (target: ReportDrillTarget) => void
}) {
  const [data, setData] = useState<JournalEntryPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void api
      .get(`/journal-entries/${entryId}/`)
      .then((res) => {
        if (!cancelled) setData(res.data as JournalEntryPayload)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load journal entry.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entryId])

  if (loading) return <LoadingPanel />
  if (error) return <ErrorPanel message={error} />
  if (!data) return <ErrorPanel message="No journal entry data." />

  const lines = data.lines || []

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
        <p className="font-semibold text-foreground">{data.entry_number || `Entry #${entryId}`}</p>
        <p className="text-muted-foreground">{formatDateOnly(data.entry_date)} — {data.description || 'No description'}</p>
        {data.station_name ? <p className="text-muted-foreground">Site: {data.station_name}</p> : null}
        <p className="mt-1 text-foreground/85">
          Total debit {formatCurrency(Number(data.total_debit ?? 0))} · Total credit{' '}
          {formatCurrency(Number(data.total_credit ?? 0))}
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Account</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Description</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Debit</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {lines.map((line, idx) => (
              <tr key={`${line.account_id}-${idx}`} className="hover:bg-muted/40">
                <td className="px-3 py-2">
                  {line.account_id ? (
                    <button
                      type="button"
                      className="text-left text-primary underline hover:text-blue-900"
                      onClick={() =>
                        onPush({
                          kind: 'gl-account',
                          accountId: line.account_id!,
                          label: `${line.account_code} — ${line.account_name}`,
                        })
                      }
                    >
                      <span className="font-mono text-xs">{line.account_code}</span>
                      <div>{line.account_name}</div>
                    </button>
                  ) : (
                    '—'
                  )}
                  {(line.aquaculture_pond_name || line.pond_name || line.station_name) ? (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {line.aquaculture_pond_name || line.pond_name || line.station_name}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">{line.description || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(line.debit ?? 0) ? formatCurrency(Number(line.debit)) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(line.credit ?? 0) ? formatCurrency(Number(line.credit)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type ContactLedgerPayload = {
  display_name?: string
  opening_balance?: string
  closing_balance?: string
  transactions?: {
    date?: string
    type?: string
    reference?: string
    description?: string
    debit?: string
    credit?: string
    balance?: string
    related_id?: number
    allocations?: {
      invoice_id?: number
      bill_id?: number
      invoice_number?: string
      bill_number?: string
      amount?: string
    }[]
  }[]
}

function ContactLedgerPanel({
  entity,
  entityId,
  startDate,
  endDate,
  onPush,
}: {
  entity: DrillContactEntity
  entityId: number
  startDate?: string
  endDate?: string
  onPush: (target: ReportDrillTarget) => void
}) {
  const [data, setData] = useState<ContactLedgerPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQ, setSearchQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchQ.trim()), 350)
    return () => window.clearTimeout(t)
  }, [searchQ])

  const hasTextSearch = hasTransactionTextSearch({ q: debouncedQ })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Record<string, string> = {}
    const dates = transactionDateParams(startDate || '', endDate || '', hasTextSearch)
    if (dates.start_date) params.start_date = dates.start_date
    if (dates.end_date) params.end_date = dates.end_date
    if (debouncedQ) params.q = debouncedQ
    void api
      .get(`/${entity}/${entityId}/ledger/`, { params })
      .then((res) => {
        if (!cancelled) setData(res.data as ContactLedgerPayload)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load contact ledger.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entity, entityId, startDate, endDate, debouncedQ, hasTextSearch])

  if (loading) return <LoadingPanel />
  if (error) return <ErrorPanel message={error} />
  if (!data) return <ErrorPanel message="No ledger data." />

  const rows = data.transactions || []

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
        <p className="font-semibold text-foreground">{data.display_name}</p>
        <div className="mt-1 flex flex-wrap gap-4">
          <span>
            Opening: <strong>{formatCurrency(Number(data.opening_balance ?? 0))}</strong>
          </span>
          <span>
            Closing: <strong>{formatCurrency(Number(data.closing_balance ?? 0))}</strong>
          </span>
          {hasTextSearch ? (
            <span className="text-muted-foreground">All dates (search active)</span>
          ) : startDate || endDate ? (
            <span className="text-muted-foreground">
              Period: {startDate || '…'} → {endDate || '…'}
            </span>
          ) : null}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-white px-4 py-3">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Search (all dates)</label>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Reference, description…"
            disabled={loading}
            className="w-full rounded-md border border-border py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {hasTextSearch && (startDate || endDate) ? (
          <p className="mt-1 text-xs text-muted-foreground">Date range paused while searching.</p>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Date</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Type</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Reference</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Debit</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Credit</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  {hasTextSearch
                    ? 'No ledger lines match your search.'
                    : 'No ledger transactions in this period.'}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const debit = Number(row.debit ?? 0)
                const credit = Number(row.credit ?? 0)
                const allocs = row.allocations || []
                return (
                  <tr key={`${row.reference}-${idx}`} className="hover:bg-muted/40 align-top">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateOnly(row.date)}</td>
                    <td className="px-3 py-2">{row.type || '—'}</td>
                    <td className="px-3 py-2">
                      <div>{row.reference || row.description || '—'}</div>
                      {allocs.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {allocs.map((a, aIdx) => {
                            const docId = a.invoice_id ?? a.bill_id
                            const docNum = a.invoice_number ?? a.bill_number
                            const isInvoice = a.invoice_id != null
                            return (
                              <li key={`alloc-${aIdx}`}>
                                {docId ? (
                                  <button
                                    type="button"
                                    className="text-primary underline hover:text-blue-900"
                                    onClick={() =>
                                      onPush(
                                        isInvoice
                                          ? {
                                              kind: 'invoice',
                                              invoiceId: a.invoice_id!,
                                              label: docNum || `Invoice #${a.invoice_id}`,
                                            }
                                          : {
                                              kind: 'bill',
                                              billId: a.bill_id!,
                                              label: docNum || `Bill #${a.bill_id}`,
                                            },
                                      )
                                    }
                                  >
                                    {docNum || (isInvoice ? 'Invoice' : 'Bill')}
                                  </button>
                                ) : (
                                  docNum || 'Document'
                                )}
                                :{' '}
                                <DrillAmount
                                  amount={a.amount ?? 0}
                                  drill={
                                    docId
                                      ? isInvoice
                                        ? {
                                            kind: 'invoice',
                                            invoiceId: a.invoice_id!,
                                            label: docNum,
                                          }
                                        : {
                                            kind: 'bill',
                                            billId: a.bill_id!,
                                            label: docNum,
                                          }
                                      : null
                                  }
                                />
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {debit ? formatCurrency(debit) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {credit ? formatCurrency(credit) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatCurrency(Number(row.balance ?? 0))}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InvoiceDetailPanel({
  invoiceId,
  onPush,
}: {
  invoiceId: number
  onPush: (target: ReportDrillTarget) => void
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void api
      .get(`/invoices/${invoiceId}/`)
      .then((res) => {
        if (!cancelled) setData(res.data as Record<string, unknown>)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load invoice.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  if (loading) return <LoadingPanel />
  if (error) return <ErrorPanel message={error} />
  if (!data) return <ErrorPanel message="No invoice data." />

  const lines = (data.lines as Record<string, unknown>[]) || []
  const customer = data.customer as Record<string, unknown> | undefined

  return (
    <DocumentDetailView
      title={String(data.invoice_number || `Invoice #${invoiceId}`)}
      meta={[
        ['Date', formatDateOnly(String(data.invoice_date || ''))],
        ['Status', String(data.status || '')],
        ['Customer', String(customer?.display_name || data.customer_name || '')],
        ['Total', formatCurrency(Number(data.total ?? data.total_amount ?? 0))],
      ]}
      lines={lines.map((ln) => ({
        description: String(ln.description || ln.item_name || 'Line'),
        amount: Number(ln.amount ?? ln.line_total ?? 0),
      }))}
      footerNote="This is the source invoice for the selected amount. Use Back to return to the prior view, or Close to return to the report."
      onCustomerDrill={
        customer?.id
          ? () =>
              onPush({
                kind: 'contact-ledger',
                entity: 'customers',
                entityId: Number(customer.id),
                label: String(customer.display_name || 'Customer ledger'),
              })
          : undefined
      }
    />
  )
}

function BillDetailPanel({
  billId,
  onPush,
}: {
  billId: number
  onPush: (target: ReportDrillTarget) => void
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void api
      .get(`/bills/${billId}/`)
      .then((res) => {
        if (!cancelled) setData(res.data as Record<string, unknown>)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load bill.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [billId])

  if (loading) return <LoadingPanel />
  if (error) return <ErrorPanel message={error} />
  if (!data) return <ErrorPanel message="No bill data." />

  const lines = (data.lines as Record<string, unknown>[]) || []
  const vendor = data.vendor as Record<string, unknown> | undefined

  return (
    <DocumentDetailView
      title={String(data.bill_number || `Bill #${billId}`)}
      meta={[
        ['Date', formatDateOnly(String(data.bill_date || ''))],
        ['Status', String(data.status || '')],
        ['Vendor', String(vendor?.display_name || data.vendor_name || '')],
        ['Total', formatCurrency(Number(data.total ?? data.total_amount ?? 0))],
      ]}
      lines={lines.map((ln) => ({
        description: String(ln.description || ln.item_name || 'Line'),
        amount: Number(ln.amount ?? ln.line_total ?? 0),
      }))}
      footerNote="This is the source bill for the selected amount. Use Back to return to the prior view, or Close to return to the report."
      onContactDrill={
        vendor?.id
          ? () =>
              onPush({
                kind: 'contact-ledger',
                entity: 'vendors',
                entityId: Number(vendor.id),
                label: String(vendor.display_name || 'Vendor ledger'),
              })
          : undefined
      }
    />
  )
}

function DocumentDetailView({
  title,
  meta,
  lines,
  footerNote,
  onCustomerDrill,
  onContactDrill,
}: {
  title: string
  meta: [string, string][]
  lines: { description: string; amount: number }[]
  footerNote: string
  onCustomerDrill?: () => void
  onContactDrill?: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
        <p className="text-lg font-semibold text-foreground">{title}</p>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {meta.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        {onCustomerDrill ? (
          <button
            type="button"
            className="mt-3 text-sm font-medium text-primary underline hover:text-blue-900"
            onClick={onCustomerDrill}
          >
            View customer ledger
          </button>
        ) : null}
        {onContactDrill ? (
          <button
            type="button"
            className="mt-3 text-sm font-medium text-primary underline hover:text-blue-900"
            onClick={onContactDrill}
          >
            View vendor ledger
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Line</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {lines.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                  No line items.
                </td>
              </tr>
            ) : (
              lines.map((ln, idx) => (
                <tr key={`${ln.description}-${idx}`}>
                  <td className="px-3 py-2">{ln.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(ln.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{footerNote}</p>
    </div>
  )
}

function AgingDocumentsPanel({
  title,
  subtitle,
  entityType,
  documents,
  onPush,
}: {
  title: string
  subtitle?: string
  entityType: DrillContactEntity
  documents: AgingDrillDocument[]
  onPush: (target: ReportDrillTarget) => void
}) {
  const isAr = entityType === 'customers'
  return (
    <div className="space-y-4">
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Document</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Date</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Due</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Status</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Open amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {documents.map((doc, idx) => {
              const docId = isAr ? doc.invoice_id : doc.bill_id
              const drill: ReportDrillTarget | null = docId
                ? isAr
                  ? {
                      kind: 'invoice',
                      invoiceId: docId,
                      label: doc.document_number || `Invoice #${docId}`,
                    }
                  : {
                      kind: 'bill',
                      billId: docId,
                      label: doc.document_number || `Bill #${docId}`,
                    }
                : null
              return (
                <tr key={`${doc.document_number}-${idx}`} className="hover:bg-muted/40">
                  <td className="px-3 py-2 font-medium">
                    {docId ? (
                      <button
                        type="button"
                        className="text-primary underline hover:text-blue-900"
                        onClick={() => drill && onPush(drill)}
                      >
                        {doc.document_number || `#${docId}`}
                      </button>
                    ) : (
                      doc.document_number || '—'
                    )}
                  </td>
                  <td className="px-3 py-2">{formatDateOnly(doc.document_date)}</td>
                  <td className="px-3 py-2">{formatDateOnly(doc.due_date || undefined)}</td>
                  <td className="px-3 py-2">{doc.status || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <DrillAmount amount={doc.amount ?? 0} drill={drill} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Open {isAr ? 'invoices' : 'bills'} for {title}. Click an amount to see the full document.
      </p>
    </div>
  )
}

function InvoiceListPanel({
  customerId,
  label,
  startDate,
  endDate,
  stationId,
  onPush,
}: {
  customerId: number
  label?: string
  startDate?: string
  endDate?: string
  stationId?: number | null
  onPush: (target: ReportDrillTarget) => void
}) {
  const [data, setData] = useState<{ display_name?: string; documents?: AgingDrillDocument[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { customer_id: String(customerId) }
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    if (stationId) params.station_id = String(stationId)
    void api
      .get('/reports/drill/invoices/', { params })
      .then((res) => {
        if (!cancelled) setData(res.data as { display_name?: string; documents?: AgingDrillDocument[] })
      })
      .catch(() => {
        if (!cancelled) setError('Could not load invoices.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customerId, startDate, endDate, stationId])

  if (loading) return <LoadingPanel />
  if (error) return <ErrorPanel message={error} />
  return (
    <AgingDocumentsPanel
      title={label || data?.display_name || 'Customer'}
      subtitle="Invoices in the report period"
      entityType="customers"
      documents={data?.documents || []}
      onPush={onPush}
    />
  )
}

function BillListPanel({
  vendorId,
  label,
  startDate,
  endDate,
  stationId,
  onPush,
}: {
  vendorId: number
  label?: string
  startDate?: string
  endDate?: string
  stationId?: number | null
  onPush: (target: ReportDrillTarget) => void
}) {
  const [data, setData] = useState<{ display_name?: string; documents?: AgingDrillDocument[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { vendor_id: String(vendorId) }
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    if (stationId) params.station_id = String(stationId)
    void api
      .get('/reports/drill/bills/', { params })
      .then((res) => {
        if (!cancelled) setData(res.data as { display_name?: string; documents?: AgingDrillDocument[] })
      })
      .catch(() => {
        if (!cancelled) setError('Could not load bills.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [vendorId, startDate, endDate, stationId])

  if (loading) return <LoadingPanel />
  if (error) return <ErrorPanel message={error} />
  return (
    <AgingDocumentsPanel
      title={label || data?.display_name || 'Vendor'}
      subtitle="Bills in the report period"
      entityType="vendors"
      documents={data?.documents || []}
      onPush={onPush}
    />
  )
}

type ItemLedgerPayload = {
  item?: { name?: string; sku?: string; unit?: string }
  movements?: {
    date?: string
    type_label?: string
    reference?: string
    counterparty?: string
    memo?: string
    delta?: string | number
    balance?: string | number
    bill_id?: number
    invoice_id?: number
  }[]
}

function ItemStockLedgerPanel({
  itemId,
  label,
  startDate,
  endDate,
  onPush,
}: {
  itemId: number
  label?: string
  startDate?: string
  endDate?: string
  onPush: (target: ReportDrillTarget) => void
}) {
  const [data, setData] = useState<ItemLedgerPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Record<string, string> = {}
    if (startDate) params.start = startDate
    if (endDate) params.end = endDate
    void api
      .get(`/items/${itemId}/stock-ledger/`, { params })
      .then((res) => {
        if (!cancelled) setData(res.data as ItemLedgerPayload)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load item stock ledger.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [itemId, startDate, endDate])

  if (loading) return <LoadingPanel />
  if (error) return <ErrorPanel message={error} />
  const rows = data?.movements || []
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
        <p className="font-semibold text-foreground">{label || data?.item?.name || `Item #${itemId}`}</p>
        {data?.item?.sku ? <p className="text-muted-foreground">SKU: {data.item.sku}</p> : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Date</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Type</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Reference</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Qty Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  No stock movements in this period.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={`${row.reference}-${idx}`} className="hover:bg-muted/40">
                  <td className="px-3 py-2">{formatDateOnly(row.date)}</td>
                  <td className="px-3 py-2">{row.type_label || '—'}</td>
                  <td className="px-3 py-2">
                    {row.invoice_id ? (
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() =>
                          onPush({
                            kind: 'invoice',
                            invoiceId: row.invoice_id!,
                            label: row.reference,
                          })
                        }
                      >
                        {row.reference || `#${row.invoice_id}`}
                      </button>
                    ) : row.bill_id ? (
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() =>
                          onPush({
                            kind: 'bill',
                            billId: row.bill_id!,
                            label: row.reference,
                          })
                        }
                      >
                        {row.reference || `#${row.bill_id}`}
                      </button>
                    ) : (
                      row.reference || row.counterparty || '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.delta ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LoanStatementPanel({
  loanId,
  label,
  startDate,
  endDate,
  onPush,
}: {
  loanId: number
  label?: string
  startDate?: string
  endDate?: string
  onPush: (target: ReportDrillTarget) => void
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Record<string, string> = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    void api
      .get(`/loans/${loanId}/statement/`, { params })
      .then((res) => {
        if (!cancelled) setData(res.data as Record<string, unknown>)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load loan statement.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loanId, startDate, endDate])

  if (loading) return <LoadingPanel />
  if (error) return <ErrorPanel message={error} />
  const rows = (data?.transactions as Record<string, unknown>[]) || []
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
        <p className="font-semibold text-foreground">{label || String(data?.loan_name || `Loan #${loanId}`)}</p>
        {data?.outstanding != null ? (
          <p className="mt-1">
            Outstanding: <strong>{formatCurrency(Number(data.outstanding))}</strong>
          </p>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Date</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Type</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {rows.map((row, idx) => (
              <tr key={idx} className="hover:bg-muted/40">
                <td className="px-3 py-2">{formatDateOnly(String(row.date || ''))}</td>
                <td className="px-3 py-2">{String(row.type || row.description || '—')}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <DrillAmount
                    amount={Number(row.amount ?? 0)}
                    drill={
                      row.journal_entry_id
                        ? {
                            kind: 'journal-entry',
                            entryId: Number(row.journal_entry_id),
                            label: String(row.reference || ''),
                          }
                        : null
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ScopedPlPanel({
  stationId,
  pondId,
  label,
  startDate,
  endDate,
  onPush,
}: {
  stationId?: number | null
  pondId?: number | null
  label?: string
  startDate?: string
  endDate?: string
  onPush: (target: ReportDrillTarget) => void
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Record<string, string> = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    if (pondId) params.pond_id = String(pondId)
    else if (stationId) params.station_id = String(stationId)
    void api
      .get('/reports/income-statement/', { params })
      .then((res) => {
        if (!cancelled) setData(res.data as Record<string, unknown>)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load scoped P&L.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [stationId, pondId, startDate, endDate])

  if (loading) return <LoadingPanel />
  if (error) return <ErrorPanel message={error} />
  const blocks = [
    { title: 'Income', payload: data?.income as { accounts?: Record<string, unknown>[]; total?: number } },
    { title: 'COGS', payload: data?.cost_of_goods_sold as { accounts?: Record<string, unknown>[]; total?: number } },
    { title: 'Expenses', payload: data?.expenses as { accounts?: Record<string, unknown>[]; total?: number } },
  ]
  const scope = { startDate, endDate, stationId, pondId }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Account detail for <strong>{label || 'entity'}</strong> in the selected period.
      </p>
      {blocks.map(({ title, payload }) => (
        <div key={title} className="rounded-lg border border-border">
          <div className="flex justify-between border-b bg-muted/40 px-4 py-2">
            <span className="font-semibold">{title}</span>
            <DrillAmount
              amount={Number(payload?.total ?? 0)}
              drill={null}
              disabled
            />
          </div>
          <div className="divide-y">
            {(payload?.accounts || []).map((acc, idx) => (
              <div key={idx} className="flex justify-between px-4 py-2 text-sm">
                <span>
                  {String(acc.account_code || '')} {String(acc.account_name || '')}
                </span>
                <DrillAmount
                  amount={Number(acc.balance ?? 0)}
                  drill={{
                    kind: 'gl-account',
                    accountId: Number(acc.account_id),
                    label: `${acc.account_code} — ${acc.account_name}`,
                    startDate,
                    endDate,
                    stationId,
                    pondId,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function AccountBreakdownPanel({
  title,
  accounts,
  startDate,
  endDate,
  stationId,
  pondId,
  onPush,
}: {
  title: string
  amountField: string
  accounts: {
    account_id: number
    account_code?: string
    account_name?: string
    amount: number | string
  }[]
  startDate?: string
  endDate?: string
  stationId?: number | null
  pondId?: number | null
  onPush: (target: ReportDrillTarget) => void
}) {
  const scope = { startDate, endDate, stationId, pondId }
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">Click an amount to open that account&apos;s GL statement.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Code</th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Account</th>
              <th className="px-4 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70 bg-white">
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  No lines in this total.
                </td>
              </tr>
            ) : (
              accounts.map((a) => {
                const drill = glAccountDrill(a, scope)
                return (
                  <tr key={a.account_id} className="hover:bg-muted/40">
                    <td className="px-4 py-2 font-mono text-foreground/85">{a.account_code || '—'}</td>
                    <td className="px-4 py-2 text-foreground">{a.account_name || '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <DrillAmount amount={Number(a.amount ?? 0)} drill={drill} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ItemBreakdownPanel({
  title,
  items,
  startDate,
  endDate,
  onPush,
}: {
  title: string
  amountField: string
  items: { item_id: number; sku?: string; name?: string; amount: number | string }[]
  startDate?: string
  endDate?: string
  onPush: (target: ReportDrillTarget) => void
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">Click an amount to open that item&apos;s stock ledger.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">SKU</th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Item</th>
              <th className="px-4 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70 bg-white">
            {items.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  No items in this total.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.item_id} className="hover:bg-muted/40">
                  <td className="px-4 py-2 font-mono text-foreground/85">{it.sku || '—'}</td>
                  <td className="px-4 py-2 text-foreground">{it.name || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <DrillAmount
                      amount={Number(it.amount ?? 0)}
                      drill={{
                        kind: 'item-stock-ledger',
                        itemId: it.item_id,
                        label: it.name || it.sku,
                        startDate,
                        endDate,
                      }}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LoanBreakdownPanel({
  title,
  loans,
  startDate,
  endDate,
}: {
  title: string
  amountField: string
  loans: {
    loan_id: number
    loan_no?: string
    counterparty_name?: string
    amount: number | string
  }[]
  startDate?: string
  endDate?: string
  onPush: (target: ReportDrillTarget) => void
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">Click an amount to open that loan&apos;s statement.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Loan #</th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Counterparty</th>
              <th className="px-4 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70 bg-white">
            {loans.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  No facilities in this total.
                </td>
              </tr>
            ) : (
              loans.map((ln) => (
                <tr key={ln.loan_id} className="hover:bg-muted/40">
                  <td className="px-4 py-2 font-mono text-foreground/85">{ln.loan_no || ln.loan_id}</td>
                  <td className="px-4 py-2 text-foreground">{ln.counterparty_name || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <DrillAmount
                      amount={Number(ln.amount ?? 0)}
                      drill={{
                        kind: 'loan-statement',
                        loanId: ln.loan_id,
                        label: ln.counterparty_name || ln.loan_no,
                        startDate,
                        endDate,
                      }}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ContactBreakdownPanel({
  title,
  entityType,
  contacts,
  startDate,
  endDate,
  onPush,
}: {
  title: string
  entityType: DrillContactEntity
  contacts: { entity_id: number; display_name?: string; amount: number | string }[]
  startDate?: string
  endDate?: string
  onPush: (target: ReportDrillTarget) => void
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">
        Click an amount to open that {entityType === 'customers' ? 'customer' : 'vendor'}&apos;s ledger.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Name</th>
              <th className="px-4 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70 bg-white">
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                  No balances in this total.
                </td>
              </tr>
            ) : (
              contacts.map((c) => (
                <tr key={c.entity_id} className="hover:bg-muted/40">
                  <td className="px-4 py-2 text-foreground">{c.display_name || `#${c.entity_id}`}</td>
                  <td className="px-4 py-2 text-right">
                    <DrillAmount
                      amount={Math.abs(Number(c.amount ?? 0))}
                      drill={{
                        kind: 'contact-ledger',
                        entity: entityType,
                        entityId: c.entity_id,
                        label: c.display_name,
                        startDate,
                        endDate,
                      }}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ScopedPlBreakdownPanel({
  title,
  entities,
  startDate,
  endDate,
  onPush,
}: {
  title: string
  entities: {
    pond_id?: number
    station_id?: number
    name?: string
    amount: number | string
  }[]
  startDate?: string
  endDate?: string
  onPush: (target: ReportDrillTarget) => void
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">Click an amount to open that site&apos;s P&amp;L detail.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Site</th>
              <th className="px-4 py-2 text-right text-xs font-medium uppercase text-muted-foreground">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70 bg-white">
            {entities.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                  No amounts in this total.
                </td>
              </tr>
            ) : (
              entities.map((e, idx) => {
                const pondId = Number(e.pond_id ?? 0)
                const stationId = Number(e.station_id ?? 0)
                const key = pondId || stationId || idx
                return (
                  <tr key={key} className="hover:bg-muted/40">
                    <td className="px-4 py-2 text-foreground">{e.name || `#${key}`}</td>
                    <td className="px-4 py-2 text-right">
                      <DrillAmount
                        amount={Number(e.amount ?? 0)}
                        drill={{
                          kind: 'scoped-pl',
                          pondId: pondId > 0 ? pondId : null,
                          stationId: stationId > 0 ? stationId : null,
                          label: e.name,
                          startDate,
                          endDate,
                        }}
                      />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Build a GL account drill target from a report account row. */
export function glAccountDrill(
  account: { account_id?: number; account_code?: string; account_name?: string },
  scope?: { startDate?: string; endDate?: string; stationId?: number | null; pondId?: number | null },
): ReportDrillTarget | null {
  const accountId = Number(account.account_id ?? 0)
  if (!accountId) return null
  const label =
    account.account_code && account.account_name
      ? `${account.account_code} — ${account.account_name}`
      : account.account_name || account.account_code
  return {
    kind: 'gl-account',
    accountId,
    label,
    startDate: scope?.startDate,
    endDate: scope?.endDate,
    stationId: scope?.stationId,
    pondId: scope?.pondId,
  }
}
