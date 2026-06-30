'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { vehicleTypeLabel } from '@/lib/vehicle-types'

type Job = {
  id: number
  job_number: string
  title: string
  job_type: string
  asset_kind: string
  vehicle_id: number | null
  location_zone: string | null
  facility_tag: string | null
  priority: string
  status: string
}

type Employee = { id: number; name: string; employee_code: string | null }
type Vehicle = { id: number; reg_no: string; type: string }

type JobDetail = {
  id: number
  job_number: string
  title: string
  description: string | null
  job_type: string
  asset_kind: string
  vehicle_id: number | null
  vehicle: { id: number; reg_no: string; type: string } | null
  location_zone: string | null
  facility_tag: string | null
  priority: string
  status: string
  assignments: {
    id: number
    employee_id: number
    employee_name: string | null
    role: string
    is_active: boolean
  }[]
}

const JOB_TYPES = ['repair', 'install', 'preventive', 'inspection', 'breakdown', 'upgrade']
const ASSET_KINDS = [
  'production_equipment',
  'machinery',
  'truck_lorry',
  'other_transport',
  'factory_infrastructure',
  'other',
]

export default function WorkshopPage() {
  const qc = useQueryClient()
  const [selId, setSelId] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState('')

  const { data: jobs = [], error } = useQuery({
    queryKey: ['workshop-jobs', statusFilter],
    queryFn: async () => {
      const params = statusFilter ? { status: statusFilter } : {}
      const res = await api.get<Job[]>('/workshop/jobs', { params })
      return res.data
    },
    retry: false,
  })

  const { data: detail } = useQuery({
    queryKey: ['workshop-job', selId],
    queryFn: async () => {
      const res = await api.get<JobDetail>(`/workshop/jobs/${selId}`)
      return res.data
    },
    enabled: selId !== null,
    retry: false,
  })

  const { data: employees = [] } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: async () => {
      const res = await api.get<Employee[]>('/payroll/employees')
      return res.data
    },
    retry: false,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: ['transport-vehicles-ws'],
    queryFn: async () => {
      const res = await api.get<Vehicle[]>('/transport/vehicles')
      return res.data
    },
    retry: false,
  })

  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [jtype, setJtype] = useState('repair')
  const [akind, setAkind] = useState('machinery')
  const [vehId, setVehId] = useState<number | ''>('')
  const [zone, setZone] = useState('')
  const [tag, setTag] = useState('')
  const [pri, setPri] = useState('normal')

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post('/workshop/jobs', {
        title: title || 'Workshop job',
        description: desc || undefined,
        job_type: jtype,
        asset_kind: akind,
        vehicle_id: vehId === '' ? undefined : vehId,
        location_zone: zone || undefined,
        facility_tag: tag || undefined,
        priority: pri,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workshop-jobs'] })
      setTitle('')
      setDesc('')
    },
  })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await api.post(`/workshop/jobs/${id}/status`, {}, { params: { status } })
      return res.data
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['workshop-jobs'] })
      qc.invalidateQueries({ queryKey: ['workshop-job', vars.id] })
    },
  })

  const [assignEmp, setAssignEmp] = useState<number | ''>('')
  const [assignRole, setAssignRole] = useState('technician')

  const assign = useMutation({
    mutationFn: async () => {
      if (selId === null || assignEmp === '') throw new Error('Pick job and employee')
      const res = await api.post(`/workshop/jobs/${selId}/assignments`, {
        employee_id: assignEmp as number,
        role: assignRole,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workshop-job', selId] })
      qc.invalidateQueries({ queryKey: ['workshop-jobs'] })
    },
  })

  const release = useMutation({
    mutationFn: async (assignmentId: number) => {
      const res = await api.post(`/workshop/assignments/${assignmentId}/release`)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workshop-job', selId] })
      qc.invalidateQueries({ queryKey: ['workshop-jobs'] })
    },
  })

  const kindLabel = useMemo(
    () =>
      ({
        production_equipment: 'Production equipment',
        machinery: 'Machinery',
        truck_lorry: 'Truck / lorry',
        other_transport: 'Other transport',
        factory_infrastructure: 'Factory infrastructure',
        other: 'Other',
      }) as Record<string, string>,
    [],
  )

  return (
          <div className="max-w-6xl space-y-8">
        <ReportingHubBreadcrumb current="Workshop" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Workshop</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Factory maintenance: <strong>repair</strong>, <strong>installation</strong>, and service for plant equipment, machines, and fleet
            (lorries, trucks, internal vehicles). Assign technicians from payroll; optional link to a transport vehicle.
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">Select a tenant to use workshop.</div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="erp-panel">
            <h2 className="text-sm font-semibold text-foreground">New job card</h2>
            <div className="mt-3 grid gap-2 text-sm">
              <input
                className="rounded-md border px-3 py-2"
                placeholder="Title *"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="rounded-md border px-3 py-2"
                rows={2}
                placeholder="Description (fault, scope, parts…)"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <select className="rounded-md border px-3 py-2" value={jtype} onChange={(e) => setJtype(e.target.value)}>
                  {JOB_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select className="rounded-md border px-3 py-2" value={akind} onChange={(e) => setAkind(e.target.value)}>
                  {ASSET_KINDS.map((t) => (
                    <option key={t} value={t}>
                      {kindLabel[t] ?? t}
                    </option>
                  ))}
                </select>
              </div>
              <select
                className="rounded-md border px-3 py-2"
                value={vehId === '' ? '' : String(vehId)}
                onChange={(e) => setVehId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Vehicle (optional — for lorries/trucks)</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.reg_no} ({vehicleTypeLabel(v.type)})
                  </option>
                ))}
              </select>
              <input
                className="rounded-md border px-3 py-2"
                placeholder="Location / zone (e.g. pellet line, yard)"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
              />
              <input
                className="rounded-md border px-3 py-2"
                placeholder="Facility tag (building, bay)"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              />
              <select className="rounded-md border px-3 py-2" value={pri} onChange={(e) => setPri(e.target.value)}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <button
                type="button"
                disabled={create.isPending || !title.trim()}
                onClick={() => create.mutate()}
                className="rounded-md bg-primary px-4 py-2 font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                Create job
              </button>
            </div>
          </section>

          <section className="erp-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Jobs</h2>
              <select
                className="rounded border px-2 py-1 text-xs"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="draft">draft</option>
                <option value="assigned">assigned</option>
                <option value="in_progress">in_progress</option>
                <option value="waiting_parts">waiting_parts</option>
                <option value="completed">completed</option>
                <option value="cancelled">cancelled</option>
              </select>
            </div>
            <ul className="mt-2 max-h-80 space-y-1 overflow-auto text-sm">
              {jobs.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    className={`w-full rounded px-2 py-1.5 text-left hover:bg-muted/40 ${selId === j.id ? 'bg-accent' : ''}`}
                    onClick={() => setSelId(j.id)}
                  >
                    <span className="font-mono text-xs text-muted-foreground">{j.job_number}</span>{' '}
                    <span className="font-medium">{j.title}</span>
                    <span className="text-muted-foreground"> · {j.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {detail && selId !== null ? (
          <section className="erp-panel">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{detail.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {detail.job_number} · {detail.job_type} · {kindLabel[detail.asset_kind] ?? detail.asset_kind}
                </p>
                {detail.description ? <p className="mt-2 text-sm">{detail.description}</p> : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {detail.location_zone ? `Zone: ${detail.location_zone}` : null}
                  {detail.facility_tag ? ` · ${detail.facility_tag}` : null}
                </p>
                {detail.vehicle ? (
                  <p className="text-sm">
                    Vehicle: <strong>{detail.vehicle.reg_no}</strong> ({vehicleTypeLabel(detail.vehicle.type)})
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="rounded bg-amber-600 px-2 py-1 text-xs text-white"
                  onClick={() => setStatus.mutate({ id: detail.id, status: 'in_progress' })}
                >
                  Start work
                </button>
                <button
                  type="button"
                  className="rounded bg-muted-foreground px-2 py-1 text-xs text-white"
                  onClick={() => setStatus.mutate({ id: detail.id, status: 'waiting_parts' })}
                >
                  Waiting parts
                </button>
                <button
                  type="button"
                  className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
                  onClick={() => setStatus.mutate({ id: detail.id, status: 'completed' })}
                >
                  Complete
                </button>
              </div>
            </div>

            <div className="mt-6 border-t pt-4">
              <h3 className="text-sm font-semibold">Technician assignment</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={assignEmp === '' ? '' : String(assignEmp)}
                  onChange={(e) => setAssignEmp(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Employee</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={assignRole}
                  onChange={(e) => setAssignRole(e.target.value)}
                >
                  <option value="lead">Lead</option>
                  <option value="technician">Technician</option>
                  <option value="helper">Helper</option>
                  <option value="apprentice">Apprentice</option>
                </select>
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-1 text-sm text-white disabled:opacity-50"
                  disabled={assignEmp === '' || assign.isPending}
                  onClick={() => assign.mutate()}
                >
                  Assign
                </button>
              </div>
              <ul className="mt-3 text-sm">
                {detail.assignments
                  .filter((a) => a.is_active)
                  .map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 border-b border-border/70 py-1">
                      <span>
                        {a.employee_name ?? a.employee_id} <span className="text-muted-foreground">({a.role})</span>
                      </span>
                      <button
                        type="button"
                        className="text-xs text-destructive"
                        onClick={() => release.mutate(a.id)}
                      >
                        Release
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          </section>
        ) : null}
      </div>
  )
}
