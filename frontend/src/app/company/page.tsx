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
  Layers,
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
import {
  COMPANY_TIME_ZONE_OPTIONS,
  DEFAULT_COMPANY_TIME_ZONE,
  isKnownCompanyTimeZone,
} from '@/utils/timeZones'

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
  /** IANA, e.g. Asia/Dhaka */
  time_zone: string
  /** single = one site; multi = many stations */
  station_mode: 'single' | 'multi'
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
  time_zone: DEFAULT_COMPANY_TIME_ZONE,
  station_mode: 'single',
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
  const [canEditStationMode, setCanEditStationMode] = useState(false)
  const [activeStationCount, setActiveStationCount] = useState<number | null>(null)
  const [aquacultureLicensed, setAquacultureLicensed] = useState(false)
  const [aquacultureEnabled, setAquacultureEnabled] = useState(false)
  const [canEditAquacultureToggle, setCanEditAquacultureToggle] = useState(false)

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
      const ext = data as {
        can_edit_station_mode?: boolean
        active_station_count?: number
        aquaculture_licensed?: boolean
        aquaculture_enabled?: boolean
        can_edit_aquaculture_toggle?: boolean
      }
      setCanEditStationMode(Boolean(ext.can_edit_station_mode))
      setActiveStationCount(
        typeof ext.active_station_count === 'number' ? ext.active_station_count : null
      )
      setAquacultureLicensed(Boolean(ext.aquaculture_licensed))
      setAquacultureEnabled(Boolean(ext.aquaculture_enabled))
      setCanEditAquacultureToggle(Boolean(ext.can_edit_aquaculture_toggle))
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
        time_zone: String(
          (data as { time_zone?: string }).time_zone || DEFAULT_COMPANY_TIME_ZONE
        ).trim() || DEFAULT_COMPANY_TIME_ZONE,
        station_mode: String((data as { station_mode?: string }).station_mode ?? 'single').toLowerCase() === 'multi'
          ? 'multi'
          : 'single',
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
      const payload: Record<string, unknown> = {
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
        time_zone: formData.time_zone,
        subdomain: formData.subdomain.trim(),
        custom_domain: formData.custom_domain.trim(),
      }
      if (canEditStationMode) {
        payload.station_mode = formData.station_mode
      }
      if (aquacultureLicensed && canEditAquacultureToggle) {
        payload.aquaculture_enabled = aquacultureEnabled
      }

      const { data } = await api.put<Record<string, unknown>>(`/companies/${companyId}/`, payload)
      if (data) {
        setDisplayName(String(data.company_name || data.name || name))
        let msg = 'Company settings saved'
        const aqCoa = data.aquaculture_chart_accounts_created
        if (typeof aqCoa === 'number' && aqCoa > 0) {
          msg = `${msg} Aquaculture: ${aqCoa} new chart of account line(s) were added.`
        }
        showSuccess(msg)
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
                Legal identity, address, currency, site preference (who may run one vs many active locations), and how
                dates and times appear across the ERP.
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
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-6 md:p-8 text-center text-amber-900">
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
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Time zone</label>
                      <select
                        value={formData.time_zone}
                        onChange={(e) => updateField('time_zone', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        {COMPANY_TIME_ZONE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                        {formData.time_zone && !isKnownCompanyTimeZone(formData.time_zone) && (
                          <option value={formData.time_zone}>
                            {formData.time_zone} (current)
                          </option>
                        )}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">
                        Default: Dhaka (Bangladesh), IANA name. Used for business &ldquo;today&rdquo; and local context across the app.
                      </p>
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
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-amber-50 p-2 text-amber-800">
                      <Layers className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Site model</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Saved preference for how many <span className="font-medium text-slate-600">active</span> sites you
                        may run. POS, transfers, and report auto-scope still follow{' '}
                        <span className="font-medium text-slate-600">how many stations are active right now</span>
                        {activeStationCount !== null ? (
                          <>
                            {' '}
                            (<span className="font-mono tabular-nums">{activeStationCount}</span> active)
                          </>
                        ) : null}
                        . In single-site mode you may still keep closed sites as inactive rows for history. Manage sites on{' '}
                        <a href="/stations" className="font-medium text-blue-600 hover:text-blue-800">
                          Stations
                        </a>
                        .
                      </p>
                      {!canEditStationMode ? (
                        <p className="mt-2 text-sm text-amber-900/90 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                          Only a platform Super Admin can change single vs multiple stations. Contact support if this
                          tenant-wide setting must be updated.
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <fieldset disabled={!canEditStationMode} className="mt-6 space-y-3 disabled:opacity-60">
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 hover:bg-slate-50">
                      <input
                        type="radio"
                        name="station_mode"
                        className="mt-1"
                        checked={formData.station_mode === 'multi'}
                        onChange={() => updateField('station_mode', 'multi')}
                      />
                      <div>
                        <p className="font-medium text-slate-900">Multiple stations</p>
                        <p className="text-sm text-slate-600">
                          Default. Use a separate station for each site; filters and reports can split by location.
                        </p>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 hover:bg-slate-50">
                      <input
                        type="radio"
                        name="station_mode"
                        className="mt-1"
                        checked={formData.station_mode === 'single'}
                        onChange={() => updateField('station_mode', 'single')}
                      />
                      <div>
                        <p className="font-medium text-slate-900">Single site</p>
                        <p className="text-sm text-slate-600">
                          At most one <span className="font-medium">active</span> station. Extra rows can stay as inactive
                          (archived). You cannot save this if more than one site is still active—deactivate sold/closed
                          locations on Stations first.
                        </p>
                      </div>
                    </label>
                  </fieldset>
                </section>

                {aquacultureLicensed ? (
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-teal-50 p-2 text-teal-800">
                        <Layers className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-semibold text-slate-900">Aquaculture</h3>
                        <p className="mt-1 text-sm leading-relaxed text-slate-500">
                          Your organization is licensed for Aquaculture. Turn it on here to show Aquaculture in the app
                          menu and use ponds, sales, sampling, and pond P&amp;L.                           New ponds receive a POS customer automatically for Cashier on-account sales; inventoried
                          supplies to ponds should flow through POS. Fuel-only sites can leave this off.
                        </p>
                        {!canEditAquacultureToggle ? (
                          <p className="mt-3 text-sm text-amber-900/90 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                            Only the company <span className="font-medium">Admin</span> can enable or disable
                            Aquaculture in these settings.
                          </p>
                        ) : null}
                        {canEditAquacultureToggle ? (
                          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 hover:bg-slate-50">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={aquacultureEnabled}
                              onChange={(e) => setAquacultureEnabled(e.target.checked)}
                            />
                            <div>
                              <p className="font-medium text-slate-900">Use Aquaculture in this company</p>
                              <p className="text-sm leading-relaxed text-slate-600">
                                When checked, Aquaculture appears for the Admin in the sidebar and apps. Other roles
                                continue with fuel station and retail only.
                              </p>
                            </div>
                          </label>
                        ) : (
                          <p className="mt-4 text-sm font-medium text-slate-700">
                            Status:{' '}
                            <span className={aquacultureEnabled ? 'text-teal-800' : 'text-slate-600'}>
                              {aquacultureEnabled ? 'On' : 'Off'}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  </section>
                ) : null}

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
