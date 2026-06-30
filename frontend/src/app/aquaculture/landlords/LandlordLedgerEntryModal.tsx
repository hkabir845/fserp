'use client'

import { useEffect, useState } from 'react'
import { Wallet, X } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { formatBankRegisterLabel, normalizeBankAccountsFromApi } from '@/lib/bankAccountDisplay'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol } from '@/utils/currency'
import type { PondOpt } from './landlordShared'

type LedgerKind = 'payment' | 'rent_charge' | 'adjustment'

type BankOpt = {
  id: number
  account_name?: string
  bank_name?: string
  chart_account_code?: string | null
}

type StationOpt = { id: number; station_name: string }

type Props = {
  open: boolean
  landlordId: number
  landlordName: string
  ponds: PondOpt[]
  currency: string
  defaultKind?: LedgerKind
  onClose: () => void
  onSuccess: () => void
}

export function LandlordLedgerEntryModal({
  open,
  landlordId,
  landlordName,
  ponds,
  currency,
  defaultKind = 'payment',
  onClose,
  onSuccess,
}: Props) {
  const toast = useToast()
  const sym = getCurrencySymbol(currency)

  const [legKind, setLegKind] = useState<LedgerKind>(defaultKind)
  const [legAmount, setLegAmount] = useState('')
  const [legDate, setLegDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [legPond, setLegPond] = useState('')
  const [legApplyPaid, setLegApplyPaid] = useState(true)
  const [legMemo, setLegMemo] = useState('')
  const [legRef, setLegRef] = useState('')
  const [splitPayment, setSplitPayment] = useState(false)
  const [allocRows, setAllocRows] = useState<
    { pond_id: string; amount: string; applies_to_lease_paid: boolean }[]
  >([{ pond_id: '', amount: '', applies_to_lease_paid: true }])
  const [banks, setBanks] = useState<BankOpt[]>([])
  const [stations, setStations] = useState<StationOpt[]>([])
  const [legBankId, setLegBankId] = useState('')
  const [legStationId, setLegStationId] = useState('')
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLegKind(defaultKind)
    setLegAmount('')
    setLegDate(new Date().toISOString().slice(0, 10))
    setLegPond('')
    setLegApplyPaid(true)
    setLegMemo('')
    setLegRef('')
    setSplitPayment(false)
    setAllocRows([{ pond_id: '', amount: '', applies_to_lease_paid: true }])
    setLegBankId('')
    setLegStationId('')
  }, [open, defaultKind])

  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const [b, s] = await Promise.all([api.get<unknown>('/bank-accounts/'), api.get<unknown>('/stations/')])
        setBanks(normalizeBankAccountsFromApi(b.data))
        setStations(Array.isArray(s.data) ? (s.data as StationOpt[]) : [])
      } catch {
        setBanks([])
        setStations([])
      }
    })()
  }, [open])

  useEffect(() => {
    if (legKind !== 'payment') setSplitPayment(false)
  }, [legKind])

  const glBodyForPayment = (): Record<string, unknown> => {
    if (!legBankId) return {}
    const o: Record<string, unknown> = { bank_account_id: parseInt(legBankId, 10) }
    if (legStationId) o.station_id = parseInt(legStationId, 10)
    return o
  }

  const handleClose = () => {
    if (posting) return
    onClose()
  }

  const submit = async () => {
    const memo = legMemo.trim()
    const reference = legRef.trim()

    if (legKind === 'payment' && splitPayment) {
      const lines = allocRows
        .filter((r) => r.amount.trim())
        .map((r) => ({
          pond_id: r.pond_id ? parseInt(r.pond_id, 10) : null,
          amount: r.amount.trim().replace(/,/g, ''),
          applies_to_lease_paid: r.applies_to_lease_paid,
        }))
      if (lines.length === 0) {
        toast.error('Add at least one line with an amount')
        return
      }
      for (const ln of lines) {
        const n = Number(ln.amount)
        if (!Number.isFinite(n) || n <= 0) {
          toast.error('Each split line needs a positive amount')
          return
        }
        if (ln.applies_to_lease_paid && ln.pond_id == null) {
          toast.error('Lines that update pond paid must select a pond')
          return
        }
      }
      setPosting(true)
      try {
        await api.post(`/aquaculture/landlords/${landlordId}/ledger/`, {
          kind: 'payment',
          entry_date: legDate,
          memo,
          reference,
          ...glBodyForPayment(),
          allocations: lines.map((ln) => ({
            pond_id: ln.pond_id,
            amount: ln.amount,
            applies_to_lease_paid: ln.applies_to_lease_paid,
          })),
        })
        toast.success(lines.length > 1 ? `${lines.length} payments posted` : 'Payment recorded')
        onSuccess()
        handleClose()
      } catch (e) {
        toast.error(extractErrorMessage(e, 'Could not post payment'))
      } finally {
        setPosting(false)
      }
      return
    }

    const raw = legAmount.trim().replace(/,/g, '')
    const amt = Number(raw)
    if (!Number.isFinite(amt) || amt === 0) {
      toast.error('Enter a valid non-zero amount')
      return
    }
    const body: Record<string, unknown> = {
      kind: legKind,
      amount: legKind === 'adjustment' ? raw : String(Math.abs(amt)),
      entry_date: legDate,
      memo,
      reference,
    }
    if (legPond) {
      body.pond_id = parseInt(legPond, 10)
      body.applies_to_lease_paid = legKind === 'payment' ? legApplyPaid : false
    } else if (legKind === 'payment') {
      body.applies_to_lease_paid = false
    }
    setPosting(true)
    try {
      await api.post(`/aquaculture/landlords/${landlordId}/ledger/`, {
        ...body,
        ...(legKind === 'payment' ? glBodyForPayment() : {}),
      })
      toast.success(
        legKind === 'payment' ? 'Payment recorded' : legKind === 'rent_charge' ? 'Rent charge posted' : 'Adjustment posted',
      )
      onSuccess()
      handleClose()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not post entry'))
    } finally {
      setPosting(false)
    }
  }

  if (!open) return null

  const title =
    defaultKind === 'payment'
      ? 'Record payment'
      : defaultKind === 'rent_charge'
        ? 'Post rent charge'
        : 'Ledger entry'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="landlord-ledger-entry-title"
    >
      <div className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="landlord-ledger-entry-title" className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Wallet className="h-5 w-5 text-primary" aria-hidden />
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {landlordName}
              <span className="text-muted-foreground/70"> · </span>
              {sym} subledger
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={posting}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            {legKind === 'payment'
              ? 'Payments reduce what you owe. Select a bank register to post Dr 6711 / Cr cash. Optionally update each pond’s “paid to landlord” total.'
              : legKind === 'rent_charge'
                ? 'Rent charges increase obligation to this landlord.'
                : 'Signed amount: positive increases obligation; negative is credit.'}
          </p>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <label className="font-medium text-foreground/85">
              Kind
              <select
                className="mt-1 w-full rounded-lg border border-border px-2 py-2"
                value={legKind}
                onChange={(e) => setLegKind(e.target.value as LedgerKind)}
              >
                <option value="payment">Payment</option>
                <option value="rent_charge">Rent charge</option>
                <option value="adjustment">Adjustment (signed)</option>
              </select>
            </label>
            <label className="font-medium text-foreground/85">
              Date
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-border px-2 py-2"
                value={legDate}
                onChange={(e) => setLegDate(e.target.value)}
              />
            </label>
            {legKind === 'payment' ? (
              <label className="flex items-center gap-2 text-foreground/85 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={splitPayment}
                  onChange={(e) => setSplitPayment(e.target.checked)}
                />
                Split across multiple ponds
              </label>
            ) : null}
            {legKind === 'payment' && splitPayment ? (
              <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3 sm:col-span-2">
                {allocRows.map((ar, aidx) => (
                  <div key={aidx} className="flex flex-wrap items-end gap-2">
                    <label className="min-w-[120px] flex-1 text-xs font-medium text-foreground/85">
                      Pond
                      <select
                        className="mt-1 w-full rounded border border-border bg-white px-2 py-1.5 text-sm"
                        value={ar.pond_id}
                        onChange={(e) => {
                          const v = e.target.value
                          setAllocRows((prev) => prev.map((r, i) => (i === aidx ? { ...r, pond_id: v } : r)))
                        }}
                      >
                        <option value="">—</option>
                        {ponds.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="w-28 text-xs font-medium text-foreground/85">
                      Amount
                      <input
                        className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm tabular-nums"
                        value={ar.amount}
                        onChange={(e) => {
                          const v = e.target.value
                          setAllocRows((prev) => prev.map((r, i) => (i === aidx ? { ...r, amount: v } : r)))
                        }}
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-foreground/85">
                      <input
                        type="checkbox"
                        checked={ar.applies_to_lease_paid}
                        onChange={(e) => {
                          const v = e.target.checked
                          setAllocRows((prev) =>
                            prev.map((r, i) => (i === aidx ? { ...r, applies_to_lease_paid: v } : r)),
                          )
                        }}
                      />
                      Pond paid
                    </label>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs"
                      onClick={() => setAllocRows((prev) => prev.filter((_, i) => i !== aidx))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-xs font-medium text-primary underline"
                  onClick={() =>
                    setAllocRows((prev) => [...prev, { pond_id: '', amount: '', applies_to_lease_paid: true }])
                  }
                >
                  Add line
                </button>
              </div>
            ) : (
              <>
                <label className="font-medium text-foreground/85 sm:col-span-2">
                  {legKind === 'adjustment' ? 'Signed amount (+ owe, − credit)' : `Amount (${sym})`}
                  <input
                    className="mt-1 w-full rounded-lg border border-border px-2 py-2 tabular-nums"
                    value={legAmount}
                    onChange={(e) => setLegAmount(e.target.value)}
                    placeholder={legKind === 'adjustment' ? 'e.g. -500' : 'e.g. 5000'}
                  />
                </label>
                <label className="font-medium text-foreground/85 sm:col-span-2">
                  Pond (optional)
                  <select
                    className="mt-1 w-full rounded-lg border border-border px-2 py-2"
                    value={legPond}
                    onChange={(e) => setLegPond(e.target.value)}
                  >
                    <option value="">— none —</option>
                    {ponds.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {legKind === 'payment' && legPond ? (
                  <label className="flex items-center gap-2 text-foreground/85 sm:col-span-2">
                    <input type="checkbox" checked={legApplyPaid} onChange={(e) => setLegApplyPaid(e.target.checked)} />
                    Update pond &quot;paid to landlord&quot;
                  </label>
                ) : null}
              </>
            )}
            <label className="font-medium text-foreground/85 sm:col-span-2">
              Memo
              <input
                className="mt-1 w-full rounded-lg border border-border px-2 py-2"
                value={legMemo}
                onChange={(e) => setLegMemo(e.target.value)}
              />
            </label>
            <label className="font-medium text-foreground/85 sm:col-span-2">
              Reference
              <input
                className="mt-1 w-full rounded-lg border border-border px-2 py-2"
                value={legRef}
                onChange={(e) => setLegRef(e.target.value)}
              />
            </label>
            {legKind === 'payment' ? (
              <>
                <label className="font-medium text-foreground/85 sm:col-span-2">
                  Bank / cash register (G/L)
                  <select
                    className="mt-1 w-full rounded-lg border border-border px-2 py-2"
                    value={legBankId}
                    onChange={(e) => setLegBankId(e.target.value)}
                  >
                    <option value="">— subledger only —</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {formatBankRegisterLabel(b)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="font-medium text-foreground/85 sm:col-span-2">
                  Site (optional)
                  <select
                    className="mt-1 w-full rounded-lg border border-border px-2 py-2"
                    value={legStationId}
                    onChange={(e) => setLegStationId(e.target.value)}
                  >
                    <option value="">— company-wide —</option>
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.station_name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-muted/50 px-5 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={posting}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={posting}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {posting ? 'Posting…' : legKind === 'payment' ? 'Record payment' : 'Post entry'}
          </button>
        </div>
      </div>
    </div>
  )
}
