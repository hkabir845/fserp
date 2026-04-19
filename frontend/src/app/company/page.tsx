'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import {
  Building2,
  Calendar,
  Clock,
  Globe,
  Mail,
  MapPin,
  Phone,
  Save,
  User,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { getUniqueCurrencies } from '@/utils/currencies'
import {
  COMPANY_DATE_FORMAT_OPTIONS,
  COMPANY_TIME_FORMAT_OPTIONS,
  DEFAULT_COMPANY_DATE_FORMAT,
  DEFAULT_COMPANY_TIME_FORMAT,
  formatCompanyDate,
  formatCompanyTime,
} from '@/utils/companyLocaleFormats'

type CompanyForm = {
  company_name: string
  legal_name: string
  tax_id: string
  email: string
  phone: string
  contact_person: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  postal_code: string
  country: string
  currency: string
  fiscal_year_start: string
  date_format: string
  time_format: string
  subdomain: string
  custom_domain: string
}

const emptyForm = (): CompanyForm => ({
  company_name: '',
  legal_name: '',
  tax_id: '',
  email: '',
  phone: '',
  contact_person: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
  currency: 'BDT',
  fiscal_year_start: '01-01',
  date_format: DEFAULT_COMPANY_DATE_FORMAT,
  time_format: DEFAULT_COMPANY_TIME_FORMAT,
  subdomain: '',
  custom_domain: '',
})

