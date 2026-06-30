'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { CurrencyModal, type PlatformCurrency } from '../modals'

export default function PlatformSettingsCurrenciesPage() {
  const queryClient = useQueryClient()
  const [editingCurrency, setEditingCurrency] = useState<PlatformCurrency | null>(null)
  const [showCurrencyModal, setShowCurrencyModal] = useState(false)

  const { data: currencies = [], isLoading } = useQuery<PlatformCurrency[]>({
    queryKey: ['platform-currencies'],
    queryFn: async () => {
      const response = await api.get('/platform/currencies')
      return response.data
    },
  })

  const createCurrencyMutation = useMutation({
    mutationFn: async (data: Partial<PlatformCurrency>) => {
      return api.post('/platform/currencies', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-currencies'] })
      setShowCurrencyModal(false)
      setEditingCurrency(null)
    },
  })

  const updateCurrencyMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<PlatformCurrency> & { id: number }) => {
      return api.put(`/platform/currencies/${id}`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-currencies'] })
      setEditingCurrency(null)
    },
  })

  const handleSaveCurrency = (currency: Partial<PlatformCurrency>) => {
    if (editingCurrency?.id) {
      updateCurrencyMutation.mutate({ ...currency, id: editingCurrency.id })
    } else {
      createCurrencyMutation.mutate(currency)
    }
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading currencies…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Currencies</h2>
        <button
          type="button"
          onClick={() => {
            setEditingCurrency({} as PlatformCurrency)
            setShowCurrencyModal(true)
          }}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Currency
        </button>
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Code
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Symbol
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Decimal Places
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Exchange Rate
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {currencies.map((currency) => (
              <tr key={currency.id} className={currency.is_default ? 'bg-yellow-50' : ''}>
                <td className="whitespace-nowrap px-6 py-4">
                  <div className="flex items-center">
                    <span className="text-sm font-medium text-foreground">{currency.code}</span>
                    {currency.is_default && (
                      <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
                        Default
                      </span>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-foreground">{currency.name}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-foreground">{currency.symbol}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-foreground">{currency.decimal_places}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-foreground">
                  {currency.exchange_rate ? currency.exchange_rate.toFixed(4) : '-'}
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold leading-5 ${
                      currency.is_active ? 'bg-success/15 text-success' : 'bg-muted text-foreground'
                    }`}
                  >
                    {currency.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCurrency(currency)
                      setShowCurrencyModal(true)
                    }}
                    className="text-primary hover:text-foreground/85"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCurrencyModal && (
        <CurrencyModal
          currency={editingCurrency}
          onClose={() => {
            setShowCurrencyModal(false)
            setEditingCurrency(null)
          }}
          onSave={handleSaveCurrency}
        />
      )}
    </div>
  )
}
