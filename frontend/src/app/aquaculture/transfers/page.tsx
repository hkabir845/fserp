'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Plus, RefreshCw, Trash2, ArrowRightLeft } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'

interface Pond {
  id: number
  name: string
  pond_role?: string
  pond_role_label?: string
}

interface CycleRow {
  id: number
  name: string
  pond_id: number
}

interface TransferLine {
  id: number
  to_pond_id: number
  to_pond_name: string
  to_production_cycle_id: number | null
  to_production_cycle_name: string
  weight_kg: string
  fish_count: number | null
  pcs_per_kg: string | null
  cost_amount: string
}

interface TransferRow {
  id: number
  from_pond_id: number
  from_pond_name: string
  from_production_cycle_id: number | null
  from_production_cycle_name: string
  transfer_date: string
  fish_species: string
  fish_species_label: string
  memo: string
  lines: TransferLine[]
}

type LineDraft = {
  to_pond_id: string
  to_production_cycle_id: string
  weight_kg: string
  fish_count: string
  pcs_per_kg: string
  cost_amount: string
}

const emptyLine = (): LineDraft => ({
  to_pond_id: '',
  to_production_cycle_id: '',
  weight_kg: '',
  fish_count: '',
  pcs_per_kg: '',
  cost_amount: '',
})

