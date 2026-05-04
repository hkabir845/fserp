'use client'

import { Droplets, Fuel, ShoppingBag } from 'lucide-react'

export type PosSaleScopeValue = 'both' | 'general' | 'fuel'

const OPTIONS: {
  id: PosSaleScopeValue
  title: string
  subtitle: string
  Icon: typeof Fuel
}[] = [
  {
    id: 'both',
    title: 'Fuel & general',
    subtitle: 'Forecourt fuel plus shop / inventory lines — one cashier for pumps and store.',
    Icon: Droplets,
  },
  {
    id: 'general',
    title: 'General / shop only',
    subtitle: 'Shop lane or convenience register — no fuel nozzle sales for this login.',
    Icon: ShoppingBag,
  },
  {
    id: 'fuel',
    title: 'Fuel only',
    subtitle: 'Pump lane — fuel lines only; no general merchandise at this register.',
    Icon: Fuel,
  },
]

type Props = {
  value: PosSaleScopeValue | string
  onChange: (next: PosSaleScopeValue) => void
  disabled?: boolean
  /** Prefix for input name/id (multiple forms on one page). */
  name?: string
  className?: string
}

function normalizeValue(raw: string): PosSaleScopeValue {
  const s = (raw || 'both').toString().trim().toLowerCase()
  if (s === 'general' || s === 'fuel' || s === 'both') return s
  return 'both'
}

/** Short label for tables and summaries (cashier / operator rows). */
export function formatPosSaleScopeShort(scope: string | undefined | null): string {
  const s = (scope || 'both').toString().trim().toLowerCase()
  if (s === 'general') return 'Shop only'
  if (s === 'fuel') return 'Fuel only'
  return 'Fuel + shop'
}

/**
 * Clear, professional selector for {@link User.pos_sale_scope} (cashier / operator).
 * Server enforces the same values at `/api/cashier/pos`.
 */
export function PosSaleScopeSelector({
  value,
  onChange,
  disabled,
  name = 'pos_sale_scope',
  className = '',
}: Props) {
  const v = normalizeValue(value)

  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <p className="text-sm font-semibold text-gray-900">POS lane — what this login may sell</p>
        <p className="mt-0.5 text-xs leading-snug text-gray-600">
          Pick one profile per cashier or operator. Concurrent logins can use different lanes (e.g. shop-only vs
          full lane). Changes apply after the user signs in again.
        </p>
      </div>

      <div
        className="grid gap-3 sm:grid-cols-3"
        role="radiogroup"
        aria-label="POS sale scope"
      >
        {OPTIONS.map((opt) => {
          const selected = v === opt.id
          const Ico = opt.Icon
          return (
            <label
              key={opt.id}
              className={[
                'relative flex cursor-pointer flex-col rounded-xl border-2 p-3 transition-colors',
                disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-gray-300',
                selected
                  ? 'border-violet-500 bg-violet-50/90 shadow-sm'
                  : 'border-gray-200 bg-white',
              ].join(' ')}
            >
              <input
                type="radio"
                name={name}
                value={opt.id}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(opt.id)}
                className="sr-only"
              />
              <span className="mb-2 flex items-center gap-2">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    selected ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  <Ico className="h-4 w-4" aria-hidden />
                </span>
                <span className="text-sm font-semibold leading-tight text-gray-900">{opt.title}</span>
              </span>
              <span className="text-xs leading-snug text-gray-600">{opt.subtitle}</span>
            </label>
          )
        })}
      </div>

      <div className="rounded-lg border border-gray-100 bg-gray-50/90 px-3 py-2 text-xs text-gray-600">
        <span className="font-medium text-gray-800">Tip:</span> Use{' '}
        <strong className="font-semibold text-gray-900">Fuel & general</strong> for combined lanes,{' '}
        <strong className="font-semibold text-gray-900">General only</strong> for a separate shop POS, and{' '}
        <strong className="font-semibold text-gray-900">Fuel only</strong> for pump-only staff.
      </div>
    </div>
  )
}
