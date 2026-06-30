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
      <div className={`text-xs text-foreground/85 ${className}`}>
        <div>
          <span className="text-muted-foreground">Opening: </span>
          <span className="font-medium">
            {currencySymbol}
            {o.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {openingBalanceDate ? (
            <span className="ml-1 text-muted-foreground/70">({formatDateOnly(openingBalanceDate)})</span>
          ) : null}
        </div>
        <div className="mt-0.5">
          <span className="text-muted-foreground">{curLabel}: </span>
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
      className={`mt-2 rounded border border-border/80 bg-muted/50 px-3 py-2 text-sm ${className}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Balances (from contact)</p>
      <div className="mt-1.5 space-y-1.5 text-foreground">
        <p>
          <span className="text-muted-foreground">Opening balance: </span>
          <span className="font-medium tabular-nums">
            {currencySymbol}
            {o.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {openingBalanceDate ? (
            <span className="ml-1.5 text-xs text-muted-foreground">
              as of {formatDateOnly(openingBalanceDate)}
            </span>
          ) : null}
        </p>
        <p>
          <span className="text-muted-foreground">{curLabel}: </span>
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
    <p className={`text-xs text-muted-foreground ${className}`}>
      <span className="text-muted-foreground">Register opening: </span>
      <span className="font-medium text-foreground">
        {currencySymbol}
        {o.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      {openingBalanceDate ? <span> ({formatDateOnly(openingBalanceDate)})</span> : null}
      <span className="mx-1.5 text-muted-foreground/40">|</span>
      <span className="text-muted-foreground">GL balance: </span>
      <span className="font-medium text-foreground">
        {currencySymbol}
        {c.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </p>
  )
}
