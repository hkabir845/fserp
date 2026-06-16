/**
 * Quick journal entry patterns for fuel-station + aquaculture ERP.
 * Each template suggests GL accounts (template codes) and which entity dimension to tag.
 */

import type { CoaPick } from '@/lib/coaDefaults'
import {
  COA_AQ_FEED,
  COA_BANK_OP,
  COA_CASH,
  COA_OWNER_DRAW,
  COA_OWNER_EQUITY,
  COA_SALARY_EXP,
  COA_STATION_OPERATING,
  COA_UTIL_ELECTRIC,
  coaIdForCode,
  coaIdForFirstCode,
  suggestedSettlementAccountId,
} from '@/lib/coaDefaults'

export type JournalQuickEntryKind =
  | 'owner_contribution'
  | 'owner_draw'
  | 'station_expense'
  | 'pond_expense_feed'
  | 'utility_expense'
  | 'salary_expense'

export type JournalTemplateLine = {
  side: 'debit' | 'credit'
  /** Template account code — resolved against company COA at apply time. */
  accountCode: string
  accountCodeFallbacks?: string[]
  /** When true, user must pick a fuel/shop station (or use default site). */
  tagStation?: boolean
  /** When true, user must pick a pond (or use default pond on line). */
  tagPond?: boolean
  description?: string
}

export type JournalQuickEntryTemplate = {
  kind: JournalQuickEntryKind
  label: string
  hint: string
  description: string
  /** Optional default header station when template is station-scoped. */
  prefersStationDefault?: boolean
  lines: JournalTemplateLine[]
}

export const JOURNAL_QUICK_ENTRY_TEMPLATES: JournalQuickEntryTemplate[] = [
  {
    kind: 'owner_contribution',
    label: 'Owner cash contribution',
    hint: 'Dr bank/cash · Cr owner equity (3000). Company-wide — no site tag on equity.',
    description: 'Owner capital injection',
    lines: [
      { side: 'debit', accountCode: COA_BANK_OP, accountCodeFallbacks: [COA_CASH], description: 'Bank receipt' },
      { side: 'credit', accountCode: COA_OWNER_EQUITY, description: 'Owner capital' },
    ],
  },
  {
    kind: 'owner_draw',
    label: 'Owner draw / withdrawal',
    hint: 'Dr owner draw (3300) · Cr bank/cash. Company-wide.',
    description: 'Owner withdrawal',
    lines: [
      { side: 'debit', accountCode: COA_OWNER_DRAW, description: 'Owner draw' },
      {
        side: 'credit',
        accountCode: COA_BANK_OP,
        accountCodeFallbacks: [COA_CASH],
        description: 'Bank payment',
      },
    ],
  },
  {
    kind: 'station_expense',
    label: 'Station operating expense',
    hint: 'Dr station expense · Cr bank. Tag the fuel site or shop hub on the expense line.',
    description: 'Station operating expense',
    prefersStationDefault: true,
    lines: [
      {
        side: 'debit',
        accountCode: COA_STATION_OPERATING,
        tagStation: true,
        description: 'Station expense',
      },
      {
        side: 'credit',
        accountCode: COA_BANK_OP,
        accountCodeFallbacks: [COA_CASH],
        description: 'Payment',
      },
    ],
  },
  {
    kind: 'utility_expense',
    label: 'Station utility (electric)',
    hint: 'Dr utilities (6100) · Cr bank. Tag the station that incurred the bill.',
    description: 'Electric / utility',
    prefersStationDefault: true,
    lines: [
      {
        side: 'debit',
        accountCode: COA_UTIL_ELECTRIC,
        accountCodeFallbacks: [COA_STATION_OPERATING],
        tagStation: true,
        description: 'Utility expense',
      },
      {
        side: 'credit',
        accountCode: COA_BANK_OP,
        accountCodeFallbacks: [COA_CASH],
        description: 'Payment',
      },
    ],
  },
  {
    kind: 'pond_expense_feed',
    label: 'Pond feed expense (manual)',
    hint: 'Dr aquaculture feed (6716) · Cr bank. Tag the pond — prefer Bills for routine feed.',
    description: 'Pond feed expense',
    lines: [
      {
        side: 'debit',
        accountCode: COA_AQ_FEED,
        tagPond: true,
        description: 'Feed expense',
      },
      {
        side: 'credit',
        accountCode: COA_BANK_OP,
        accountCodeFallbacks: [COA_CASH],
        description: 'Payment',
      },
    ],
  },
  {
    kind: 'salary_expense',
    label: 'Salary / payroll expense',
    hint: 'Dr salary (6400) · Cr bank. Tag station or pond if wages are site-specific.',
    description: 'Payroll expense',
    prefersStationDefault: true,
    lines: [
      {
        side: 'debit',
        accountCode: COA_SALARY_EXP,
        tagStation: true,
        description: 'Salaries',
      },
      {
        side: 'credit',
        accountCode: COA_BANK_OP,
        accountCodeFallbacks: [COA_CASH],
        description: 'Payroll payment',
      },
    ],
  },
]

