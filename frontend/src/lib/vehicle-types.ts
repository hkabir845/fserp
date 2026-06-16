/** Fleet vehicle body types — stored as lowercase snake_case in API (`vehicles.type`). */

export const VEHICLE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'suv', label: 'SUV' },
  { value: 'sedan', label: 'Sedan' },
  { value: 'hatchback', label: 'Hatchback' },
  { value: 'coupe', label: 'Coupe' },
  { value: 'wagon', label: 'Wagon / estate' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'van', label: 'Van' },
  { value: 'minibus', label: 'Minibus' },
  { value: 'truck', label: 'Truck' },
  { value: 'bus', label: 'Bus' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'tractor', label: 'Tractor' },
  { value: 'forklift', label: 'Forklift' },
  { value: 'other', label: 'Other' },
]

const LABEL_BY_VALUE = Object.fromEntries(VEHICLE_TYPE_OPTIONS.map((o) => [o.value, o.label]))

export function vehicleTypeLabel(code: string): string {
  const k = code.trim().toLowerCase()
  if (LABEL_BY_VALUE[k]) return LABEL_BY_VALUE[k]
  if (!k) return '—'
  return code
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
