'use client'

/**
 * SaaS Super Admin — Company Brain API keys (free tier + paid vendor).
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { useRequireSaasDashboardMode } from '@/hooks/useRequireSaasDashboardMode'
import { useToast } from '@/components/Toast'
import api, { isSuperAdminRole } from '@/lib/api'
import { safeLogError } from '@/utils/connectionError'
import { Brain, Eye, EyeOff, Loader2, Save } from 'lucide-react'

type BrainConfig = {
  free_api_key_set: boolean
  free_api_key_masked: string
  vendor_api_key_set: boolean
  vendor_api_key_masked: string
  free_model_reasoning: string
  vendor_model_reasoning: string
  vendor_model_research: string
  env_fallback_configured: boolean
  env_fallback_masked: string
  llm_ready_free: boolean
  llm_ready_vendor: boolean
  updated_at: string | null
}

const EMPTY_FORM = {
  free_api_key: '',
  vendor_api_key: '',
  free_model_reasoning: 'google/gemini-2.0-flash-001',
  vendor_model_reasoning: 'anthropic/claude-3.5-sonnet',
  vendor_model_research: 'perplexity/sonar',
}

function SaasBrainSettingsContent() {
  useRequireSaasDashboardMode()
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<BrainConfig | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showFreeKey, setShowFreeKey] = useState(false)
  const [showVendorKey, setShowVendorKey] = useState(false)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
    if (!token) {
      router.push('/login')
      return
    }
    let u: { role?: string } | null = null
    try {
      const raw = localStorage.getItem('user')
      if (raw && raw !== 'undefined') u = JSON.parse(raw)
    } catch {
      /* ignore */
    }
    const r = (u?.role || '').toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
    if (!isSuperAdminRole(r)) {
      router.replace('/brain')
      return
    }

    const load = async () => {
      try {
        const res = await api.get('/admin/brain-config/')
        const data = res.data as BrainConfig
        setConfig(data)
        setForm({
          free_api_key: '',
          vendor_api_key: '',
          free_model_reasoning: data.free_model_reasoning || EMPTY_FORM.free_model_reasoning,
          vendor_model_reasoning: data.vendor_model_reasoning || EMPTY_FORM.vendor_model_reasoning,
          vendor_model_research: data.vendor_model_research || EMPTY_FORM.vendor_model_research,
        })
      } catch (e) {
        safeLogError('brain config load', e)
        toast.error('Could not load Brain API settings')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [router, toast])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: Record<string, string> = {
        free_model_reasoning: form.free_model_reasoning.trim(),
        vendor_model_reasoning: form.vendor_model_reasoning.trim(),
        vendor_model_research: form.vendor_model_research.trim(),
      }
      if (form.free_api_key.trim()) payload.free_api_key = form.free_api_key.trim()
      if (form.vendor_api_key.trim()) payload.vendor_api_key = form.vendor_api_key.trim()

      const res = await api.put('/admin/brain-config/', payload)
      const data = res.data as BrainConfig
      setConfig(data)
      setForm((f) => ({ ...f, free_api_key: '', vendor_api_key: '' }))
      toast.success('Brain API settings saved')
    } catch (e) {
      safeLogError('brain config save', e)
      toast.error('Could not save Brain API settings')
    } finally {
      setSaving(false)
    }
  }

  const handleClearKey = async (field: 'free_api_key' | 'vendor_api_key') => {
    if (!confirm(field === 'free_api_key' ? 'Clear free API key?' : 'Clear vendor API key?')) return
    setSaving(true)
    try {
      const res = await api.put('/admin/brain-config/', { [field]: '' })
      setConfig(res.data as BrainConfig)
      setForm((f) => ({ ...f, [field]: '' }))
      toast.success('Key cleared')
    } catch (e) {
      safeLogError('brain config clear', e)
      toast.error('Could not clear key')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <PageLayout>
      <div className="mx-auto max-w-2xl app-scroll-pad">
        <div className="mb-8 flex items-start gap-3">
          <div className="rounded-lg bg-indigo-100 p-3">
            <Brain className="h-8 w-8 text-indigo-700" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">SaaS platform</p>
            <h1 className="text-3xl font-bold text-foreground">Company Brain API</h1>
            <p className="mt-1 text-muted-foreground">
              One place for AI keys. Free key powers free-tier tenants; vendor key powers Growth/Enterprise with web
              research.
            </p>
          </div>
        </div>

        {config && (
          <div className="mb-6 flex flex-wrap gap-2 text-sm">
            <span
              className={`rounded-full px-3 py-1 ${config.llm_ready_free ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}
            >
              Free tier: {config.llm_ready_free ? 'ready' : 'no key'}
            </span>
            <span
              className={`rounded-full px-3 py-1 ${config.llm_ready_vendor ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}`}
            >
              Paid vendor: {config.llm_ready_vendor ? 'ready' : 'not set (optional for now)'}
            </span>
            {config.env_fallback_configured && (
              <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">
                Server env fallback: {config.env_fallback_masked || 'set'}
              </span>
            )}
          </div>
        )}

        <div className="space-y-6 rounded-xl border border-border bg-white p-6 shadow-sm">
          <section>
            <h2 className="text-lg font-semibold text-foreground">Free API key (start here)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Get a key from{' '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-primary underline">
                openrouter.ai/keys
              </a>{' '}
              — free credits work with Gemini Flash. Paste below to test Brain for any company on the free plan.
            </p>
            {config?.free_api_key_set && (
              <p className="mt-2 font-mono text-xs text-muted-foreground">Current: {config.free_api_key_masked}</p>
            )}
            <div className="relative mt-3">
              <input
                type={showFreeKey ? 'text' : 'password'}
                value={form.free_api_key}
                onChange={(e) => setForm({ ...form, free_api_key: e.target.value })}
                placeholder={config?.free_api_key_set ? 'Enter new key to replace' : 'sk-or-v1-...'}
                className="w-full rounded-lg border border-border px-3 py-2 pr-10 font-mono text-sm"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowFreeKey((v) => !v)}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                aria-label="Toggle visibility"
              >
                {showFreeKey ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            {config?.free_api_key_set && (
              <button
                type="button"
                onClick={() => void handleClearKey('free_api_key')}
                className="mt-2 text-xs text-destructive hover:underline"
              >
                Clear free key
              </button>
            )}
            <label className="mt-4 block text-sm font-medium">Free model (reasoning)</label>
            <input
              type="text"
              value={form.free_model_reasoning}
              onChange={(e) => setForm({ ...form, free_model_reasoning: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 font-mono text-sm"
            />
          </section>

          <section className="border-t border-border pt-6">
            <h2 className="text-lg font-semibold text-foreground">Vendor paid API key (later)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              When you upgrade tenants to Growth/Enterprise, add your paid OpenRouter key here for stronger models and
              live web research (Perplexity Sonar).
            </p>
            {config?.vendor_api_key_set && (
              <p className="mt-2 font-mono text-xs text-muted-foreground">Current: {config.vendor_api_key_masked}</p>
            )}
            <div className="relative mt-3">
              <input
                type={showVendorKey ? 'text' : 'password'}
                value={form.vendor_api_key}
                onChange={(e) => setForm({ ...form, vendor_api_key: e.target.value })}
                placeholder="Leave blank until you have a paid key"
                className="w-full rounded-lg border border-border px-3 py-2 pr-10 font-mono text-sm"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowVendorKey((v) => !v)}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                aria-label="Toggle visibility"
              >
                {showVendorKey ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            {config?.vendor_api_key_set && (
              <button
                type="button"
                onClick={() => void handleClearKey('vendor_api_key')}
                className="mt-2 text-xs text-destructive hover:underline"
              >
                Clear vendor key
              </button>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium">Paid reasoning model</label>
                <input
                  type="text"
                  value={form.vendor_model_reasoning}
                  onChange={(e) => setForm({ ...form, vendor_model_reasoning: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Web research model</label>
                <input
                  type="text"
                  value={form.vendor_model_research}
                  onChange={(e) => setForm({ ...form, vendor_model_research: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 font-mono text-sm"
                />
              </div>
            </div>
          </section>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save settings
          </button>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          After saving, open <strong>/brain</strong> in any tenant company to test. Free plan uses the free key; Growth
          uses the vendor key when set (otherwise falls back to free key).
        </p>
      </div>
    </PageLayout>
  )
}

export default function SaasBrainSettingsPage() {
  return (
    <CompanyProvider>
      <SaasBrainSettingsContent />
    </CompanyProvider>
  )
}
