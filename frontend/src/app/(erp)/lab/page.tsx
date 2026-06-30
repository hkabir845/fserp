'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Param = {
  id: number
  code: string
  name: string
  unit: string | null
  category: string
  method_family: string | null
}

type Spec = { id: number; name: string; purpose: string; version: string | null }

type Sample = {
  id: number
  sample_number: string
  sample_type: string
  status: string
  overall_compliant: boolean | null
  lab_specification_id: number | null
}

type SampleDetail = {
  id: number
  sample_number: string
  sample_type: string
  status: string
  lot_reference: string | null
  sampling_point: string | null
  lab_specification_id: number | null
  overall_compliant: boolean | null
  results: {
    id: number
    parameter_id: number
    code: string | null
    name: string | null
    unit: string | null
    result_numeric: number | null
    result_text: string | null
    lower_applied: number | null
    upper_applied: number | null
    compliant: boolean | null
    is_critical: boolean
  }[]
}

const PURPOSES = [
  { id: 'supplier_coa', label: 'Supplier COA match', desc: 'Incoming RM vs vendor certificate' },
  { id: 'formulation_release', label: 'Formulation release', desc: 'Finished feed vs label/BOM targets' },
  { id: 'regulatory_grade', label: 'Regulatory / feed grade', desc: 'Legal max (e.g. aflatoxin limits)' },
  { id: 'internal_monitoring', label: 'Internal monitoring', desc: 'Trending & process control' },
]

const SAMPLE_TYPES = [
  'incoming_raw_material',
  'finished_feed',
  'in_process',
  'retention',
  'supplier_verification',
  'complaint_investigation',
]

