'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { Brain, ChevronDown, ChevronUp, ExternalLink, Loader2, Send } from 'lucide-react'

type BrainSource = {
  kind?: string
  type?: string
  id?: number | null
  label?: string
  path?: string | null
  url?: string | null
}

type BrainStructured = {
  answer_bn?: string
  reasoning_steps_bn?: string[]
  confidence?: string
  sources?: BrainSource[]
  missing_inputs?: { key?: string; prompt_bn?: string }[]
  suggested_actions?: { action?: string; label_bn?: string; requires_approval?: boolean }[]
}

type BrainMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  structured?: BrainStructured
  model_used?: string
  created_at?: string
}

type BrainUsage = {
  plan: string
  plan_label: string
  messages_used_today: number
  daily_message_limit: number | null
  messages_remaining_today: number | null
  web_research_enabled: boolean
  llm_enabled: boolean
}

const UI = {
  en: {
    title: 'Company Brain',
    subtitle: 'Your company’s second brain — answers in Bangla with ERP references and reasoning.',
    placeholder: 'FCR, density, sales, profit, salary, feed, disease, job cuts — ask anything…',
    send: 'Send',
    thinking: 'Thinking…',
    showReasoning: 'Show reasoning',
    hideReasoning: 'Hide reasoning',
    sources: 'Sources',
    confidence: 'Confidence',
    newChat: 'New conversation',
    plan: 'Plan',
    messagesToday: 'Messages today',
    llmOff: 'AI API not configured — add a Free API key in SaaS Admin → Brain API (or set OPENROUTER_API_KEY on the server).',
    upgrade: 'Daily limit reached. Upgrade to Growth for more messages.',
    contextPond: 'Focused on pond',
    contextStation: 'Focused on station',
    contextEmployee: 'Focused on employee',
  },
  bn: {
    title: 'কোম্পানি ব্রেইন',
    subtitle: 'আপনার কোম্পানির দ্বিতীয় মস্তিষ্ক — বাংলায় উত্তর, ERP তথ্যসূত্র ও যুক্তি সহ।',
    placeholder: 'FCR, ঘনত্ব, বিক্রি, লাভ, বেতন, ফিড, রোগ-ঔষধ, চাকরি কাটা — যেকোনো প্রশ্ন…',
    send: 'পাঠান',
    thinking: 'চিন্তা করছে…',
    showReasoning: 'যুক্তি দেখুন',
    hideReasoning: 'যুক্তি লুকান',
    sources: 'তথ্যসূত্র',
    confidence: 'আত্মবিশ্বাস',
    newChat: 'নতুন কথোপকথন',
    plan: 'প্ল্যান',
    messagesToday: 'আজকের বার্তা',
    llmOff: 'AI API সেট নেই — SaaS Admin → Brain API-তে Free API Key দিন (অথবা সার্ভারে OPENROUTER_API_KEY)।',
    upgrade: 'আজকের সীমা শেষ। আরো বার্তার জন্য Growth প্ল্যানে আপগ্রেড করুন।',
    contextPond: 'পোন্ড ফোকাস',
    contextStation: 'স্টেশন ফোকাস',
    contextEmployee: 'কর্মচারী ফোকাস',
  },
} as const

type BrainUiLabels = (typeof UI)[keyof typeof UI]

