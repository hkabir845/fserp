/** Bank / cash register row from GET /bank-accounts/ */
export type BankAccountLike = {
  id: number
  account_name?: string
  account_number?: string
  bank_name?: string
  chart_account_code?: string | null
  chart_account_id?: number | null
  current_balance?: number | string | null
  opening_balance?: string | number | null
  opening_balance_date?: string | null
  is_equity_register?: boolean
}

export function normalizeBankAccountsFromApi(data: unknown): BankAccountLike[] {
  let rows: unknown[] = []
  if (Array.isArray(data)) {
    rows = data
  } else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.results)) rows = o.results
    else if (Array.isArray(o.data)) rows = o.data
  }

  return rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .map((r): BankAccountLike | null => {
      const id = typeof r.id === 'number' ? r.id : Number(r.id)
      if (!Number.isFinite(id)) return null
      return {
        id,
        account_number: r.account_number != null ? String(r.account_number) : undefined,
        account_name: r.account_name != null ? String(r.account_name) : undefined,
        bank_name: r.bank_name != null ? String(r.bank_name) : undefined,
        chart_account_code:
          r.chart_account_code != null && r.chart_account_code !== ''
            ? String(r.chart_account_code)
            : null,
        chart_account_id:
          r.chart_account_id != null && r.chart_account_id !== ''
            ? Number(r.chart_account_id)
            : null,
        current_balance: r.current_balance as BankAccountLike['current_balance'],
        opening_balance: r.opening_balance as string | number | undefined,
        opening_balance_date:
          r.opening_balance_date != null && r.opening_balance_date !== ''
            ? String(r.opening_balance_date)
            : null,
        is_equity_register: r.is_equity_register === true,
      }
    })
    .filter((a): a is BankAccountLike => a != null)
}

/** Dropdown title: `1030 — Operating Bank` (falls back to register name). */
export function formatBankAccountTitle(account: BankAccountLike): string {
  const code = (account.chart_account_code || '').trim()
  const name = (account.account_name || '').trim() || `Register #${account.id}`
  return code ? `${code} — ${name}` : name
}

/** Title plus institution: `1030 — Operating Bank — United Commercial`. */
export function formatBankRegisterLabel(account: BankAccountLike): string {
  const title = formatBankAccountTitle(account)
  const bank = (account.bank_name || '').trim()
  return bank ? `${title} — ${bank}` : title
}

/** Payment forms: code — name — Op. opening | current balances. */
export function formatBankAccountWithBalances(
  account: BankAccountLike,
  currencySymbol: string,
  formatBalance: (balance: number | string | null | undefined) => string
): string {
  const title = formatBankAccountTitle(account)
  return `${title} — Op. ${currencySymbol}${formatBalance(account.opening_balance ?? 0)} | ${currencySymbol}${formatBalance(account.current_balance)}`
}

/** Fund transfer: code — name · bank — balance. */
export function formatBankAccountFundTransferOption(
  account: BankAccountLike,
  currencySymbol: string,
  formatBalance: (n: number) => string
): string {
  const title = formatBankAccountTitle(account)
  const bank = (account.bank_name || '').trim()
  const bal = formatBalance(Number(account.current_balance || 0))
  const meta = bank ? `${title} · ${bank}` : title
  return `${meta} — ${currencySymbol}${bal}`
}

/** Deposits / simple balance: code — name — balance. */
export function formatBankAccountWithCurrentBalance(
  account: BankAccountLike,
  currencySymbol: string,
  formatBalance: (balance: number | string | null | undefined) => string
): string {
  return `${formatBankAccountTitle(account)} — ${currencySymbol}${formatBalance(account.current_balance)}`
}