export default function QualityLabPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'samples' | 'specs' | 'catalog'>('samples')
  const [selSample, setSelSample] = useState<number | null>(null)

  const { data: params = [] } = useQuery({
    queryKey: ['lab-parameters'],
    queryFn: async () => {
      const res = await api.get<Param[]>('/lab/parameters')
      return res.data
    },
    retry: false,
  })

  const { data: specs = [] } = useQuery({
    queryKey: ['lab-specifications'],
    queryFn: async () => {
      const res = await api.get<Spec[]>('/lab/specifications')
      return res.data
    },
    retry: false,
  })

  const { data: samples = [], error } = useQuery({
    queryKey: ['lab-samples'],
    queryFn: async () => {
      const res = await api.get<Sample[]>('/lab/samples')
      return res.data
    },
    retry: false,
  })

  const { data: detail } = useQuery({
    queryKey: ['lab-sample', selSample],
    queryFn: async () => {
      const res = await api.get<SampleDetail>(`/lab/samples/${selSample}`)
      return res.data
    },
    enabled: selSample !== null,
    retry: false,
  })

  const seed = useMutation({
    mutationFn: async () => api.post('/lab/parameters/seed-defaults'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lab-parameters'] }),
  })

  const [specName, setSpecName] = useState('Layer mash 2026 release')
  const [specPurpose, setSpecPurpose] = useState('formulation_release')
  const [specLines, setSpecLines] = useState<
    { parameter_id: number; lower_limit: string; upper_limit: string; is_critical: boolean }[]
  >([])

  const addSpecLine = () => {
    const first = params[0]
    if (!first) return
    setSpecLines((s) => [...s, { parameter_id: first.id, lower_limit: '', upper_limit: '', is_critical: false }])
  }

  const createSpec = useMutation({
    mutationFn: async () => {
      const lines = specLines
        .filter((l) => l.parameter_id)
        .map((l) => ({
          parameter_id: l.parameter_id,
          lower_limit: l.lower_limit ? Number(l.lower_limit) : undefined,
          upper_limit: l.upper_limit ? Number(l.upper_limit) : undefined,
          is_critical: l.is_critical,
        }))
      const res = await api.post('/lab/specifications', {
        name: specName,
        purpose: specPurpose,
        lines,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-specifications'] })
      setSpecLines([])
    },
  })

  const [samType, setSamType] = useState('finished_feed')
  const [samSpec, setSamSpec] = useState<number | ''>('')
  const [samLot, setSamLot] = useState('')

  const createSample = useMutation({
    mutationFn: async () => {
      const res = await api.post('/lab/samples', {
        sample_type: samType,
        lab_specification_id: samSpec === '' ? undefined : samSpec,
        lot_reference: samLot || undefined,
      })
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lab-samples'] }),
  })

  const [resultVals, setResultVals] = useState<Record<number, string>>({})

  const saveResults = useMutation({
    mutationFn: async () => {
      if (selSample === null) return
      const items = Object.entries(resultVals)
        .filter(([, v]) => v.trim() !== '')
        .map(([pid, v]) => ({
          parameter_id: Number(pid),
          result_numeric: Number(v),
        }))
      if (items.length === 0) return
      await api.post(`/lab/samples/${selSample}/results`, items)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-sample', selSample] })
      qc.invalidateQueries({ queryKey: ['lab-samples'] })
    },
  })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await api.patch(`/lab/samples/${id}/status`, {}, { params: { status } })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-samples'] })
      qc.invalidateQueries({ queryKey: ['lab-sample', selSample] })
    },
  })

  useEffect(() => {
    if (!detail?.results) return
    const m: Record<number, string> = {}
    for (const r of detail.results) {
      if (r.result_numeric != null) m[r.parameter_id] = String(r.result_numeric)
    }
    setResultVals(m)
  }, [detail, selSample])

  const byCat = useMemo(() => {
    const m: Record<string, Param[]> = {}
    for (const p of params) {
      m[p.category] = m[p.category] || []
      m[p.category].push(p)
    }
    return m
  }, [params])

  return (
          <div className="min-h-screen bg-gradient-to-b from-muted/40 to-card">
        <div className="border-b border-border/80 bg-white/90 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4 py-8">
            <ReportingHubBreadcrumb current="Lab & QC" className="mb-4" />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">FMERP · Quality</p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Laboratory & feed compliance</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Test incoming ingredients against supplier COA, validate formulations vs targets, and release finished feed
                  with documented limits (proximates, mycotoxins, micro, and physical pellet quality). Aligned with compound
                  feed industry practice: traceable samples, specification-driven OOS checks, and retention-ready records.
                </p>
              </div>
              <button
                type="button"
                onClick={() => seed.mutate()}
                disabled={seed.isPending}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary/90 disabled:opacity-50"
              >
                Load default analyte catalog
              </button>
            </div>
            <div className="mt-6 flex flex-wrap gap-2 border-t border-border/70 pt-4">
              {(['samples', 'specs', 'catalog'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    tab === t ? 'bg-foreground text-white' : 'bg-muted text-foreground/85 hover:bg-muted'
                  }`}
                >
                  {t === 'samples' ? 'Samples & results' : t === 'specs' ? 'Specifications' : 'Analyte catalog'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
          {error ? (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground">
              Select a tenant in the company switcher to use the quality lab.
            </div>
          ) : null}

          {tab === 'catalog' ? (
            <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-foreground">Analyte catalog</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Standard panel includes protein, fat, fiber, ash, moisture, energy, minerals, aflatoxin / Fusarium toxins,
                pellet durability, hardness, and hygiene indicators — extend with your methods (ISO 17025-style method
                references on each result row in the API).
              </p>
              <div className="mt-6 space-y-6">
                {Object.entries(byCat).map(([cat, rows]) => (
                  <div key={cat}>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground/70">{cat}</h3>
                    <div className="mt-2 divide-y divide-border/70 rounded-xl border border-border/70">
                      {rows.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                          <span className="font-mono text-sm text-primary">{p.code}</span>
                          <span className="flex-1 text-sm text-foreground">{p.name}</span>
                          <span className="text-xs text-muted-foreground">{p.unit ?? '—'}</span>
                          <span className="text-xs text-muted-foreground/70">{p.method_family}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {params.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Run &quot;Load default analyte catalog&quot; to populate tests.</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {tab === 'specs' ? (
            <div className="grid gap-6 lg:grid-cols-5">
              <section className="rounded-2xl border border-border bg-white p-6 shadow-sm lg:col-span-2">
                <h2 className="text-lg font-semibold text-foreground">New specification</h2>
                <p className="mt-1 text-sm text-muted-foreground">Define min/max bands per analyte; attach purpose for audits.</p>
                <div className="mt-4 space-y-3">
                  <input
                    className="w-full rounded-xl border border-border px-3 py-2 text-sm"
                    value={specName}
                    onChange={(e) => setSpecName(e.target.value)}
                    placeholder="Name (e.g. Broiler grower release v3)"
                  />
                  <select
                    className="w-full rounded-xl border border-border px-3 py-2 text-sm"
                    value={specPurpose}
                    onChange={(e) => setSpecPurpose(e.target.value)}
                  >
                    {PURPOSES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {specLines.map((ln, idx) => (
                    <div key={idx} className="flex flex-wrap gap-2 rounded-xl bg-muted/40 p-3">
                      <select
                        className="min-w-[140px] flex-1 rounded-lg border px-2 py-1.5 text-sm"
                        value={ln.parameter_id}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setSpecLines((s) => s.map((x, i) => (i === idx ? { ...x, parameter_id: v } : x)))
                        }}
                      >
                        {params.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code}
                          </option>
                        ))}
                      </select>
                      <input
                        className="w-24 rounded-lg border px-2 py-1.5 text-sm"
                        placeholder="Min"
                        value={ln.lower_limit}
                        onChange={(e) =>
                          setSpecLines((s) =>
                            s.map((x, i) => (i === idx ? { ...x, lower_limit: e.target.value } : x)),
                          )
                        }
                      />
                      <input
                        className="w-24 rounded-lg border px-2 py-1.5 text-sm"
                        placeholder="Max"
                        value={ln.upper_limit}
                        onChange={(e) =>
                          setSpecLines((s) =>
                            s.map((x, i) => (i === idx ? { ...x, upper_limit: e.target.value } : x)),
                          )
                        }
                      />
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={ln.is_critical}
                          onChange={(e) =>
                            setSpecLines((s) =>
                              s.map((x, i) => (i === idx ? { ...x, is_critical: e.target.checked } : x)),
                            )
                          }
                        />
                        Critical
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addSpecLine}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    + Add limit line
                  </button>
                  <button
                    type="button"
                    disabled={!specName.trim() || specLines.length === 0 || createSpec.isPending}
                    onClick={() => createSpec.mutate()}
                    className="w-full rounded-xl bg-foreground py-2.5 text-sm font-semibold text-white hover:bg-foreground/90 disabled:opacity-40"
                  >
                    Save specification
                  </button>
                </div>
              </section>
              <section className="rounded-2xl border border-border bg-white p-6 shadow-sm lg:col-span-3">
                <h2 className="text-lg font-semibold text-foreground">Active specifications</h2>
                <ul className="mt-4 space-y-2">
                  {specs.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between rounded-xl border border-border/70 px-4 py-3"
                    >
                      <div>
                        <span className="font-medium text-foreground">{s.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{s.purpose}</span>
                      </div>
                      <span className="text-xs text-muted-foreground/70">v{s.version ?? '—'}</span>
                    </li>
                  ))}
                </ul>
                {specs.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No specs yet.</p> : null}
                <div className="mt-6 border-t border-border/70 pt-4">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    <strong className="text-foreground/85">How professionals use this:</strong> Supplier COA specs are linked to
                    ingredient + supplier; formulation release specs to feed product or BOM; regulatory envelopes for
                    contaminants. Each lab result stores snapshot limits for immutable audit (like batch COA retention).
                  </p>
                </div>
              </section>
            </div>
          ) : null}

          {tab === 'samples' ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-foreground">Register sample</h2>
                <div className="mt-4 space-y-3">
                  <select
                    className="w-full rounded-xl border border-border px-3 py-2 text-sm"
                    value={samType}
                    onChange={(e) => setSamType(e.target.value)}
                  >
                    {SAMPLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <select
                    className="w-full rounded-xl border border-border px-3 py-2 text-sm"
                    value={samSpec === '' ? '' : String(samSpec)}
                    onChange={(e) => setSamSpec(e.target.value ? Number(e.target.value) : '')}
                  >
                    <option value="">Specification (optional for manual review)</option>
                    {specs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="w-full rounded-xl border border-border px-3 py-2 text-sm"
                    placeholder="Lot / batch / GRN reference"
                    value={samLot}
                    onChange={(e) => setSamLot(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => createSample.mutate()}
                    disabled={createSample.isPending}
                    className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90"
                  >
                    Create sample
                  </button>
                </div>
                <ul className="mt-6 max-h-64 space-y-1 overflow-auto border-t border-border/70 pt-4">
                  {samples.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelSample(s.id)}
                        className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted/40 ${
                          selSample === s.id ? 'bg-accent ring-1 ring-indigo-200' : ''
                        }`}
                      >
                        <span className="font-mono text-primary">{s.sample_number}</span>
                        <span className="text-muted-foreground"> · {s.sample_type}</span>
                        <span className="block text-xs text-muted-foreground">
                          {s.status}
                          {s.overall_compliant === true ? ' · ✓ compliant' : ''}
                          {s.overall_compliant === false ? ' · OOS' : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
                {selSample && detail ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="text-lg font-semibold text-foreground">{detail.sample_number}</h2>
                        <p className="text-sm text-muted-foreground">
                          {detail.sample_type} · {detail.lot_reference ?? '—'} · {detail.sampling_point ?? '—'}
                        </p>
                        <p className="mt-2 text-sm">
                          Overall:{' '}
                          <strong>
                            {detail.overall_compliant === true
                              ? 'Pass'
                              : detail.overall_compliant === false
                                ? 'Fail / OOS'
                                : 'Pending'}
                          </strong>
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded-lg bg-foreground px-2 py-1 text-xs text-white"
                          onClick={() => setStatus.mutate({ id: detail.id, status: 'completed' })}
                        >
                          Mark complete
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 space-y-3 border-t border-border/70 pt-4">
                      <h3 className="text-sm font-semibold text-foreground">Enter results</h3>
                      <p className="text-xs text-muted-foreground">
                        Limits apply automatically when a specification is linked. Critical limits block release in regulated
                        workflows (configure lines accordingly).
                      </p>
                      {params.map((p) => {
                        const existing = detail.results.find((r) => r.parameter_id === p.id)
                        const val = resultVals[p.id] ?? (existing?.result_numeric != null ? String(existing.result_numeric) : '')
                        return (
                          <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                            <span className="w-24 font-mono text-xs text-primary">{p.code}</span>
                            <input
                              className="w-28 rounded border px-2 py-1 text-sm"
                              placeholder={p.unit ?? 'value'}
                              value={val}
                              onChange={(e) => setResultVals((m) => ({ ...m, [p.id]: e.target.value }))}
                            />
                            {existing?.lower_applied != null || existing?.upper_applied != null ? (
                              <span className="text-xs text-muted-foreground">
                                [{existing.lower_applied ?? '—'} … {existing.upper_applied ?? '—'}]{' '}
                                {existing.compliant === true ? '✓' : existing.compliant === false ? '✗' : ''}
                              </span>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={saveResults.isPending}
                      onClick={() => saveResults.mutate()}
                      className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      Save results & evaluate compliance
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Select a sample to capture results or create one on the left.</p>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>
  )
}