export default function AquacultureFishTransfersPage() {
  const toast = useToast()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [species, setSpecies] = useState<{ id: string; label: string }[]>([])
  const [helpNote, setHelpNote] = useState('')
  const [rows, setRows] = useState<TransferRow[]>([])
  const [loading, setLoading] = useState(true)
  const [currency, setCurrency] = useState('BDT')
  const [modal, setModal] = useState(false)
  const [fromPondId, setFromPondId] = useState('')
  const [fromCycleId, setFromCycleId] = useState('')
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [fishSpecies, setFishSpecies] = useState('tilapia')
  const [memo, setMemo] = useState('')
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([emptyLine()])

  const loadPonds = useCallback(async () => {
    try {
      const [coRes, pondsRes] = await Promise.all([
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<Pond[]>('/aquaculture/ponds/'),
      ])
      setCurrency(String(coRes.data?.currency || 'BDT').slice(0, 3))
      setPonds(Array.isArray(pondsRes.data) ? pondsRes.data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds'))
    }
  }, [toast])

  const loadCycles = useCallback(async () => {
    try {
      const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/')
      setCycles(Array.isArray(data) ? data : [])
    } catch {
      setCycles([])
    }
  }, [])

  const loadSpecies = useCallback(async () => {
    try {
      const { data } = await api.get<{ id: string; label: string }[]>('/aquaculture/fish-species/')
      setSpecies(Array.isArray(data) ? data : [])
    } catch {
      setSpecies([{ id: 'tilapia', label: 'Tilapia' }])
    }
  }, [])

  const loadTransfers = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<{ inter_pond_fish_transfer_note?: string; transfers: TransferRow[] }>(
        '/aquaculture/fish-pond-transfers/'
      )
      if (data?.inter_pond_fish_transfer_note) setHelpNote(data.inter_pond_fish_transfer_note)
      setRows(Array.isArray(data?.transfers) ? data.transfers : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load transfers'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadPonds()
    void loadCycles()
    void loadSpecies()
  }, [loadPonds, loadCycles, loadSpecies])

  useEffect(() => {
    void loadTransfers()
  }, [loadTransfers])

  const cyclesForPond = useCallback(
    (pondIdStr: string) => {
      const pid = parseInt(pondIdStr, 10)
      if (!Number.isFinite(pid)) return []
      return cycles.filter((c) => c.pond_id === pid)
    },
    [cycles]
  )

  const openNew = () => {
    const first = ponds[0]
    setFromPondId(first ? String(first.id) : '')
    setFromCycleId('')
    setTransferDate(new Date().toISOString().slice(0, 10))
    setFishSpecies('tilapia')
    setMemo('')
    setLineDrafts([emptyLine()])
    setModal(true)
  }

  const submit = async () => {
    const fp = parseInt(fromPondId, 10)
    if (!Number.isFinite(fp)) {
      toast.error('Select source pond')
      return
    }
    const linesPayload: Record<string, unknown>[] = []
    for (let i = 0; i < lineDrafts.length; i++) {
      const ln = lineDrafts[i]
      const tp = parseInt(ln.to_pond_id, 10)
      if (!Number.isFinite(tp)) {
        toast.error(`Line ${i + 1}: select destination pond`)
        return
      }
      if (tp === fp) {
        toast.error(`Line ${i + 1}: destination must differ from source pond`)
        return
      }
      const w = Number(ln.weight_kg)
      if (!Number.isFinite(w) || w <= 0) {
        toast.error(`Line ${i + 1}: weight (kg) must be greater than zero`)
        return
      }
      const row: Record<string, unknown> = {
        to_pond_id: tp,
        weight_kg: w,
        cost_amount: ln.cost_amount.trim() === '' ? '0' : ln.cost_amount.trim(),
      }
      if (ln.to_production_cycle_id.trim() !== '') {
        const cy = parseInt(ln.to_production_cycle_id, 10)
        if (!Number.isFinite(cy)) {
          toast.error(`Line ${i + 1}: invalid production cycle`)
          return
        }
        row.to_production_cycle_id = cy
      }
      if (ln.fish_count.trim() !== '') {
        const fc = parseInt(ln.fish_count, 10)
        if (!Number.isFinite(fc) || fc < 0) {
          toast.error(`Line ${i + 1}: invalid fish count`)
          return
        }
        row.fish_count = fc
      }
      if (ln.pcs_per_kg.trim() !== '') {
        const pcs = Number(ln.pcs_per_kg)
        if (!Number.isFinite(pcs) || pcs < 0) {
          toast.error(`Line ${i + 1}: invalid pcs/kg`)
          return
        }
        row.pcs_per_kg = pcs
      }
      linesPayload.push(row)
    }
    const body: Record<string, unknown> = {
      from_pond_id: fp,
      transfer_date: transferDate,
      fish_species: fishSpecies,
      memo: memo.trim(),
      lines: linesPayload,
    }
    if (fromCycleId.trim() !== '') {
      const fcy = parseInt(fromCycleId, 10)
      if (!Number.isFinite(fcy)) {
        toast.error('Invalid source production cycle')
        return
      }
      body.from_production_cycle_id = fcy
    }
    try {
      await api.post('/aquaculture/fish-pond-transfers/', body)
      toast.success('Transfer recorded')
      setModal(false)
      void loadTransfers()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    }
  }

  const remove = async (t: TransferRow) => {
    if (!window.confirm('Delete this fish transfer record? P&L will be recalculated for the period.')) return
    try {
      await api.delete(`/aquaculture/fish-pond-transfers/${t.id}/`)
      toast.success('Deleted')
      void loadTransfers()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  const totalKg = useMemo(
    () =>
      rows.reduce(
        (acc, t) => acc + t.lines.reduce((a, l) => a + (Number.parseFloat(l.weight_kg) || 0), 0),
        0
      ),
    [rows]
  )

  const sym = getCurrencySymbol(currency)

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href="/aquaculture"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:text-teal-950"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Dashboard
          </Link>
          <h1 id="aq-transfers-title" className="text-xl font-bold tracking-tight text-slate-900">
            Fish pond transfers
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            Move nursing or holding fish to grow-out ponds by weight. Optional <strong>cost per line</strong> reallocates
            biological cost on the management P&amp;L (source pond decreases, receivers increase; company total unchanged).
            Stock feed and medicine still flow through{' '}
            <Link href="/aquaculture/expenses" className="font-medium text-teal-800 underline decoration-teal-600/40">
              expenses
            </Link>{' '}
            or POS on account.
          </p>
          {helpNote ? (
            <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
              {helpNote}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadTransfers()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={loading || ponds.length === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Record transfer
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : ponds.length === 0 ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-950">
          <p className="font-medium">Add ponds first</p>
          <Link href="/aquaculture/ponds" className="mt-2 inline-block font-medium text-teal-800 underline">
            Go to Ponds
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs text-slate-500">
            Total transferred weight in list: <span className="font-medium tabular-nums text-slate-800">{formatNumber(totalKg, 2)} kg</span>
          </p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">From → To</th>
                  <th className="px-4 py-3">Species</th>
                  <th className="px-4 py-3 text-right">Kg</th>
                  <th className="px-4 py-3 text-right">Cost moved</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      No transfers yet. Example: 500k tilapia fry at 3000 pcs/kg — log fry purchase on the nursing pond,
                      then after nursing (~70 pcs/kg) record one transfer with multiple lines (grow-out ponds + optional
                      remainder on nursing) and allocate cost from fry + nursing opex.
                    </td>
                  </tr>
                ) : (
                  rows.map((t) => {
                    const kg = t.lines.reduce((a, l) => a + (Number.parseFloat(l.weight_kg) || 0), 0)
                    const cost = t.lines.reduce((a, l) => a + (Number.parseFloat(l.cost_amount) || 0), 0)
                    const dest = t.lines.map((l) => `${l.to_pond_name} (${l.weight_kg} kg)`).join('; ')
                    return (
                      <tr key={t.id} className="align-top text-slate-800">
                        <td className="px-4 py-3 whitespace-nowrap">{formatDateOnly(t.transfer_date)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-1.5 font-medium text-slate-900">
                            <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden />
                            <span>
                              {t.from_pond_name}
                              {t.from_production_cycle_name ? (
                                <span className="font-normal text-slate-500"> ({t.from_production_cycle_name})</span>
                              ) : null}
                            </span>
                          </div>
                          <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-600">{dest}</p>
                          {t.memo?.trim() ? <p className="mt-1 text-xs text-slate-500">{t.memo.trim()}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{t.fish_species_label || t.fish_species}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNumber(kg, 2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {cost > 0 ? `${sym}${formatNumber(cost, 2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void remove(t)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-rose-700 hover:bg-rose-50"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Record fish pond transfer</h2>
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  From pond (source)
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={fromPondId}
                    onChange={(e) => {
                      setFromPondId(e.target.value)
                      setFromCycleId('')
                    }}
                  >
                    <option value="">—</option>
                    {ponds.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.pond_role === 'nursing' ? ' (nursing)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Transfer date
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={transferDate}
                    onChange={(e) => setTransferDate(e.target.value)}
                  />
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Source production cycle (optional)
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={fromCycleId}
                  onChange={(e) => setFromCycleId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {cyclesForPond(fromPondId).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Species
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={fishSpecies}
                  onChange={(e) => setFishSpecies(e.target.value)}
                >
                  {species.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Destination lines</span>
                  <button
                    type="button"
                    className="text-sm font-medium text-teal-800 hover:underline"
                    onClick={() => setLineDrafts((d) => [...d, emptyLine()])}
                  >
                    + Add line
                  </button>
                </div>
                <div className="mt-2 space-y-3">
                  {lineDrafts.map((ln, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Line {idx + 1}</span>
                        {lineDrafts.length > 1 ? (
                          <button
                            type="button"
                            className="text-xs text-rose-700 hover:underline"
                            onClick={() => setLineDrafts((d) => d.filter((_, i) => i !== idx))}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-xs text-slate-600">
                          To pond
                          <select
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                            value={ln.to_pond_id}
                            onChange={(e) => {
                              const v = e.target.value
                              setLineDrafts((d) =>
                                d.map((row, i) => (i === idx ? { ...row, to_pond_id: v, to_production_cycle_id: '' } : row))
                              )
                            }}
                          >
                            <option value="">—</option>
                            {ponds
                              .filter((p) => String(p.id) !== fromPondId)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="text-xs text-slate-600">
                          To cycle (optional)
                          <select
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                            value={ln.to_production_cycle_id}
                            onChange={(e) => {
                              const v = e.target.value
                              setLineDrafts((d) => d.map((row, i) => (i === idx ? { ...row, to_production_cycle_id: v } : row)))
                            }}
                          >
                            <option value="">—</option>
                            {cyclesForPond(ln.to_pond_id).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-slate-600">
                          Weight (kg)
                          <input
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="decimal"
                            placeholder="e.g. 2142.9"
                            value={ln.weight_kg}
                            onChange={(e) =>
                              setLineDrafts((d) => d.map((row, i) => (i === idx ? { ...row, weight_kg: e.target.value } : row)))
                            }
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Cost amount (optional)
                          <input
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="decimal"
                            placeholder="0 = qty only"
                            value={ln.cost_amount}
                            onChange={(e) =>
                              setLineDrafts((d) => d.map((row, i) => (i === idx ? { ...row, cost_amount: e.target.value } : row)))
                            }
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Fish count (optional)
                          <input
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="numeric"
                            value={ln.fish_count}
                            onChange={(e) =>
                              setLineDrafts((d) => d.map((row, i) => (i === idx ? { ...row, fish_count: e.target.value } : row)))
                            }
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Pcs/kg at transfer (optional)
                          <input
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="decimal"
                            placeholder="e.g. 70"
                            value={ln.pcs_per_kg}
                            onChange={(e) =>
                              setLineDrafts((d) => d.map((row, i) => (i === idx ? { ...row, pcs_per_kg: e.target.value } : row)))
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Memo
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="e.g. Post-nursing split batch 2026-A"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => setModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
                onClick={() => void submit()}
              >
                Save transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
