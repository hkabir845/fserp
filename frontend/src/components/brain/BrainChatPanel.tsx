'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { useToast } from '@/components/Toast'
import api, { fetchCurrentCompany, isApiSessionError } from '@/lib/api'
import { hasStoredSession } from '@/lib/authSession'
import { extractErrorMessage } from '@/utils/errorHandler'
import { Brain, ChevronDown, ChevronUp, ExternalLink, Loader2, Mic, MicOff, Send } from 'lucide-react'
import { useSpeechRecognition, type SpeechVoiceLang } from '@/hooks/useSpeechRecognition'

export type BrainSource = {
  kind?: string
  type?: string
  id?: number | null
  label?: string
  path?: string | null
  url?: string | null
}

export type BrainStructured = {
  answer_bn?: string
  reasoning_steps_bn?: string[]
  confidence?: string
  sources?: BrainSource[]
  missing_inputs?: { key?: string; prompt_bn?: string }[]
  suggested_actions?: { action?: string; label_bn?: string; requires_approval?: boolean }[]
}

export type BrainMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  structured?: BrainStructured
  model_used?: string
  created_at?: string
}

export type BrainUsage = {
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
    subtitle: 'Your AI colleague — Bangla answers, understands Banglish & English, ChatGPT-style chat + business data.',
    placeholder: 'Banglish OK: ajker sales kemon, profit koto… or chat about anything…',
    send: 'Send',
    thinking: 'Thinking…',
    showReasoning: 'Show reasoning',
    hideReasoning: 'Hide reasoning',
    sources: 'Sources',
    confidence: 'Confidence',
    newChat: 'New conversation',
    plan: 'Plan',
    messagesToday: 'Messages today',
    llmOff: 'AI API not configured — add a Free API key in SaaS Admin → Brain API.',
    upgrade: 'Daily limit reached. Upgrade to Growth for more messages.',
    contextPond: 'Focused on pond',
    contextStation: 'Focused on station',
    contextEmployee: 'Focused on employee',
    voiceListen: 'Voice (Bangla / English)',
    voiceStop: 'Stop listening',
    voiceBn: 'BN',
    voiceEn: 'EN',
    voiceUnsupported: 'Voice input needs Chrome or Edge on HTTPS.',
    voiceDenied: 'Microphone permission denied.',
    voiceNoSpeech: 'No speech detected — try again.',
    voiceListening: 'Listening…',
  },
  bn: {
    title: 'কোম্পানি ব্রেইন',
    subtitle: 'বাংলায় উত্তর — বাংলিশ/ইংরেজি বুঝি, ChatGPT-এর মতো কথা বলি + ব্যবসার ডেটা।',
    placeholder: 'বাংলিশ চলবে: ajker sales kemon, profit koto… বা যেকোনো কথা…',
    send: 'পাঠান',
    thinking: 'চিন্তা করছে…',
    showReasoning: 'যুক্তি দেখুন',
    hideReasoning: 'যুক্তি লুকান',
    sources: 'তথ্যসূত্র',
    confidence: 'আত্মবিশ্বাস',
    newChat: 'নতুন কথোপকথন',
    plan: 'প্ল্যান',
    messagesToday: 'আজকের বার্তা',
    llmOff: 'AI API সেট নেই — SaaS Admin → Brain API-তে Free API Key দিন।',
    upgrade: 'আজকের সীমা শেষ। Growth প্ল্যানে আপগ্রেড করুন।',
    contextPond: 'পোন্ড ফোকাস',
    contextStation: 'স্টেশন ফোকাস',
    contextEmployee: 'কর্মচারী ফোকাস',
    voiceListen: 'ভয়েস (বাংলা / ইংরেজি)',
    voiceStop: 'শোনা বন্ধ করুন',
    voiceBn: 'বাং',
    voiceEn: 'EN',
    voiceUnsupported: 'ভয়েসের জন্য HTTPS-এ Chrome বা Edge লাগবে।',
    voiceDenied: 'মাইক্রোফোন অনুমতি দেওয়া হয়নি।',
    voiceNoSpeech: 'কথা শোনা যায়নি — আবার চেষ্টা করুন।',
    voiceListening: 'শুনছি…',
  },
} as const

export type BrainUiLabels = (typeof UI)[keyof typeof UI]

