'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { VEHICLE_TYPE_OPTIONS, vehicleTypeLabel } from '@/lib/vehicle-types'

type Vehicle = { id: number; reg_no: string; type: string; capacity: string | null; is_active: boolean }
type Driver = { id: number; name: string; phone: string | null; license_number: string | null; is_active: boolean }
type Trip = {
  id: number
  trip_number: string
  trip_type: string
  vehicle_id: number
  driver_id: number
  status: string
  origin: string | null
  destination: string | null
  vehicle_reg_no?: string | null
  driver_name?: string | null
}

export default function TransportPage() {
  const qc = useQueryClient()
  const [tripStatusFilter, setTripStatusFilter] = useState('')
  const [tripTypeFilter, setTripTypeFilter] = useState('')
  const [tripSearch, setTripSearch] = useState('')

  const { data: vehicles = [], error: vErr } = useQuery({
    queryKey: ['transport-vehicles-full'],
    queryFn: async () => {
      const res = await api.get<Vehicle[]>('/transport/vehicles')
      return res.data
    },
    retry: false,
  })

  const { data: drivers = [] } = useQuery({
    queryKey: ['transport-drivers'],
    queryFn: async () => {
      const res = await api.get<Driver[]>('/transport/drivers')
      return res.data
    },
    retry: false,
  })

  const { data: trips = [], isLoading } = useQuery({
    queryKey: ['transport-trips', tripStatusFilter, tripTypeFilter, tripSearch],
    queryFn: async () => {
      const res = await api.get<Trip[]>('/transport/trips', {
        params: {
          status: tripStatusFilter || undefined,
          trip_type: tripTypeFilter || undefined,
          search: tripSearch.trim() || undefined,
        },
      })
      return res.data
    },
    retry: false,
  })
  const { data: tripSummary } = useQuery({
    queryKey: ['transport-trips-summary'],
    queryFn: async () => {
      const res = await api.get<Record<string, number>>('/transport/trips/summary')
      return res.data
    },
    retry: false,
  })

  const [reg, setReg] = useState('')
  const [vtype, setVtype] = useState('truck')
  const addV = useMutation({
    mutationFn: async () => {
      const res = await api.post('/transport/vehicles', { reg_no: reg, type: vtype })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-vehicles'] })
      qc.invalidateQueries({ queryKey: ['transport-vehicles-full'] })
      setReg('')
    },
  })

  const [dname, setDname] = useState('')
  const [dphone, setDphone] = useState('')
  const addD = useMutation({
    mutationFn: async () => {
      const res = await api.post('/transport/drivers', { name: dname, phone: dphone || undefined })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-drivers'] })
      setDname('')
      setDphone('')
    },
  })

  const [tripNo, setTripNo] = useState('')
  const [tv, setTv] = useState<number | ''>('')
  const [td, setTd] = useState<number | ''>('')
  const [ttype, setTtype] = useState('own_delivery')
  const addT = useMutation({
    mutationFn: async () => {
      if (tripNo === '' || tv === '' || td === '') throw new Error('missing fields')
      const res = await api.post('/transport/trips', {
        trip_number: tripNo,
        trip_type: ttype,
        vehicle_id: tv as number,
        driver_id: td as number,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-trips'] })
      setTripNo('')
    },
  })

  const statusTrip = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await api.patch(`/transport/trips/${id}/status`, {}, { params: { status } })
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transport-trips'] }),
  })

  const canStartTrips = vehicles.length > 0 && drivers.length > 0
  const summary = useMemo(
    () =>
      tripSummary ?? {
        total: trips.length,
        draft: trips.filter((t) => t.status === 'draft').length,
        in_progress: trips.filter((t) => t.status === 'in_progress').length,
        completed: trips.filter((t) => t.status === 'completed').length,
        cancelled: trips.filter((t) => t.status === 'cancelled').length,
      },
    [tripSummary, trips]
  )

  const statusPill = (status: string) => {
    if (status === 'completed') return 'bg-emerald-100 text-emerald-700'
    if (status === 'in_progress') return 'bg-blue-100 text-blue-700'
    if (status === 'cancelled') return 'bg-rose-100 text-rose-700'
    return 'bg-amber-100 text-amber-700'
  }
  const mutationError =
    (addV.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (addD.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (addT.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (statusTrip.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail

  return (
          <div className="max-w-6xl space-y-8">
        <ReportingHubBreadcrumb current="Transport & fleet" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transport & fleet</h1>
          <p className="mt-1 text-sm text-gray-600">
            FMERP vehicles, drivers, trips, and delivery notes — use with Fuel station for diesel/octane refueling logs.
          </p>
        </div>

        {vErr ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            Select a tenant in the company switcher to manage fleet data.
          </div>
        ) : null}
        {mutationError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {mutationError}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Trips total</div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">{summary.total ?? 0}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Draft</div>
            <div className="mt-2 text-2xl font-semibold text-amber-700">{summary.draft ?? 0}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">In progress</div>
            <div className="mt-2 text-2xl font-semibold text-blue-700">{summary.in_progress ?? 0}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Completed</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-700">{summary.completed ?? 0}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cancelled</div>
            <div className="mt-2 text-2xl font-semibold text-rose-700">{summary.cancelled ?? 0}</div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Add vehicle</h2>
            <div className="mt-2 space-y-2">
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Registration"
                value={reg}
                onChange={(e) => setReg(e.target.value)}
              />
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={vtype} onChange={(e) => setVtype(e.target.value)}>
                {VEHICLE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!reg.trim() || addV.isPending}
                onClick={() => addV.mutate()}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {addV.isPending ? 'Saving…' : 'Save vehicle'}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Add driver</h2>
            <div className="mt-2 space-y-2">
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Name"
                value={dname}
                onChange={(e) => setDname(e.target.value)}
              />
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Phone"
                value={dphone}
                onChange={(e) => setDphone(e.target.value)}
              />
              <button
                type="button"
                disabled={!dname.trim() || addD.isPending}
                onClick={() => addD.mutate()}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {addD.isPending ? 'Saving…' : 'Save driver'}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">New trip</h2>
            <div className="mt-2 space-y-2">
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Trip # (unique)"
                value={tripNo}
                onChange={(e) => setTripNo(e.target.value)}
              />
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={ttype} onChange={(e) => setTtype(e.target.value)}>
                <option value="own_delivery">Own delivery</option>
                <option value="third_party">Third party</option>
              </select>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={tv} onChange={(e) => setTv(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Vehicle</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.reg_no} ({vehicleTypeLabel(v.type)})
                  </option>
                ))}
              </select>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={td} onChange={(e) => setTd(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Driver</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={addT.isPending || tripNo === '' || tv === '' || td === '' || !canStartTrips}
                onClick={() => addT.mutate()}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {addT.isPending ? 'Creating…' : 'Create trip'}
              </button>
              {!canStartTrips ? (
                <p className="text-xs text-amber-700">Add at least one vehicle and one driver first.</p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Fleet</h2>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Vehicles</h3>
              <ul className="mt-1 text-sm">
                {vehicles.map((v) => (
                  <li key={v.id}>
                    {v.reg_no}{' '}
                    <span className="text-gray-500">({vehicleTypeLabel(v.type)})</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Drivers</h3>
              <ul className="mt-1 text-sm">
                {drivers.map((d) => (
                  <li key={d.id}>{d.name}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Trips</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Search trip #"
              value={tripSearch}
              onChange={(e) => setTripSearch(e.target.value)}
            />
            <select className="w-full rounded-md border px-3 py-2 text-sm" value={tripTypeFilter} onChange={(e) => setTripTypeFilter(e.target.value)}>
              <option value="">All types</option>
              <option value="own_delivery">Own delivery</option>
              <option value="third_party">Third party</option>
            </select>
            <select className="w-full rounded-md border px-3 py-2 text-sm" value={tripStatusFilter} onChange={(e) => setTripStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          {isLoading ? (
            <p className="mt-2 text-sm text-gray-500">Loading…</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="p-2">Trip #</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Vehicle</th>
                    <th className="p-2">Driver</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((t) => (
                    <tr key={t.id} className="border-b border-gray-100">
                      <td className="p-2 font-medium">{t.trip_number}</td>
                      <td className="p-2">{t.trip_type}</td>
                      <td className="p-2">{t.vehicle_reg_no ?? '-'}</td>
                      <td className="p-2">{t.driver_name ?? '-'}</td>
                      <td className="p-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusPill(t.status)}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="p-2 space-x-1">
                        {t.status === 'draft' ? (
                          <button
                            type="button"
                            className="text-xs text-indigo-600"
                            disabled={statusTrip.isPending}
                            onClick={() => statusTrip.mutate({ id: t.id, status: 'in_progress' })}
                          >
                            Start
                          </button>
                        ) : null}
                        {t.status === 'draft' || t.status === 'in_progress' ? (
                          <button
                            type="button"
                            className="text-xs text-rose-600"
                            disabled={statusTrip.isPending}
                            onClick={() => statusTrip.mutate({ id: t.id, status: 'cancelled' })}
                          >
                            Cancel
                          </button>
                        ) : null}
                        {t.status === 'in_progress' ? (
                          <button
                            type="button"
                            className="text-xs text-emerald-600"
                            disabled={statusTrip.isPending}
                            onClick={() => statusTrip.mutate({ id: t.id, status: 'completed' })}
                          >
                            Complete
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
  )
}