function resolveTemplateAccountId(tpl: JournalTemplateLine, options: CoaPick[]): number | null {
  const primary = coaIdForCode(tpl.accountCode, options)
  if (primary) return parseInt(primary, 10) || null
  if (tpl.accountCodeFallbacks?.length) {
    const fb = coaIdForFirstCode(tpl.accountCodeFallbacks, options)
    return fb ? parseInt(fb, 10) || null : null
  }
  return null
}

export type AppliedJournalLine = {
  line_number: number
  description: string
  debit_account_id: number | null
  credit_account_id: number | null
  amount: number
  station_id: number | ''
  aquaculture_pond_id: number | ''
}

/** Build two balanced lines from a quick-entry template (amount left for user). */
export function applyJournalQuickEntryTemplate(
  kind: JournalQuickEntryKind,
  options: CoaPick[],
  ctx?: { defaultStationId?: number | ''; defaultPondId?: number | '' }
): {
  description: string
  station_id: number | ''
  lines: AppliedJournalLine[]
} | null {
  const template = JOURNAL_QUICK_ENTRY_TEMPLATES.find((t) => t.kind === kind)
  if (!template) return null

  const settlementId = suggestedSettlementAccountId(options)
  const lines: AppliedJournalLine[] = template.lines.map((tpl, idx) => {
    let accountId = resolveTemplateAccountId(tpl, options)
    if (
      !accountId &&
      settlementId &&
      (tpl.accountCode === COA_BANK_OP || tpl.accountCodeFallbacks?.includes(COA_CASH))
    ) {
      accountId = parseInt(settlementId, 10) || null
    }
    const station_id: number | '' =
      tpl.tagStation && ctx?.defaultStationId !== '' && ctx?.defaultStationId != null
        ? Number(ctx.defaultStationId)
        : tpl.tagStation
          ? ''
          : ''
    const aquaculture_pond_id: number | '' =
      tpl.tagPond && ctx?.defaultPondId !== '' && ctx?.defaultPondId != null
        ? Number(ctx.defaultPondId)
        : tpl.tagPond
          ? ''
          : ''

    return {
      line_number: idx + 1,
      description: tpl.description || '',
      debit_account_id: tpl.side === 'debit' ? accountId : null,
      credit_account_id: tpl.side === 'credit' ? accountId : null,
      amount: 0,
      station_id,
      aquaculture_pond_id,
    }
  })

  return {
    description: template.description,
    station_id: template.prefersStationDefault && ctx?.defaultStationId ? ctx.defaultStationId : '',
    lines,
  }
}

/** Preferred template codes for account dropdown grouping (most-used in this ERP). */
export const JOURNAL_RECOMMENDED_ACCOUNT_CODES: readonly string[] = [
  COA_BANK_OP,
  COA_CASH,
  COA_OWNER_EQUITY,
  COA_OWNER_DRAW,
  COA_STATION_OPERATING,
  COA_UTIL_ELECTRIC,
  COA_SALARY_EXP,
  COA_AQ_FEED,
  '6712',
  '6721',
  '4240',
  '4100',
  '4200',
  '5100',
  '5120',
  '1100',
  '2000',
]
