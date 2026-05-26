'use client'

import { Droplet, Fish, Layers } from 'lucide-react'
import {
  type ReportBusinessSegment,
  type ReportStationForSegment,
  segmentAvailability,
} from './reportBusinessSegment'

type BusinessSegmentFilterProps = {
  value: ReportBusinessSegment
  onChange: (segment: ReportBusinessSegment) => void
  stations: ReportStationForSegment[]
  disabled?: boolean
  lockedSegment?: ReportBusinessSegment | null
  activeLabel?: string
  activeStationNames?: string[]
  hint?: string
}

const SEGMENTS: {
  id: ReportBusinessSegment
  title: string
  icon: typeof Droplet
  activeClass: string
}[] = [
  {
    id: 'all',
    title: 'All sites',
    icon: Layers,
    activeClass: 'border-slate-800 bg-slate-900 text-white shadow-md',
  },
  {
    id: 'fuel',
    title: 'Fuel Station',
    icon: Droplet,
    activeClass: 'border-amber-600 bg-amber-600 text-white shadow-md',
  },
  {
    id: 'aquaculture',
    title: 'Aquaculture',
    icon: Fish,
    activeClass: 'border-teal-600 bg-teal-600 text-white shadow-md',
  },
]

export function BusinessSegmentFilter({
  value,
  onChange,
  stations,
  disabled = false,
  lockedSegment = null,
  activeLabel,
  activeStationNames,
  hint,
}: BusinessSegmentFilterProps) {
  const avail = segmentAvailability(stations)
  const effectiveValue = lockedSegment ?? value

  const segmentDisabled = (id: ReportBusinessSegment) => {
    if (disabled || lockedSegment != null) return true
    if (id === 'fuel' && !avail.hasFuel) return true
    if (id === 'aquaculture' && !avail.hasAquaculture) return true
    return false
  }

  const segmentSubtitle = (id: ReportBusinessSegment) => {
    if (id === 'fuel') {
      return avail.fuelStationNames.length === 1
        ? avail.fuelStationNames[0]
        : avail.fuelStationNames.length > 1
          ? `${avail.fuelStationNames.length} forecourt sites`
          : 'No fuel sites'
    }
    if (id === 'aquaculture') {
      return avail.aquacultureLabel.replace(/^Aquaculture\s*\(?/i, '').replace(/\)$/, '') || 'Premium Agro'
    }
    return 'Company-wide totals'
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Business line</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {hint || 'Fuel forecourt vs aquaculture shop. Applies to Sales, Purchase, and Daily Summary.'}
          </p>
          {lockedSegment ? (
            <p className="mt-2 text-xs font-medium text-amber-800">Locked to your home site.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {SEGMENTS.map((seg) => {
            const Icon = seg.icon
            const isActive = effectiveValue === seg.id
            const isDisabled = segmentDisabled(seg.id)
            const title =
              seg.id === 'aquaculture' ? avail.aquacultureLabel.replace('Aquaculture ', '') : seg.title
            return (
              <button
                key={seg.id}
                type="button"
                disabled={isDisabled}
                onClick={() => !isDisabled && onChange(seg.id)}
                className={[
                  'flex min-w-[9.5rem] flex-col items-start rounded-lg border px-3 py-2 text-left transition-all',
                  isActive
                    ? seg.activeClass
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                  isDisabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
                ].join(' ')}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Icon className="h-4 w-4 shrink-0" />
                  {seg.id === 'all' ? seg.title : seg.id === 'fuel' ? 'Fuel Station' : 'Aquaculture'}
                </span>
                <span
                  className={`mt-0.5 text-xs ${isActive ? 'text-white/90' : 'text-slate-500'}`}
                >
                  {seg.id === 'aquaculture' ? title : segmentSubtitle(seg.id)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {(activeLabel || (activeStationNames && activeStationNames.length > 0)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
          <span className="font-medium text-slate-800">Showing:</span>
          {activeLabel ? <span className="rounded-full bg-slate-100 px-2 py-0.5">{activeLabel}</span> : null}
          {activeStationNames?.map((name) => (
            <span key={name} className="rounded-full bg-slate-100 px-2 py-0.5">
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