function SourceChip({ source }: { source: BrainSource }) {
  const label = source.label || source.type || 'Source'
  if (source.url) {
    return (
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-primary hover:bg-muted"
      >
        <ExternalLink className="h-3 w-3" />
        {label}
      </a>
    )
  }
  if (source.path) {
    return (
      <Link
        href={source.path}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-primary hover:bg-muted"
      >
        {label}
      </Link>
    )
  }
  return (
    <span className="inline-flex rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

function AssistantBubble({
  message,
  labels,
}: {
  message: BrainMessage
  labels: BrainUiLabels
}) {
  const [showReasoning, setShowReasoning] = useState(false)
  const structured = message.structured || {}
  const steps = structured.reasoning_steps_bn || []

  return (
    <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-border bg-white px-4 py-3 shadow-sm">
      <p className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">{message.content}</p>
      {structured.confidence && (
        <p className="mt-2 text-xs text-muted-foreground">
          {labels.confidence}: {structured.confidence}
        </p>
      )}
      {steps.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowReasoning((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {showReasoning ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showReasoning ? labels.hideReasoning : labels.showReasoning}
          </button>
          {showReasoning && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              {steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      )}
      {(structured.sources?.length ?? 0) > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{labels.sources}</p>
          <div className="flex flex-wrap gap-1.5">
            {structured.sources!.map((s, i) => (
              <SourceChip key={`${s.type}-${s.id}-${i}`} source={s} />
            ))}
          </div>
        </div>
      )}
      {message.model_used && (
        <p className="mt-2 text-[10px] text-muted-foreground/60">{message.model_used}</p>
      )}
    </div>
  )
}

export default function BrainPage() {
  const toast = useToast()
  const searchParams = useSearchParams()
  const { language } = useCompanyLocale()
  const labels = language === 'bn' ? UI.bn : UI.en

  const contextType = searchParams.get('context_type') || ''
  const contextIdRaw = searchParams.get('context_id')
  const contextName = searchParams.get('context_name') || ''
  const initialQ = searchParams.get('q') || ''

  const [usage, setUsage] = useState<BrainUsage | null>(null)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<BrainMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoSentRef = useRef(false)

  const contextLabel =
    contextType === 'pond'
      ? labels.contextPond
      : contextType === 'station'
        ? labels.contextStation
        : contextType === 'employee'
          ? labels.contextEmployee
          : ''

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading, scrollToBottom])

  const loadStatus = useCallback(async () => {
    const res = await api.get<BrainUsage>('/brain/status/')
    setUsage(res.data)
  }, [])

  const startConversation = useCallback(async () => {
    const body: Record<string, unknown> = {}
    if (contextType && contextIdRaw) {
      const eid = parseInt(contextIdRaw, 10)
      if (Number.isFinite(eid)) {
        body.context_entity_type = contextType
        body.context_entity_id = eid
      }
    }
    if (contextName) body.title = contextName.slice(0, 120)
    const res = await api.post<{ id: number }>('/brain/conversations/', body)
    setConversationId(res.data.id)
    setMessages([])
    return res.data.id
  }, [contextType, contextIdRaw, contextName])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return

      let cid = conversationId
      if (!cid) {
        try {
          cid = await startConversation()
        } catch (e) {
          toast.error(extractErrorMessage(e))
          return
        }
      }

      setLoading(true)
      const optimistic: BrainMessage = {
        id: Date.now(),
        role: 'user',
        content: trimmed,
      }
      setMessages((prev) => [...prev, optimistic])

      try {
        const res = await api.post<{
          user_message: BrainMessage | null
          assistant_message: BrainMessage
          usage: BrainUsage
        }>(`/brain/conversations/${cid}/messages/`, { message: trimmed })

        setMessages((prev) => {
          const withoutOptimistic = prev.filter((m) => m.id !== optimistic.id)
          const userMsg = res.data.user_message ?? optimistic
          return [...withoutOptimistic, userMsg, res.data.assistant_message]
        })
        setUsage(res.data.usage)
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        toast.error(extractErrorMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [conversationId, loading, startConversation, toast],
  )

  useEffect(() => {
    ;(async () => {
      try {
        await loadStatus()
        await startConversation()
      } catch (e) {
        toast.error(extractErrorMessage(e))
      } finally {
        setBootstrapping(false)
      }
    })()
  }, [loadStatus, startConversation, toast])

  useEffect(() => {
    if (bootstrapping || !conversationId || !initialQ || autoSentRef.current || loading) return
    autoSentRef.current = true
    void sendMessage(initialQ)
  }, [bootstrapping, conversationId, initialQ, loading, sendMessage])

  const handleSend = async () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    await sendMessage(text)
  }

  const atLimit =
    usage?.daily_message_limit != null &&
    usage.messages_remaining_today != null &&
    usage.messages_remaining_today <= 0

  return (
    <PageLayout>
      <ErpPageShell title={labels.title} titleIcon={Brain} description={labels.subtitle}>
        <div className="flex h-[calc(100vh-11rem)] min-h-[28rem] flex-col rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {contextLabel && contextName ? (
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-medium text-indigo-800">
                  {contextLabel}: {contextName}
                </span>
              ) : null}
              {usage && (
                <>
                  <span>
                    {labels.plan}: <strong className="text-foreground">{usage.plan_label}</strong>
                  </span>
                  <span>
                    {labels.messagesToday}: {usage.messages_used_today}
                    {usage.daily_message_limit != null ? ` / ${usage.daily_message_limit}` : ''}
                  </span>
                </>
              )}
              {usage && !usage.llm_enabled && (
                <span className="text-warning-foreground">{labels.llmOff}</span>
              )}
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void startConversation()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {labels.newChat}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {bootstrapping ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'user' ? (
                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm text-primary-foreground">
                      {msg.content}
                    </div>
                  ) : (
                    <AssistantBubble message={msg} labels={labels} />
                  )}
                </div>
              ))
            )}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {labels.thinking}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border p-4">
            {atLimit && (
              <p className="mb-2 text-sm text-destructive">{labels.upgrade}</p>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void handleSend()
              }}
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={labels.placeholder}
                disabled={loading || atLimit}
                className="flex-1 rounded-xl border border-border px-4 py-3 text-sm focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || atLimit || !input.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {labels.send}
              </button>
            </form>
          </div>
        </div>
      </ErpPageShell>
    </PageLayout>
  )
}
