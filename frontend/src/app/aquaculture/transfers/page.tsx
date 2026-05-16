'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Plus, RefreshCw, Trash2, ArrowRightLeft, Pencil } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { formatNumber, getCurrencySymbol, roundToDecimals } from '@/utils/currency'
import { roundCountInputString, roundDecimalInputString } from '@/utils/inputDecimals'

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
  start_date?: string
  end_date?: string | null
}

interface PlCostPerKgBlock {
  total_cost_per_kg?: string | null
  transfer_cost_per_kg?: string | null
  transfer_cost_basis_note?: string | null
  basis_note?: string
}

interface PlPondRowBrief {
  pond_id: number
  cost_per_kg?: PlCostPerKgBlock
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
  fish_species_other?: string
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

/** Format kg for the weight input (exactly 2 decimal places). */
function formatWeightKgFromCalc(w: number): string {
  if (!Number.isFinite(w) || w <= 0) return ''
  return roundDecimalInputString(String(w), 2)
}

/** Cost input string from kg × P&L total cost/kg (2 dp, no thousands sep). */
function formatCostFromPerKg(weightKg: number, perKg: number): string {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || !Number.isFinite(perKg) || perKg < 0) return ''
  const v = Math.round(weightKg * perKg * 100) / 100
  if (!Number.isFinite(v) || v <= 0) return ''
  return v.toFixed(2)
}

/** P&L window for transfer: cycle start → min(transfer date, cycle end); else calendar YTD through transfer date. */
function plWindowForTransferDate(
  transferDateIso: string,
  cycle: CycleRow | undefined,
): { start_date: string; end_date: string } {
  const td = transferDateIso.slice(0, 10)
  if (cycle?.start_date) {
    let start = cycle.start_date.slice(0, 10)
    let end = td
    const cEnd = cycle.end_date ? cycle.end_date.slice(0, 10) : null
    if (cEnd && cEnd < end) end = cEnd
    if (start > end) start = end
    return { start_date: start, end_date: end }
  }
  const y = td.slice(0, 4)
  return { start_date: `${y}-01-01`, end_date: td }
}

/**
 * Keeps fish count, weight (kg), and pcs/kg in sync when two of the three are known.
 * - fish + pcs/kg → weight
 * - weight + pcs/kg → fish (rounded heads)
 * - pcs/kg change: if heads are filled, derive weight; else derive heads from weight.
 */
