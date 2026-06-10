'use client'

import {
  formatPondScopeKey,
  type BillReceiptLocationPond,
  type BillReceiptLocationStation,
} from '@/lib/billReceiptLocation'

function pondRoleHint(role: string | undefined): string {
  const r = (role || '').trim().toLowerCase()
  if (r === 'nursing') return ' (nursing)'
  if (r === 'grow_out' || r === 'grow-out') return ' (grow-out)'
  return ''
}

export function BillReceiptLocationSelect({
  value,
  onChange,
  stations,
  ponds,
  className,
  id,
}: {
  value: string
  onChange: (key: string) => void
  stations: BillReceiptLocationStation[]
  ponds: BillReceiptLocationPond[]
  className?: string
  id?: string
}) {
  const activeStations = stations.filter((s) => s.is_active !== false)
  const activePonds = ponds.filter((p) => p.is_active !== false)
  const scopePond = value.startsWith('p:') ? parseInt(value.slice(2), 10) : NaN
  const scopeStation = /^\d+$/.test(value) ? parseInt(value, 10) : NaN
  const orphanPond =
    Number.isFinite(scopePond) && scopePond > 0 && !activePonds.some((p) => p.id === scopePond)
      ? ponds.find((p) => p.id === scopePond)
      : null
  const orphanStation =
    Number.isFinite(scopeStation) && scopeStation > 0 && !activeStations.some((s) => s.id === scopeStation)
      ? stations.find((s) => s.id === scopeStation)
      : null

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      <option value="">— Not set —</option>
      {activeStations.length > 0 ? (
        <optgroup label="Fuel & shop stations">
          {activeStations.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.station_name}
              {s.station_number ? ` (${s.station_number})` : ''}
              {s.operates_fuel_retail === false ? ' — shop hub' : ''}
            </option>
          ))}
        </optgroup>
      ) : null}
      {activePonds.length > 0 ? (
        <optgroup label="Aquaculture ponds">
          {activePonds.map((p) => (
            <option key={p.id} value={formatPondScopeKey(p.id)}>
              {p.name}
              {pondRoleHint(p.pond_role)}
            </option>
          ))}
        </optgroup>
      ) : null}
      {orphanStation ? (
        <option value={String(orphanStation.id)}>{orphanStation.station_name} (inactive)</option>
      ) : null}
      {orphanPond ? (
        <option value={formatPondScopeKey(orphanPond.id)}>{orphanPond.name} (inactive)</option>
      ) : null}
    </select>
  )
}
