'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Info, Loader2, Sparkles, TrendingUp } from 'lucide-react'
import api, { isApiSessionError } from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { useToast } from '@/components/Toast'

export type BrainInsight = {
  id?: number
  insight_type?: string
  title_bn?: string
  body_bn?: string
  severity?: 'info' | 'warning' | 'critical'
  recommended_action_bn?: string
  confidence?: string
  key_numbers?: Record<string, unknown>
}

export type BrainForecast = {
  prediction_type?: string
  title_bn?: string
  summary_bn?: string
  confidence?: string
  forecast_data?: Record<string, unknown>
}

function SeverityIcon({ severity }: { severity?: string }) {
  if (severity === 'critical' || severity === 'warning') {
    return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
  }
  return <Info className="h-4 w-4 shrink-0 text-blue-600" />
}

type Props = {
  language?: 'en' | 'bn'
  onAsk?: (question: string) => void
  className?: string
}

export function BrainInsightsPanel({ language = 'bn', onAsk, className = '' }: Props) {
  const toast = useToast()
  const [insights, setInsights] = useState<BrainInsight[]>([])
  const [forecasts, setForecasts] = useState<BrainForecast[]>([])
  const [loading, setLoading] = useState(true)

  const labels =
    language === 'bn'
      ? {
          title: 'AI Manager Insights',
          subtitle: 'ERP ডেটা থেকে স্বয়ংক্রিয় সতর্কতা ও পূর্বাভাস',
          forecasts: 'পূর্বাভাস',
          refresh: 'রিফ্রেশ',
          ask: 'জিজ্ঞেস করুন',
          empty: 'এখনো insight নেই — চ্যাটে প্রশ্ন করুন।',
        }
      : {
          title: 'AI Manager Insights',
          subtitle: 'Auto-generated warnings and forecasts from ERP data',
          forecasts: 'Forecasts',
          refresh: 'Refresh',
          ask: 'Ask',
          empty: 'No insights yet — ask a question in chat.',
        }

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      const insightUrl = refresh ? '/brain/insights/?refresh=1' : '/brain/insights/'
      const [insRes, predRes] = await Promise.all([
        api.get<{ results: BrainInsight[] }>(insightUrl),
        api.get<{ forecasts: BrainForecast[] }>('/brain/predictions/?live=1'),
      ])
      setInsights(insRes.data.results || [])
      setForecasts((predRes.data.forecasts || []).slice(0, 4))
    } catch (e) {
      if (!isApiSessionError(e)) toast.error(extractErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className={`rounded-xl border border-border bg-card p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-600" />
            <h2 className="text-sm font-semibold">{labels.title}</h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{labels.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {labels.refresh}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : insights.length === 0 && forecasts.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{labels.empty}</p>
      ) : (
        <div className="space-y-3">
          {insights.slice(0, 6).map((item, i) => (
            <div
              key={item.id ?? i}
              className={`rounded-lg border px-3 py-2.5 text-xs ${
                item.severity === 'critical'
                  ? 'border-red-200 bg-red-50/80'
                  : item.severity === 'warning'
                    ? 'border-amber-200 bg-amber-50/80'
                    : 'border-border bg-muted/20'
              }`}
            >
              <div className="flex gap-2">
                <SeverityIcon severity={item.severity} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{item.title_bn}</p>
                  {item.body_bn ? (
                    <p className="mt-1 text-muted-foreground">{item.body_bn}</p>
                  ) : null}
                  {item.recommended_action_bn ? (
                    <p className="mt-1.5 font-medium text-indigo-800">{item.recommended_action_bn}</p>
                  ) : null}
                  {onAsk && item.title_bn ? (
                    <button
                      type="button"
                      className="mt-2 text-[10px] font-semibold text-primary hover:underline"
                      onClick={() => onAsk(item.title_bn || '')}
                    >
                      {labels.ask} →
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          {forecasts.length > 0 && (
            <div className="pt-1">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                {labels.forecasts}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {forecasts.map((f, i) => (
                  <div
                    key={f.prediction_type ?? i}
                    className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-xs"
                  >
                    <p className="font-medium text-indigo-950">{f.title_bn}</p>
                    <p className="mt-1 text-indigo-900/80">{f.summary_bn}</p>
                    {f.confidence ? (
                      <p className="mt-1 text-[10px] text-indigo-700/70">confidence: {f.confidence}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