function recalcTransferLine(ln: LineDraft, source: 'fish' | 'weight' | 'pcs'): LineDraft {
  const pcsRaw = String(ln.pcs_per_kg).trim()
  const pcs = Number(pcsRaw)
  const pcsOk = Number.isFinite(pcs) && pcs > 0

  if (source === 'fish') {
    if (!pcsOk) return ln
    const fc = parseInt(String(ln.fish_count).trim(), 10)
    if (!Number.isFinite(fc) || fc <= 0) return ln
    return { ...ln, weight_kg: formatWeightKgFromCalc(fc / pcs) }
  }

  if (source === 'weight') {
    if (!pcsOk) return ln
    const w = Number(String(ln.weight_kg).trim())
    if (!Number.isFinite(w) || w <= 0) return ln
    const heads = Math.max(1, Math.round(w * pcs))
    return { ...ln, fish_count: String(heads) }
  }

  // pcs/kg edited
  const fc = parseInt(String(ln.fish_count).trim(), 10)
  const hasFish = Number.isFinite(fc) && fc > 0
  if (hasFish && pcsOk) {
    return { ...ln, weight_kg: formatWeightKgFromCalc(fc / pcs) }
  }
  const w = Number(String(ln.weight_kg).trim())
  const hasW = Number.isFinite(w) && w > 0
  if (hasW && pcsOk) {
    const heads = Math.max(1, Math.round(w * pcs))
    return { ...ln, fish_count: String(heads) }
  }
  return ln
}

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
  const [editingId, setEditingId] = useState<number | null>(null)
  const [fromPondId, setFromPondId] = useState('')
  const [fromCycleId, setFromCycleId] = useState('')
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [fishSpecies, setFishSpecies] = useState('tilapia')
  const [fishSpeciesOther, setFishSpeciesOther] = useState('')
  const [memo, setMemo] = useState('')
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([emptyLine()])
  const [transferPlCostPerKg, setTransferPlCostPerKg] = useState<number | null>(null)
  const [transferPlCostLoading, setTransferPlCostLoading] = useState(false)
  const [transferPlBasisHint, setTransferPlBasisHint] = useState('')
  const transferPlCostPerKgRef = useRef<number | null>(null)
  const skipAutoCostLine = useRef<Set<number>>(new Set())

  useEffect(() => {
    transferPlCostPerKgRef.current = transferPlCostPerKg
  }, [transferPlCostPerKg])

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

  const selectedFromCycle = useMemo(() => {
    if (!fromCycleId.trim()) return undefined
    const id = parseInt(fromCycleId, 10)
    if (!Number.isFinite(id)) return undefined
    return cycles.find((c) => c.id === id)
  }, [cycles, fromCycleId])

  useEffect(() => {
    if (!modal) {
      setTransferPlCostPerKg(null)
      setTransferPlBasisHint('')
      setTransferPlCostLoading(false)
      return
    }
    const fp = parseInt(fromPondId, 10)
    if (!Number.isFinite(fp)) {
      setTransferPlCostPerKg(null)
      setTransferPlBasisHint('')
      return
    }
    const { start_date, end_date } = plWindowForTransferDate(transferDate, selectedFromCycle)
    let cancelled = false
    setTransferPlCostPerKg(null)
    setTransferPlBasisHint('')
    setTransferPlCostLoading(true)
    const params: Record<string, string> = {
      start_date,
      end_date,
      pond_id: String(fp),
    }
    if (fromCycleId.trim() && selectedFromCycle && selectedFromCycle.pond_id === fp) {
      params.cycle_id = fromCycleId.trim()
    }
    void (async () => {
      try {
        const { data } = await api.get<{ ponds: PlPondRowBrief[] }>('/aquaculture/pl-summary/', { params })
        if (cancelled) return
        const row = Array.isArray(data?.ponds) ? data.ponds[0] : undefined
        const cpk = row?.cost_per_kg
        const raw =
          cpk?.transfer_cost_per_kg != null && String(cpk.transfer_cost_per_kg).trim() !== ''
            ? cpk.transfer_cost_per_kg
            : cpk?.total_cost_per_kg
        const n = raw != null && String(raw).trim() !== '' ? Number(raw) : NaN
        const hintParts = [
          (cpk?.transfer_cost_basis_note || '').trim(),
          (cpk?.basis_note || '').trim(),
        ].filter(Boolean)
        if (Number.isFinite(n) && n >= 0) {
          setTransferPlCostPerKg(n)
          setTransferPlBasisHint(hintParts.join(' '))
        } else {
          setTransferPlCostPerKg(null)
          setTransferPlBasisHint(hintParts.join(' '))
        }
      } catch {
        if (!cancelled) {
          setTransferPlCostPerKg(null)
          setTransferPlBasisHint('')
        }
      } finally {
        if (!cancelled) setTransferPlCostLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [modal, fromPondId, fromCycleId, transferDate, selectedFromCycle])

  const applyPlCostToDraftLines = useCallback(
    (drafts: LineDraft[], opts?: { force?: boolean }) => {
      const pk = transferPlCostPerKgRef.current
      if (pk == null) return drafts
      const force = Boolean(opts?.force)
      return drafts.map((ln, i) => {
        if (!force && skipAutoCostLine.current.has(i)) return ln
        const w = Number(String(ln.weight_kg).trim())
        if (!Number.isFinite(w) || w <= 0) return ln
        const c = formatCostFromPerKg(w, pk)
        return c ? { ...ln, cost_amount: c } : ln
      })
    },
    [],
  )

  useEffect(() => {
    if (!modal || transferPlCostPerKg == null) return
    setLineDrafts((d) => applyPlCostToDraftLines(d))
  }, [modal, transferPlCostPerKg, applyPlCostToDraftLines])

  const adjustSkipAutoCostAfterRemoveLine = (removedIndex: number) => {
    const next = new Set<number>()
    skipAutoCostLine.current.forEach((j) => {
      if (j < removedIndex) next.add(j)
      else if (j > removedIndex) next.add(j - 1)
    })
    skipAutoCostLine.current = next
  }

  const cyclesForPond = useCallback(
    (pondIdStr: string) => {
      const pid = parseInt(pondIdStr, 10)
      if (!Number.isFinite(pid)) return []
      return cycles.filter((c) => c.pond_id === pid)
    },
    [cycles]
  )

  const closeModal = () => {
    setModal(false)
    setEditingId(null)
  }

  const openNew = () => {
    const nursing = ponds.find((p) => p.pond_role === 'nursing')
    const fromP = nursing ?? ponds[0]
    const growOut = ponds.find(
      (p) => p.pond_role === 'grow_out' && fromP && p.id !== fromP.id
    )
    setEditingId(null)
    skipAutoCostLine.current = new Set()
    setFromPondId(fromP ? String(fromP.id) : '')
    setFromCycleId('')
    setTransferDate(new Date().toISOString().slice(0, 10))
    setFishSpecies('tilapia')
    setFishSpeciesOther('')
    setMemo('')
    setLineDrafts([
      {
        ...emptyLine(),
        to_pond_id: growOut ? String(growOut.id) : '',
      },
    ])
    setModal(true)
  }

  const openEdit = (t: TransferRow) => {
    setEditingId(t.id)
    skipAutoCostLine.current = new Set()
    setFromPondId(String(t.from_pond_id))
    setFromCycleId(t.from_production_cycle_id != null ? String(t.from_production_cycle_id) : '')
    setTransferDate(t.transfer_date.slice(0, 10))
    setFishSpecies(t.fish_species || 'tilapia')
    setFishSpeciesOther((t.fish_species_other || '').trim())
    setMemo(t.memo || '')
    const mapped =
      t.lines.length > 0
        ? t.lines.map((l) => ({
            to_pond_id: String(l.to_pond_id),
            to_production_cycle_id: l.to_production_cycle_id != null ? String(l.to_production_cycle_id) : '',
            weight_kg: (() => {
              const s = String(l.weight_kg ?? '').trim()
              return s === '' ? '' : roundDecimalInputString(s, 2)
            })(),
            fish_count: (() => {
              const s = l.fish_count != null ? String(l.fish_count) : ''
              return s === '' ? '' : roundCountInputString(s)
            })(),
            pcs_per_kg: (() => {
              const s = l.pcs_per_kg != null && String(l.pcs_per_kg) !== '' ? String(l.pcs_per_kg) : ''
              return s === '' ? '' : roundDecimalInputString(s, 2)
            })(),
            cost_amount: (() => {
              const s = String(l.cost_amount ?? '').trim()
              if (s === '' || s === '0' || Number.parseFloat(s) === 0) return ''
              return roundDecimalInputString(s, 2)
            })(),
          }))
        : [emptyLine()]
    mapped.forEach((ln, i) => {
      if (ln.cost_amount.trim() !== '') skipAutoCostLine.current.add(i)
    })
    setLineDrafts(mapped)
    setModal(true)
  }

  const submit = async () => {
    const fp = parseInt(fromPondId, 10)
    if (!Number.isFinite(fp)) {
      toast.error('Select source pond')
      return
    }
    if (fishSpecies === 'other' && !fishSpeciesOther.trim()) {
      toast.error('Enter a species description when species is “Other”')
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
      const w = roundToDecimals(String(ln.weight_kg).trim().replace(/,/g, ''), 2)
      if (!Number.isFinite(w) || w <= 0) {
        toast.error(`Line ${i + 1}: weight (kg) must be greater than zero`)
        return
      }
      if (ln.fish_count.trim() === '') {
        toast.error(`Line ${i + 1}: fish count (heads) is required`)
        return
      }
      const fc = parseInt(ln.fish_count, 10)
      if (!Number.isFinite(fc) || fc <= 0) {
        toast.error(`Line ${i + 1}: fish count must be a positive integer`)
        return
      }
      let costOut = '0'
      if (ln.cost_amount.trim() !== '') {
        const n = Number(ln.cost_amount.trim().replace(/,/g, ''))
        if (!Number.isFinite(n) || n < 0) {
          toast.error(`Line ${i + 1}: cost amount must be a valid non-negative number`)
          return
        }
        costOut = n.toFixed(2)
      } else {
        const pk = transferPlCostPerKgRef.current
        if (pk != null && pk > 0) {
          const auto = formatCostFromPerKg(w, pk)
          if (auto) costOut = auto
        }
      }
      const row: Record<string, unknown> = {
        to_pond_id: tp,
        weight_kg: w,
        fish_count: fc,
        cost_amount: costOut,
      }
      if (ln.to_production_cycle_id.trim() !== '') {
        const cy = parseInt(ln.to_production_cycle_id, 10)
        if (!Number.isFinite(cy)) {
          toast.error(`Line ${i + 1}: invalid production cycle`)
          return
        }
        row.to_production_cycle_id = cy
      }
      if (ln.pcs_per_kg.trim() !== '') {
        const pcs = roundToDecimals(ln.pcs_per_kg.trim().replace(/,/g, ''), 2)
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
      fish_species_other: fishSpecies === 'other' ? fishSpeciesOther.trim() : '',
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
      if (editingId != null) {
        await api.put(`/aquaculture/fish-pond-transfers/${editingId}/`, body)
        toast.success('Transfer updated')
      } else {
        await api.post('/aquaculture/fish-pond-transfers/', body)
        toast.success('Transfer recorded')
      }
      closeModal()
      void loadTransfers()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    }
  }

  const remove = async (t: TransferRow) => {
    if (
      !window.confirm(
        'Remove this fish transfer? Pond stock and management P&L will be recalculated as if it never happened (same as rolling back the transfer).'
      )
    )
      return
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

  const totalFish = useMemo(
    () =>
      rows.reduce(
        (acc, t) => acc + t.lines.reduce((a, l) => a + (l.fish_count != null ? Number(l.fish_count) : 0), 0),
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
            Move nursing or holding fish to grow-out ponds: each line records <strong>kg and head count</strong>{' '}
            (both required). Optional <strong>cost per line</strong> reallocates biological cost on the management P&amp;L
            (source pond decreases, receivers increase; company total unchanged). Stock feed and medicine still flow
            through{' '}
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
            Total in list:{' '}
            <span className="font-medium tabular-nums text-slate-800">{formatNumber(totalKg, 2)} kg</span>
            {totalFish > 0 ? (
              <>
                {' '}
                ·{' '}
                <span className="font-medium tabular-nums text-slate-800">{formatNumber(totalFish, 0)}</span> head
              </>
            ) : null}
          </p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-[780px] w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">From → To</th>
                  <th className="px-4 py-3">Species</th>
                  <th className="px-4 py-3 text-right">Kg</th>
                  <th className="px-4 py-3 text-right">Heads</th>
                  <th className="px-4 py-3 text-right">Cost moved</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      No transfers yet. Example: log fry on a vendor bill (kg + heads), then record a transfer with each
                      line showing destination pond, kg moved, and head count (required). Optional cost per line
                      reallocates nursing biological cost to grow-out ponds.
                    </td>
                  </tr>
                ) : (
                  rows.map((t) => {
                    const kg = t.lines.reduce((a, l) => a + (Number.parseFloat(l.weight_kg) || 0), 0)
                    const heads = t.lines.reduce((a, l) => a + (l.fish_count != null ? Number(l.fish_count) : 0), 0)
                    const cost = t.lines.reduce((a, l) => a + (Number.parseFloat(l.cost_amount) || 0), 0)
                    const dest = t.lines
                      .map((l) => {
                        const h = l.fish_count != null ? `, ${formatNumber(Number(l.fish_count), 0)} head` : ''
                        return `${l.to_pond_name} (${l.weight_kg} kg${h})`
                      })
                      .join('; ')
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
                        <td className="px-4 py-3 text-right tabular-nums">{formatNumber(heads, 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {cost > 0 ? (
                            `${sym}${formatNumber(cost, 2)}`
                          ) : kg > 0 ? (
                            <span className="text-amber-700" title="Edit and save to fill from source pond P&L">
                              Not set
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                openEdit(t)
                              }}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
                              title="Edit transfer"
                              aria-label="Edit transfer"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                void remove(t)
                              }}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-rose-700 hover:bg-rose-50"
                              title="Remove transfer (rollback)"
                              aria-label="Remove transfer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
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
            <h2 className="text-lg font-semibold text-slate-900">
              {editingId != null ? 'Edit fish pond transfer' : 'Record fish pond transfer'}
            </h2>
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
                  onChange={(e) => {
                    const v = e.target.value
                    setFishSpecies(v)
                    if (v !== 'other') setFishSpeciesOther('')
                  }}
                >
                  {species.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {fishSpecies === 'other' ? (
                <label className="block text-sm font-medium text-slate-700">
                  Species description
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={fishSpeciesOther}
                    onChange={(e) => setFishSpeciesOther(e.target.value)}
                    placeholder="e.g. local strain"
                    maxLength={120}
                  />
                </label>
              ) : null}

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700">Destination lines</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={transferPlCostPerKg == null}
                      className="text-sm font-medium text-teal-800 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                      onClick={() => {
                        skipAutoCostLine.current = new Set()
                        setLineDrafts((d) => applyPlCostToDraftLines(d, { force: true }))
                      }}
                    >
                      Fill costs from P&amp;L analysis
                    </button>
                    <button
                      type="button"
                      className="text-sm font-medium text-teal-800 hover:underline"
                      onClick={() => setLineDrafts((d) => [...d, emptyLine()])}
                    >
                      + Add line
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {transferPlCostLoading ? (
                    <span>Loading pond P&amp;L cost/kg for this transfer…</span>
                  ) : transferPlCostPerKg != null ? (
                    <span>
                      Auto cost uses <strong className="font-medium text-slate-800">cost/kg</strong> from the
                      aquaculture P&amp;L for the source pond through this transfer date (harvest kg, or on-hand
                      biological kg when the pond has not harvested yet)
                      {fromCycleId.trim() ? ' (scoped to the source production cycle)' : ' (calendar year to date)'}:{' '}
                      <span className="tabular-nums font-medium text-slate-800">
                        {sym}
                        {formatNumber(transferPlCostPerKg, 2)}/kg
                      </span>
                      . Edit a cost field to keep a custom amount; clear it to allow auto-fill again.
                    </span>
                  ) : (
                    <span>
                      Auto cost/kg is not available for this pond and date range. That usually means{' '}
                      <strong className="font-medium text-slate-800">no pond costs are recorded yet</strong>{' '}
                      (vendor bills, POS on account to the pond customer, payroll split, or pond expenses) and{' '}
                      <strong className="font-medium text-slate-800">no biological kg basis</strong> (harvest/fingerling
                      sales or positive on-hand fish kg from stocking and transfers).{' '}
                      <strong className="font-medium text-slate-800">Sampling does not drive this number</strong> — it is
                      for density advice only. Enter cost manually, or record feed/medicine/fry costs first, then reopen
                      this form.
                    </span>
                  )}
                </p>
                {transferPlBasisHint ? (
                  <p className="mt-1 text-[11px] leading-snug text-slate-500">{transferPlBasisHint}</p>
                ) : null}
                <div className="mt-2 space-y-3">
                  {lineDrafts.map((ln, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Line {idx + 1}</span>
                        {lineDrafts.length > 1 ? (
                          <button
                            type="button"
                            className="text-xs text-rose-700 hover:underline"
                            onClick={() => {
                              adjustSkipAutoCostAfterRemoveLine(idx)
                              setLineDrafts((d) => d.filter((_, i) => i !== idx))
                            }}
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
                          Weight (kg) *
                          <input
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="decimal"
                            placeholder="e.g. 2142.9"
                            value={ln.weight_kg}
                            onChange={(e) => {
                              const weight_kg = e.target.value
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  let next = recalcTransferLine({ ...row, weight_kg }, 'weight')
                                  const pk = transferPlCostPerKgRef.current
                                  if (pk != null && !skipAutoCostLine.current.has(idx)) {
                                    const w = Number(String(next.weight_kg).trim())
                                    if (Number.isFinite(w) && w > 0) {
                                      const c = formatCostFromPerKg(w, pk)
                                      if (c) next = { ...next, cost_amount: c }
                                    }
                                  }
                                  return next
                                })
                              )
                            }}
                            onBlur={() => {
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  const t = row.weight_kg.trim()
                                  if (t === '') return row
                                  const nextW = roundDecimalInputString(row.weight_kg, 2)
                                  let next = { ...row, weight_kg: nextW }
                                  next = recalcTransferLine(next, 'weight')
                                  const pk = transferPlCostPerKgRef.current
                                  if (pk != null && !skipAutoCostLine.current.has(idx)) {
                                    const wn = Number(String(next.weight_kg).trim())
                                    if (Number.isFinite(wn) && wn > 0) {
                                      const c = formatCostFromPerKg(wn, pk)
                                      if (c) next = { ...next, cost_amount: c }
                                    }
                                  }
                                  return next
                                })
                              )
                            }}
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Cost amount (fry/feed/medicine cost/kg × kg)
                          <input
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="decimal"
                            placeholder={transferPlCostPerKg != null ? 'Filled when kg entered' : 'Enter kg first'}
                            value={ln.cost_amount}
                            onChange={(e) => {
                              const v = e.target.value
                              if (v.trim() === '') skipAutoCostLine.current.delete(idx)
                              else skipAutoCostLine.current.add(idx)
                              setLineDrafts((d) => d.map((row, i) => (i === idx ? { ...row, cost_amount: v } : row)))
                            }}
                            onBlur={() => {
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  const t = row.cost_amount.trim()
                                  if (t === '') return row
                                  return { ...row, cost_amount: roundDecimalInputString(row.cost_amount, 2) }
                                })
                              )
                            }}
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Fish count (heads, required)
                          <input
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="numeric"
                            value={ln.fish_count}
                            onChange={(e) => {
                              const fish_count = e.target.value
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  let next = recalcTransferLine({ ...row, fish_count }, 'fish')
                                  const pk = transferPlCostPerKgRef.current
                                  if (pk != null && !skipAutoCostLine.current.has(idx)) {
                                    const w = Number(String(next.weight_kg).trim())
                                    if (Number.isFinite(w) && w > 0) {
                                      const c = formatCostFromPerKg(w, pk)
                                      if (c) next = { ...next, cost_amount: c }
                                    }
                                  }
                                  return next
                                })
                              )
                            }}
                            onBlur={() => {
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  const t = row.fish_count.trim()
                                  if (t === '') return row
                                  let next = { ...row, fish_count: roundCountInputString(row.fish_count) }
                                  next = recalcTransferLine(next, 'fish')
                                  const pk = transferPlCostPerKgRef.current
                                  if (pk != null && !skipAutoCostLine.current.has(idx)) {
                                    const w = Number(String(next.weight_kg).trim())
                                    if (Number.isFinite(w) && w > 0) {
                                      const c = formatCostFromPerKg(w, pk)
                                      if (c) next = { ...next, cost_amount: c }
                                    }
                                  }
                                  return next
                                })
                              )
                            }}
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Pcs/kg at transfer (optional)
                          <input
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="decimal"
                            placeholder="e.g. 70"
                            value={ln.pcs_per_kg}
                            onChange={(e) => {
                              const pcs_per_kg = e.target.value
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  let next = recalcTransferLine({ ...row, pcs_per_kg }, 'pcs')
                                  const pk = transferPlCostPerKgRef.current
                                  if (pk != null && !skipAutoCostLine.current.has(idx)) {
                                    const w = Number(String(next.weight_kg).trim())
                                    if (Number.isFinite(w) && w > 0) {
                                      const c = formatCostFromPerKg(w, pk)
                                      if (c) next = { ...next, cost_amount: c }
                                    }
                                  }
                                  return next
                                })
                              )
                            }}
                            onBlur={() => {
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  const t = row.pcs_per_kg.trim()
                                  if (t === '') return row
                                  let next = { ...row, pcs_per_kg: roundDecimalInputString(row.pcs_per_kg, 2) }
                                  next = recalcTransferLine(next, 'pcs')
                                  const pk = transferPlCostPerKgRef.current
                                  if (pk != null && !skipAutoCostLine.current.has(idx)) {
                                    const w = Number(String(next.weight_kg).trim())
                                    if (Number.isFinite(w) && w > 0) {
                                      const c = formatCostFromPerKg(w, pk)
                                      if (c) next = { ...next, cost_amount: c }
                                    }
                                  }
                                  return next
                                })
                              )
                            }}
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
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
                onClick={() => void submit()}
              >
                {editingId != null ? 'Save changes' : 'Save transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
