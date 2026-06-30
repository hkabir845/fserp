'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Setting {
  key: string
  value: string
  value_type: string
  category: string
  description?: string
}

export default function SettingsGeneralPage() {
  const queryClient = useQueryClient()
  const [editingSetting, setEditingSetting] = useState<string | null>(null)

  const { data: settings = [], isLoading: settingsLoading } = useQuery<Setting[]>({
    queryKey: ['tenant-settings'],
    queryFn: async () => {
      const response = await api.get('/settings')
      return response.data
    },
  })

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      return api.put(`/settings/${key}`, { value, value_type: 'string' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-settings'] })
      setEditingSetting(null)
    },
  })

  const handleSaveSetting = (key: string, value: string) => {
    updateSettingMutation.mutate({ key, value })
  }

  const defaultSettings: Record<string, { value: string; category: string; description: string }> = {
    company_name: { value: '', category: 'general', description: 'Company legal name' },
    company_address: { value: '', category: 'general', description: 'Registered / mailing address' },
    company_phone: { value: '', category: 'general', description: 'Company phone number' },
    company_email: { value: '', category: 'general', description: 'Company email' },
    company_website: { value: '', category: 'general', description: 'Company website' },
    default_language: { value: 'en', category: 'system', description: 'UI language (e.g. en, bn)' },
    locale: { value: 'en-BD', category: 'system', description: 'BCP 47 locale for dates/numbers (e.g. en-BD, en-US)' },
    default_timezone: { value: 'Asia/Dhaka', category: 'system', description: 'IANA timezone for scheduling & timestamps' },
    date_format: { value: 'DD/MM/YYYY', category: 'system', description: 'Display date pattern (DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY)' },
    time_format: { value: '24h', category: 'system', description: '12h or 24h clock for displays' },
    first_day_of_week: { value: 'monday', category: 'system', description: 'Calendar week start (monday or sunday)' },
    number_grouping: { value: 'standard', category: 'system', description: 'Number formatting: standard, indian' },
    default_batch_size: { value: '1000', category: 'feed_manufacturing', description: 'Default production batch size (kg)' },
    default_loss_factor: { value: '2.0', category: 'feed_manufacturing', description: 'Default loss factor percentage' },
  }

  const allSettings = Object.entries(defaultSettings).map(([key, defaultSetting]) => {
    const existing = settings.find((s) => s.key === key)
    return (
      existing || {
        key,
        value: defaultSetting.value,
        value_type: 'string',
        category: defaultSetting.category,
        description: defaultSetting.description,
      }
    )
  })

  const allSettingsByCategory = allSettings.reduce(
    (acc, setting) => {
      if (!acc[setting.category]) {
        acc[setting.category] = []
      }
      acc[setting.category].push(setting)
      return acc
    },
    {} as Record<string, Setting[]>
  )

  if (settingsLoading) {
    return <div className="text-sm text-muted-foreground">Loading settings…</div>
  }

  return (
    <div className="space-y-6">
      {Object.entries(allSettingsByCategory).map(([category, categorySettings]) => (
        <div key={category} className="rounded-lg bg-white shadow">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold capitalize text-foreground">
              {category.replace('_', ' ')}
            </h2>
          </div>
          <div className="space-y-4 px-6 py-4">
            {categorySettings.map((setting) => (
              <div key={setting.key} className="flex items-center justify-between">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-foreground/85">
                    {setting.key.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                  </label>
                  {setting.description && <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>}
                </div>
                <div className="ml-4 flex items-center gap-2">
                  {editingSetting === setting.key ? (
                    <>
                      <input
                        type="text"
                        defaultValue={setting.value}
                        onBlur={(e) => {
                          if (e.target.value !== setting.value) {
                            handleSaveSetting(setting.key, e.target.value)
                          } else {
                            setEditingSetting(null)
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleSaveSetting(setting.key, e.currentTarget.value)
                          } else if (e.key === 'Escape') {
                            setEditingSetting(null)
                          }
                        }}
                        autoFocus
                        className="rounded-md border border-border px-3 py-2 text-sm focus:border-ring focus:ring-ring"
                      />
                    </>
                  ) : (
                    <>
                      <span className="min-w-[200px] text-right text-sm text-foreground">
                        {setting.value || '-'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingSetting(setting.key)}
                        className="text-primary hover:text-foreground/85"
                        aria-label={`Edit ${setting.key}`}
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
