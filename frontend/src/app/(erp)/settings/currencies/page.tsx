'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Currency {
  code: string
  name: string
  symbol: string
  is_default: boolean
  is_active: boolean
  decimal_places: number
}

export default function SettingsCurrenciesPage() {
  const queryClient = useQueryClient()

  const { data: currencies = [], isLoading } = useQuery<Currency[]>({
    queryKey: ['tenant-currencies'],
    queryFn: async () => {
      const response = await api.get('/currencies')
      return response.data
    },
  })

  const setDefaultCurrencyMutation = useMutation({
    mutationFn: async (currencyCode: string) => {
      return api.put(`/currencies/${currencyCode}/default`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-currencies'] })
    },
  })

  const toggleCurrencyMutation = useMutation({
    mutationFn: async (currencyCode: string) => {
      return api.put(`/currencies/${currencyCode}/toggle`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-currencies'] })
    },
  })

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading currencies…</div>
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Available Currencies</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Select your default currency and enable/disable currencies for your company
          </p>
        </div>
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
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {currencies.map((currency) => (
              <tr key={currency.code} className={currency.is_default ? 'bg-yellow-50' : ''}>
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
                  <div className="flex items-center justify-end gap-2">
                    {!currency.is_default && (
                      <button
                        type="button"
                        onClick={() => setDefaultCurrencyMutation.mutate(currency.code)}
                        className="text-primary hover:text-foreground/85"
                        title="Set as default"
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleCurrencyMutation.mutate(currency.code)}
                      className={
                        currency.is_active
                          ? 'text-yellow-600 hover:text-yellow-900'
                          : 'text-success hover:text-green-900'
                      }
                      title={currency.is_active ? 'Disable' : 'Enable'}
                    >
                      {currency.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