export default function CompanyPage() {
  const router = useRouter()
  const { error: showError, success: showSuccess } = useToast()
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [formData, setFormData] = useState<CompanyForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const currencies = useMemo(() => getUniqueCurrencies(), [])

  const fetchCompany = useCallback(async () => {
    try {
      const { data } = await api.get<Record<string, unknown>>('/companies/current/')
      if (!data || typeof data.id !== 'number') {
        setCompanyId(null)
        setFormData(emptyForm())
        return
      }
      const id = data.id as number
      setCompanyId(id)
      setDisplayName(String(data.company_name || data.name || 'Company'))
      setFormData({
        company_name: String(data.company_name || data.name || ''),
        legal_name: String(data.legal_name ?? ''),
        tax_id: String(data.tax_id ?? ''),
        email: String(data.email ?? ''),
        phone: String(data.phone ?? ''),
        contact_person: String(data.contact_person ?? ''),
        address_line1: String(data.address_line1 ?? ''),
        address_line2: String(data.address_line2 ?? ''),
        city: String(data.city ?? ''),
        state: String(data.state ?? ''),
        postal_code: String(data.postal_code ?? ''),
        country: String(data.country ?? ''),
        currency: String(data.currency || 'BDT').slice(0, 3),
        fiscal_year_start: String(data.fiscal_year_start || '01-01').slice(0, 5),
        date_format: String(data.date_format || DEFAULT_COMPANY_DATE_FORMAT),
        time_format: String(data.time_format || DEFAULT_COMPANY_TIME_FORMAT),
        subdomain: String(data.subdomain ?? ''),
        custom_domain: String(data.custom_domain ?? ''),
      })
    } catch (e) {
      console.error('Error fetching company:', e)
      showError('Failed to load company information')
      setCompanyId(null)
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    void fetchCompany()
  }, [router, fetchCompany])

  const updateField = <K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!companyId) {
      showError('No company to update')
      return
    }
    const name = formData.company_name.trim()
    if (!name) {
      showError('Company name is required')
      return
    }

    setSaving(true)
    try {
      const payload = {
        company_name: name,
        legal_name: formData.legal_name.trim(),
        tax_id: formData.tax_id.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        contact_person: formData.contact_person.trim(),
        address_line1: formData.address_line1.trim(),
        address_line2: formData.address_line2.trim(),
        city: formData.city.trim(),
        state: formData.state.trim(),
        postal_code: formData.postal_code.trim(),
        country: formData.country.trim(),
        currency: formData.currency.trim().slice(0, 3) || 'BDT',
        fiscal_year_start: formData.fiscal_year_start.trim().slice(0, 5) || '01-01',
        date_format: formData.date_format,
        time_format: formData.time_format,
        subdomain: formData.subdomain.trim(),
        custom_domain: formData.custom_domain.trim(),
      }

      const { data } = await api.put<Record<string, unknown>>(`/companies/${companyId}/`, payload)
      if (data) {
        setDisplayName(String(data.company_name || data.name || name))
        showSuccess('Company settings saved')
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('fserp-company-settings-saved'))
        }
        await fetchCompany()
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      console.error('Error updating company:', error)
      showError(err.response?.data?.detail || 'Failed to update company')
    } finally {
      setSaving(false)
    }
  }

  const previewDate = '2026-06-15'
  const previewTime = new Date('2026-01-01T14:30:00')

  const addressSummary = [
    formData.address_line1,
    [formData.city, formData.state, formData.postal_code].filter(Boolean).join(', '),
    formData.country,
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n')

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 bg-slate-50 page-with-sidebar">
      <Sidebar />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <header className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-blue-600">Tenant</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Company profile</h1>
              <p className="mt-2 max-w-2xl text-slate-600">
                Legal identity, address, currency, and how dates and times appear across the ERP.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !companyId}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </header>

          {!companyId ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-900">
              <p className="font-medium">No company is linked to this session.</p>
              <p className="mt-2 text-sm text-amber-800/90">
                Ask a Super Admin to assign your user to a company, or sign in with a tenant account.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
              <aside className="lg:col-span-4">
                <div className="sticky top-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="bg-gradient-to-br from-blue-600 to-indigo-700 px-6 py-8 text-white">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                      <Building2 className="h-9 w-9" />
                    </div>
                    <h2 className="text-center text-xl font-bold leading-snug">{displayName || 'Company'}</h2>
                    {formData.legal_name ? (
                      <p className="mt-2 text-center text-sm text-blue-100">{formData.legal_name}</p>
                    ) : null}
                  </div>
                  <div className="space-y-4 px-6 py-6 text-sm text-slate-600">
                    {formData.email ? (
                      <div className="flex gap-3">
                        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <span className="break-all">{formData.email}</span>
                      </div>
                    ) : null}
                    {formData.phone ? (
                      <div className="flex gap-3">
                        <Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <span>{formData.phone}</span>
                      </div>
                    ) : null}
                    {addressSummary ? (
                      <div className="flex gap-3">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <span className="whitespace-pre-line">{addressSummary}</span>
                      </div>
                    ) : (
                      <p className="text-slate-400">Add an address in the form →</p>
                    )}
                  </div>
                </div>
              </aside>

              <div className="space-y-6 lg:col-span-8">
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">Legal & identity</h3>
                  <p className="mt-1 text-sm text-slate-500">Registered name and tax identifiers.</p>
                  <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Company name *</label>
                      <input
                        type="text"
                        value={formData.company_name}
                        onChange={(e) => updateField('company_name', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Legal name</label>
                      <input
                        type="text"
                        value={formData.legal_name}
                        onChange={(e) => updateField('legal_name', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Tax / BIN / VAT ID</label>
                      <input
                        type="text"
                        value={formData.tax_id}
                        onChange={(e) => updateField('tax_id', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-violet-50 p-2 text-violet-700">
                      <Calendar className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Regional & display</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Currency for money fields, and how dates/times render in lists and reports.
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Currency</label>
                      <select
                        value={formData.currency}
                        onChange={(e) => updateField('currency', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        {currencies.map((c) => (
                          <option key={`${c.code}-${c.country}`} value={c.code}>
                            {c.code} — {c.name} ({c.country})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Fiscal year starts</label>
                      <input
                        type="text"
                        value={formData.fiscal_year_start}
                        onChange={(e) => updateField('fiscal_year_start', e.target.value)}
                        placeholder="MM-DD"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <p className="mt-1 text-xs text-slate-500">Month-day, e.g. 07-01 for July 1.</p>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Date format</label>
                      <select
                        value={formData.date_format}
                        onChange={(e) => updateField('date_format', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        {COMPANY_DATE_FORMAT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label} — e.g. {o.example}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Time format</label>
                      <select
                        value={formData.time_format}
                        onChange={(e) => updateField('time_format', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        {COMPANY_TIME_FORMAT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label} — e.g. {o.example}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <span className="font-medium text-slate-600">Preview:</span>
                      <span className="rounded-md bg-white px-2 py-1 font-mono shadow-sm">
                        {formatCompanyDate(previewDate, formData.date_format)}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="rounded-md bg-white px-2 py-1 font-mono shadow-sm">
                        {formatCompanyTime(previewTime, formData.time_format)}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">Address</h3>
                  <p className="mt-1 text-sm text-slate-500">Used on documents and compliance screens.</p>
                  <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Address line 1</label>
                      <input
                        type="text"
                        value={formData.address_line1}
                        onChange={(e) => updateField('address_line1', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Address line 2</label>
                      <input
                        type="text"
                        value={formData.address_line2}
                        onChange={(e) => updateField('address_line2', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">City</label>
                      <input
                        type="text"
                        value={formData.city}
                        onChange={(e) => updateField('city', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">State / region</label>
                      <input
                        type="text"
                        value={formData.state}
                        onChange={(e) => updateField('state', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Postal code</label>
                      <input
                        type="text"
                        value={formData.postal_code}
                        onChange={(e) => updateField('postal_code', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Country</label>
                      <input
                        type="text"
                        value={formData.country}
                        onChange={(e) => updateField('country', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">Contact</h3>
                  <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700">
                        <Mail className="h-4 w-4 text-slate-400" /> Email
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => updateField('email', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700">
                        <Phone className="h-4 w-4 text-slate-400" /> Phone
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => updateField('phone', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700">
                        <User className="h-4 w-4 text-slate-400" /> Primary contact
                      </label>
                      <input
                        type="text"
                        value={formData.contact_person}
                        onChange={(e) => updateField('contact_person', e.target.value)}
                        placeholder="Name for correspondence"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start gap-3">
                    <Globe className="mt-0.5 h-5 w-5 text-slate-500" />
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Online presence</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Subdomain and custom domain for multi-tenant routing. Changing these can affect how users reach
                        this tenant — coordinate with your administrator.
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Subdomain</label>
                      <input
                        type="text"
                        value={formData.subdomain}
                        onChange={(e) => updateField('subdomain', e.target.value.toLowerCase())}
                        placeholder="your-tenant"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Custom domain</label>
                      <input
                        type="text"
                        value={formData.custom_domain}
                        onChange={(e) => updateField('custom_domain', e.target.value.toLowerCase())}
                        placeholder="erp.example.com"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
