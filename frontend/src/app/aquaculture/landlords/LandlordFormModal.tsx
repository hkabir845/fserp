'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Droplets, Landmark, Plus, User, X } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { MODAL_BACKDROP, MODAL_FORM_PANEL } from '@/lib/modalLayout'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'
import {
  buildLandlordPayload,
  defaultFormValues,
  emptyShareDraft,
  formValuesFromDetail,
  impliedAnnualFromPondRow,
  type LandlordDetail,
  type LandlordFormValues,
  type PondOpt,
} from './landlordShared'

type Props = {
  open: boolean
  mode: 'create' | 'edit'
  landlordId?: number
  ponds: PondOpt[]
  currency: string
  onClose: () => void
  onSuccess: (landlordId: number) => void
}

export function LandlordFormModal({
  open,
  mode,
  landlordId,
  ponds,
  currency,
  onClose,
  onSuccess,
}: Props) {
  const toast = useToast()
  const sym = useMemo(() => getCurrencySymbol(currency), [currency])
  const [values, setValues] = useState<LandlordFormValues>(defaultFormValues)
  const [saving, setSaving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const setField = useCallback(<K extends keyof LandlordFormValues>(key: K, val: LandlordFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: val }))
  }, [])

  const reset = useCallback(() => {
    setValues(defaultFormValues())
  }, [])

  useEffect(() => {
    if (!open) return
    if (mode === 'create') {
      reset()
      return
    }
    if (!landlordId) return
    let cancelled = false
    setLoadingDetail(true)
    ;(async () => {
      try {
        const { data } = await api.get<LandlordDetail>(`/aquaculture/landlords/${landlordId}/`)
        if (!cancelled) setValues(formValuesFromDetail(data))
      } catch (e) {
        if (!cancelled) {
          toast.error(extractErrorMessage(e, 'Could not load landlord'))
          onClose()
        }
      } finally {
        if (!cancelled) setLoadingDetail(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, mode, landlordId, reset, toast, onClose])

  const handleClose = () => {
    if (saving) return
    onClose()
    reset()
  }

  const submit = async () => {
    const { payload, error } = buildLandlordPayload(values, mode)
    if (error || !payload) {
      toast.error(error || 'Invalid form')
      return
    }
    setSaving(true)
    try {
      if (mode === 'create') {
        const { data } = await api.post<LandlordDetail>('/aquaculture/landlords/', payload)
        toast.success('Landlord created')
        onSuccess(data.id)
        handleClose()
      } else if (landlordId) {
        await api.patch(`/aquaculture/landlords/${landlordId}/`, payload)
        toast.success('Landlord saved')
        onSuccess(landlordId)
        handleClose()
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, mode === 'create' ? 'Could not create' : 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const title = mode === 'create' ? 'New landlord' : 'Edit landlord'
  const subtitle =
    mode === 'create'
      ? 'Profile, pond land shares, and opening balance in one step.'
      : 'Update contact details, pond shares, and opening balance (when not locked).'

  return (
    <div
      className={MODAL_BACKDROP}
      role="dialog"
      aria-modal="true"
      aria-labelledby="landlord-form-title"
    >
      <div className={MODAL_FORM_PANEL}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="landlord-form-title" className="text-lg font-semibold text-foreground">
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {loadingDetail ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <section className="rounded-xl border border-border bg-white">
                <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
                  <User className="h-4 w-4 text-primary" aria-hidden />
                  <h3 className="text-sm font-semibold text-foreground">Profile</h3>
                </div>
                <div className="space-y-4 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-foreground/85 sm:col-span-2">
                      Name <span className="text-destructive">*</span>
                      <input
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        value={values.name}
                        onChange={(e) => setField('name', e.target.value)}
                        placeholder="e.g. Md. Rahman"
                        autoFocus
                      />
                    </label>
                    <label className="block text-sm font-medium text-foreground/85">
                      Code
                      <input
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 font-mono text-sm"
                        value={values.code}
                        onChange={(e) => setField('code', e.target.value)}
                        placeholder={mode === 'create' ? 'Auto LL-0001 if empty' : 'e.g. LL-0001'}
                      />
                    </label>
                    <label className="block text-sm font-medium text-foreground/85">
                      Phone
                      <input
                        type="tel"
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        value={values.phone}
                        onChange={(e) => setField('phone', e.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-medium text-foreground/85 sm:col-span-2">
                      Email
                      <input
                        type="email"
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        value={values.email}
                        onChange={(e) => setField('email', e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="block text-sm font-medium text-foreground/85">
                    Notes
                    <textarea
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      rows={2}
                      value={values.notes}
                      onChange={(e) => setField('notes', e.target.value)}
                    />
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground/85">
                    <input
                      type="checkbox"
                      checked={values.isActive}
                      onChange={(e) => setField('isActive', e.target.checked)}
                      className="rounded border-border"
                    />
                    Active landlord
                  </label>
                </div>
              </section>

              <section className="mt-4 rounded-xl border border-border bg-white">
                <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
                  <Droplets className="h-4 w-4 text-primary" aria-hidden />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Land by pond</h3>
                    <p className="text-xs text-muted-foreground">Optional — leased land decimals per pond.</p>
                  </div>
                </div>
                <div className="space-y-2 p-4">
                  {values.shareDrafts.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">
                      No pond shares yet.
                    </p>
                  ) : (
                    values.shareDrafts.map((row, idx) => {
                      const pondSel = ponds.find((p) => String(p.id) === row.pond_id)
                      const implied = impliedAnnualFromPondRow(row.land_area_decimal, pondSel)
                      return (
                        <div
                          key={idx}
                          className="flex flex-wrap items-end gap-2 rounded-lg border border-border/70 bg-muted/50 p-3"
                        >
                          <label className="min-w-[140px] flex-1 text-xs font-medium text-foreground/85">
                            Pond
                            <select
                              className="mt-1 w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
                              value={row.pond_id}
                              onChange={(e) => {
                                const v = e.target.value
                                setField(
                                  'shareDrafts',
                                  values.shareDrafts.map((r, i) => (i === idx ? { ...r, pond_id: v } : r)),
                                )
                              }}
                            >
                              <option value="">Select pond…</option>
                              {ponds.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name || `Pond #${p.id}`}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="w-28 text-xs font-medium text-foreground/85">
                            Land (dec)
                            <input
                              inputMode="decimal"
                              className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-sm tabular-nums"
                              value={row.land_area_decimal}
                              onChange={(e) => {
                                const v = e.target.value
                                setField(
                                  'shareDrafts',
                                  values.shareDrafts.map((r, i) =>
                                    i === idx ? { ...r, land_area_decimal: v } : r,
                                  ),
                                )
                              }}
                            />
                          </label>
                          <div className="w-32 text-xs font-medium text-foreground/85">
                            <span className="block">Est. annual</span>
                            <div className="mt-1 rounded-lg border border-dashed border-border bg-white px-2 py-1.5 text-sm tabular-nums">
                              {implied != null ? (
                                <>
                                  {sym}
                                  {formatNumber(Number(implied), 2)}
                                </>
                              ) : (
                                '—'
                              )}
                            </div>
                          </div>
                          <label className="min-w-[100px] flex-1 text-xs font-medium text-foreground/85">
                            Notes
                            <input
                              className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-sm"
                              value={row.notes}
                              onChange={(e) => {
                                const v = e.target.value
                                setField(
                                  'shareDrafts',
                                  values.shareDrafts.map((r, i) => (i === idx ? { ...r, notes: v } : r)),
                                )
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-medium text-foreground/85 hover:bg-muted/40"
                            onClick={() =>
                              setField(
                                'shareDrafts',
                                values.shareDrafts.filter((_, i) => i !== idx),
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      )
                    })
                  )}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-teal-950"
                    onClick={() => setField('shareDrafts', [...values.shareDrafts, emptyShareDraft()])}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    Add pond share
                  </button>
                </div>
              </section>

              <section className="mt-4 rounded-xl border border-border bg-muted/40/60">
                <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
                  <Landmark className="h-4 w-4 text-primary" aria-hidden />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Opening balance</h3>
                    <p className="text-xs text-muted-foreground">Optional subledger starting position.</p>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  {values.openingLocked ? (
                    <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                      Opening balance is locked after other ledger activity or after it is posted to the general
                      ledger.
                    </p>
                  ) : (
                    <div className="rounded-lg border border-border bg-white p-3 text-xs leading-relaxed text-muted-foreground">
                      <p>
                        <span className="font-medium text-foreground">Positive</span> — rent owed to landlord (we owe).
                      </p>
                      <p className="mt-1">
                        <span className="font-medium text-foreground">Negative</span> — credit or prepaid.
                      </p>
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-foreground/85">
                      Amount ({sym})
                      <input
                        type="number"
                        step="0.01"
                        disabled={values.openingLocked}
                        className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm tabular-nums disabled:bg-muted"
                        value={values.openingBalance}
                        onChange={(e) => setField('openingBalance', e.target.value)}
                        placeholder="0"
                      />
                    </label>
                    <label className="block text-sm font-medium text-foreground/85">
                      As of date
                      <input
                        type="date"
                        disabled={values.openingLocked}
                        className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm disabled:bg-muted"
                        value={values.openingBalanceDate}
                        onChange={(e) => setField('openingBalanceDate', e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </section>
            </div>

            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-muted/50 px-5 py-4">
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : mode === 'create' ? 'Create landlord' : 'Save changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
