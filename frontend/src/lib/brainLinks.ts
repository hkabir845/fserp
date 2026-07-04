/** Build /brain URLs with optional entity context and starter question. */

export type BrainEntityType = 'pond' | 'station' | 'employee'

export type BrainLinkContext = {
  entityType?: BrainEntityType
  entityId?: number
  entityName?: string
  /** Pre-filled question (auto-sent when Brain page opens). */
  initialQuestion?: string
}

const DEFAULT_QUESTIONS: Record<BrainEntityType, { en: string; bn: string }> = {
  pond: {
    en: 'What is this pond’s FCR, fish density (kg/decimal), and today’s feeding recommendation? Should I harvest or stock more?',
    bn: 'এই পোন্ডের FCR, মাছের ঘনত্ব (কেজি/ডেসিমাল), এবং আজকের ফিড সুপারিশ কী? হারভেস্ট নাকি স্টকিং বাড়াব?',
  },
  station: {
    en: "What are today's sales and this month's net profit for this station?",
    bn: 'এই স্টেশনের আজকের বিক্রি এবং এই মাসের নেট লাভ কত?',
  },
  employee: {
    en: "What is this employee's salary and last payroll? Should we retain or review?",
    bn: 'এই কর্মচারীর বেতন এবং শেষ পে-রোল কত? রাখব নাকি পর্যালোচনা?',
  },
}

export function defaultBrainQuestion(
  entityType: BrainEntityType,
  lang: 'en' | 'bn',
  entityName?: string,
): string {
  const base = DEFAULT_QUESTIONS[entityType][lang]
  if (!entityName) return base
  if (lang === 'bn') {
    if (entityType === 'pond') return `${entityName} — ${base}`
    if (entityType === 'station') return `${entityName} — ${base}`
    return `${entityName} — ${base}`
  }
  return `${entityName}: ${base}`
}

export function brainPageHref(ctx?: BrainLinkContext): string {
  const params = new URLSearchParams()
  if (ctx?.entityType && ctx.entityId != null) {
    params.set('context_type', ctx.entityType)
    params.set('context_id', String(ctx.entityId))
  }
  if (ctx?.entityName) params.set('context_name', ctx.entityName)
  if (ctx?.initialQuestion) params.set('q', ctx.initialQuestion)
  const qs = params.toString()
  return qs ? `/brain?${qs}` : '/brain'
}