function SourceChip({ source, standalone }: { source: BrainSource; standalone?: boolean }) {
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
  if (source.path && !standalone) {
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
  standalone,
}: {
  message: BrainMessage
  labels: BrainUiLabels
  standalone?: boolean
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
              <SourceChip key={`${s.type}-${s.id}-${i}`} source={s} standalone={standalone} />
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

export type BrainChatPanelProps = {
  standalone?: boolean
  className?: string
}

export function BrainChatPanel({ standalone = false, className = '' }: BrainChatPanelProps) {
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
  const [voiceLang, setVoiceLang] = useState<SpeechVoiceLang>(language === 'bn' ? 'bn' : 'en')
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoSentRef = useRef(false)
  const voiceSendPendingRef = useRef(false)

  useEffect(() => {
    setVoiceLang(language === 'bn' ? 'bn' : 'en')
  }, [language])

  const { supported: voiceSupported, listening, start: startVoice, stop: stopVoice } = useSpeechRecognition({
    voiceLang,
    onInterim: (text) => setInput(text),
    onFinal: (text) => setInput(text),
    onEnd: (text) => {
      if (text) {
        voiceSendPendingRef.current = true
        setInput(text)
      }
    },
    onError: (code) => {
      if (code === 'not-allowed') toast.error(labels.voiceDenied)
      else if (code === 'no-speech') toast.error(labels.voiceNoSpeech)
    },
  })

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
          if (!isApiSessionError(e)) {
            toast.error(extractErrorMessage(e))
          }
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
        if (!isApiSessionError(e)) {
          toast.error(extractErrorMessage(e))
        }
      } finally {
        setLoading(false)
      }
    },
    [conversationId, loading, startConversation, toast],
  )

  useEffect(() => {
    if (!hasStoredSession()) {
      setBootstrapping(false)
      return
    }
    ;(async () => {
      try {
        await loadStatus()
        await startConversation()
      } catch (e) {
        if (!isApiSessionError(e)) {
          toast.error(extractErrorMessage(e))
        }
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

  const atLimit =
    usage?.daily_message_limit != null &&
    usage.messages_remaining_today != null &&
    usage.messages_remaining_today <= 0

  const handleSend = async () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    await sendMessage(text)
  }

  useEffect(() => {
    if (!voiceSendPendingRef.current || listening || loading || atLimit) return
    const text = input.trim()
    if (!text) {
      voiceSendPendingRef.current = false
      return
    }
    voiceSendPendingRef.current = false
    setInput('')
    void sendMessage(text)
  }, [input, listening, loading, atLimit, sendMessage])

  const toggleVoice = () => {
    if (!voiceSupported) {
      toast.error(labels.voiceUnsupported)
      return
    }
    if (listening) {
      stopVoice()
      return
    }
    voiceSendPendingRef.current = false
    const started = startVoice()
    if (!started) {
      toast.error(labels.voiceUnsupported)
    }
  }

  const heightClass = standalone
    ? 'h-[calc(100dvh-3.5rem)] min-h-0'
    : 'h-[calc(100vh-11rem)] min-h-[28rem]'

  return (
    <div
      className={`flex flex-col rounded-xl border border-border bg-card shadow-sm ${heightClass} ${className}`}
    >
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
        ) : messages.length === 0 && !loading ? (
          <div className="mx-auto max-w-md py-8 text-center text-sm text-muted-foreground">
            <Brain className="mx-auto mb-3 h-10 w-10 text-indigo-500" />
            <p>{labels.subtitle}</p>
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
                <AssistantBubble message={msg} labels={labels} standalone={standalone} />
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
        {atLimit && <p className="mb-2 text-sm text-destructive">{labels.upgrade}</p>}
        {listening && (
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            {labels.voiceListening}
          </p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSend()
          }}
        >
          {voiceSupported && (
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                title={listening ? labels.voiceStop : labels.voiceListen}
                disabled={loading || atLimit}
                onClick={toggleVoice}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border transition-colors disabled:opacity-50 ${
                  listening
                    ? 'border-destructive bg-destructive/10 text-destructive'
                    : 'border-border hover:bg-muted'
                }`}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <div className="flex overflow-hidden rounded-lg border border-border text-[10px] font-semibold">
                <button
                  type="button"
                  disabled={listening || loading || atLimit}
                  onClick={() => setVoiceLang('bn')}
                  className={`px-2 py-1 ${voiceLang === 'bn' ? 'bg-primary text-primary-foreground' : 'bg-muted/30 text-muted-foreground'}`}
                >
                  {labels.voiceBn}
                </button>
                <button
                  type="button"
                  disabled={listening || loading || atLimit}
                  onClick={() => setVoiceLang('en')}
                  className={`px-2 py-1 ${voiceLang === 'en' ? 'bg-primary text-primary-foreground' : 'bg-muted/30 text-muted-foreground'}`}
                >
                  {labels.voiceEn}
                </button>
              </div>
            </div>
          )}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={labels.placeholder}
            disabled={loading || atLimit}
            className="min-w-0 flex-1 rounded-xl border border-border px-4 py-3 text-sm focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || atLimit || !input.trim()}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            <span className="hidden sm:inline">{labels.send}</span>
          </button>
        </form>
      </div>
    </div>
  )
}

export function brainUiLabels(lang: 'en' | 'bn'): BrainUiLabels {
  return lang === 'bn' ? UI.bn : UI.en
}
