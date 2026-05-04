'use client'

import { formatDateOnly } from '@/utils/date'

function parseAmt(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

type Role = 'customer' | 'vendor'

type Props = {
  role: Role
  /** Raw from API; optional */
  openingBalance?: string | number | null
  openingBalanceDate?: string | null
  currentBalance?: string | number | null
  currencySymbol: string
  /** Smaller one-line or two-line for table cells */
  compact?: boolean
  className?: string
}

/**
 * Opening balance + current A/R or A/P (from contact record) for payment screens.
 */
export function ContactArApBalances({
  role,
  openingBalance,
  openingBalanceDate,
  currentBalance,
  currencySymbol,
  compact = false,
  className = '',
}: Props) {
  const o = parseAmt(openingBalance)
  const c = parseAmt(currentBalance)
  const curLabel = role === 'customer' ? 'A/R (current)' : 'A/P (current)'

  if (compact) {
    return (
      <div className={`text-xs text-slate-700 ${className}`}>
        <div>
          <span className="text-slate-500">Opening: </span>
          <span className="font-medium">
            {currencySymbol}
            {o.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {openingBalanceDate ? (
            <span className="ml-1 text-slate-400">({formatDateOnly(openingBalanceDate)})</span>
          ) : null}
        </div>
        <div className="mt-0.5">
          <span className="text-slate-500">{curLabel}: </span>
          <span className="font-medium">
            {currencySymbol}
            {c.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`mt-2 rounded border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-sm ${className}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Balances (from contact)</p>
      <div className="mt-1.5 space-y-1.5 text-slate-800">
        <p>
          <span className="text-slate-600">Opening balance: </span>
          <span className="font-medium tabular-nums">
            {currencySymbol}
            {o.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {openingBalanceDate ? (
            <span className="ml-1.5 text-xs text-slate-500">
              as of {formatDateOnly(openingBalanceDate)}
            </span>
          ) : null}
        </p>
        <p>
          <span className="text-slate-600">{curLabel}: </span>
          <span className="font-medium tabular-nums">
            {currencySymbol}
            {c.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </p>
      </div>
    </div>
  )
}

type BankRowProps = {
  openingBalance?: string | number | null
  openingBalanceDate?: string | null
  currentBalance?: string | number | null
  currencySymbol: string
  className?: string
}

/** Opening + current for a bank / cash register row in payment forms */
export function BankRegisterBalances({
  openingBalance,
  openingBalanceDate,
  currentBalance,
  currencySymbol,
  className = '',
}: BankRowProps) {
  const o = parseAmt(openingBalance)
  const c = parseAmt(currentBalance)
  return (
    <p className={`text-xs text-slate-600 ${className}`}>
      <span className="text-slate-500">Register opening: </span>
      <span className="font-medium text-slate-800">
        {currencySymbol}
        {o.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      {openingBalanceDate ? <span> ({formatDateOnly(openingBalanceDate)})</span> : null}
      <span className="mx-1.5 text-slate-300">|</span>
      <span className="text-slate-500">GL balance: </span>
      <span className="font-medium text-slate-800">
        {currencySymbol}
        {c.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </p>
  )
}
