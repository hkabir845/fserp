'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { 
  Check, X, Crown, Zap, Building2, Sparkles, 
  TrendingUp, Calendar, CreditCard, BarChart3,
  AlertCircle, CheckCircle2, Clock, XCircle,
  ArrowRight, Star, Shield, Zap as ZapIcon
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import { formatDateOnly } from '@/utils/date'
import { getApiBaseUrl } from '@/lib/api'

interface Plan {
  id: number
  plan_code: string
  plan_name: string
  plan_type: string
  description: string
  price_monthly: number
  price_quarterly: number
  price_yearly: number
  currency: string
  features: string[]
  limits: {
    stations?: number
    users?: number
    storage_gb?: number
  }
  trial_days: number
  is_featured: boolean
  display_order: number
}

interface Subscription {
  id: number
  company_id: number
  plan_id: number
  plan: Plan
  status: string
  billing_cycle: string
  price: number
  trial_start_date?: string
  trial_end_date?: string
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
  cancelled_at?: string
  limits?: Record<string, number>
  current_usage?: Record<string, number>
}

interface Usage {
  usage: Record<string, number>
  limits: Record<string, number>
  subscription_status: string
}

interface Payment {
  id: number
  payment_number: string
  amount: number
  currency: string
  status: string
  due_date: string
  paid_date?: string
  period_start: string
  period_end: string
  created_at: string
}

export default function SubscriptionsPage() {
  const router = useRouter()
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<'plans' | 'current' | 'usage' | 'billing'>('current')
  const [plans, setPlans] = useState<Plan[]>([])
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [subscribing, setSubscribing] = useState<number | null>(null)
  const [selectedBillingCycle, setSelectedBillingCycle] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchData()
  }, [router])

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()

      const [plansRes, subscriptionRes, usageRes, paymentsRes] = await Promise.allSettled([
        fetch(`${baseUrl}/subscriptions/plans`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${baseUrl}/subscriptions/my-subscription`, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => ({ ok: false, json: () => Promise.resolve(null) })),
        fetch(`${baseUrl}/subscriptions/usage`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${baseUrl}/subscriptions/payments`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ])

      if (plansRes.status === 'fulfilled' && plansRes.value.ok) {
        setPlans(await plansRes.value.json())
      }

      if (subscriptionRes.status === 'fulfilled' && subscriptionRes.value?.ok) {
        setSubscription(await subscriptionRes.value.json())
      }

      if (usageRes.status === 'fulfilled' && usageRes.value.ok) {
        setUsage(await usageRes.value.json())
      }

      if (paymentsRes.status === 'fulfilled' && paymentsRes.value?.ok) {
        setPayments(await paymentsRes.value.json())
      }
    } catch (error) {
      console.error('Error fetching subscription data:', error)
      toast.error('Failed to load subscription data')
    } finally {
      setLoading(false)
    }
  }

  const handleSubscribe = async (planId: number) => {
    try {
      setSubscribing(planId)
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()

      const response = await fetch(`${baseUrl}/subscriptions/subscribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          plan_id: planId,
          billing_cycle: selectedBillingCycle
        })
      })

      if (response.ok) {
        toast.success('Subscription updated successfully!')
        fetchData()
        setActiveTab('current')
      } else {
        const error = await response.json()
        toast.error(error.detail || 'Failed to update subscription')
      }
    } catch (error) {
      console.error('Error subscribing:', error)
      toast.error('Failed to update subscription')
    } finally {
      setSubscribing(null)
    }
  }

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel your subscription? It will remain active until the end of the current billing period.')) {
      return
    }

    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()

      const response = await fetch(`${baseUrl}/subscriptions/my-subscription/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (response.ok) {
        toast.success('Subscription will be cancelled at the end of the billing period')
        fetchData()
      } else {
        toast.error('Failed to cancel subscription')
      }
    } catch (error) {
      toast.error('Failed to cancel subscription')
    }
  }

  const handleReactivate = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()

      const response = await fetch(`${baseUrl}/subscriptions/my-subscription/reactivate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (response.ok) {
        toast.success('Subscription reactivated successfully!')
        fetchData()
      } else {
        toast.error('Failed to reactivate subscription')
      }
    } catch (error) {
      toast.error('Failed to reactivate subscription')
    }
  }

  const getPlanIcon = (planType: string) => {
    switch (planType.toLowerCase()) {
      case 'free':
        return <Sparkles className="h-6 w-6" />
      case 'basic':
        return <Zap className="h-6 w-6" />
      case 'professional':
        return <Crown className="h-6 w-6" />
      case 'enterprise':
        return <Building2 className="h-6 w-6" />
      default:
        return <Star className="h-6 w-6" />
    }
  }

  const getPlanColor = (planType: string) => {
    switch (planType.toLowerCase()) {
      case 'free':
        return 'bg-gray-100 text-gray-700'
      case 'basic':
        return 'bg-blue-100 text-blue-700'
      case 'professional':
        return 'bg-purple-100 text-purple-700'
      case 'enterprise':
        return 'bg-gradient-to-r from-yellow-400 to-orange-500 text-white'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      trial: { color: 'bg-blue-100 text-blue-800', icon: Clock, label: 'Trial' },
      active: { color: 'bg-green-100 text-green-800', icon: CheckCircle2, label: 'Active' },
      suspended: { color: 'bg-yellow-100 text-yellow-800', icon: AlertCircle, label: 'Suspended' },
      cancelled: { color: 'bg-gray-100 text-gray-800', icon: XCircle, label: 'Cancelled' },
      expired: { color: 'bg-red-100 text-red-800', icon: XCircle, label: 'Expired' },
      past_due: { color: 'bg-orange-100 text-orange-800', icon: AlertCircle, label: 'Past Due' }
    }

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.trial
    const Icon = config.icon

    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${config.color}`}>
        <Icon className="h-4 w-4" />
        {config.label}
      </span>
    )
  }

  const formatPrice = (price: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(price)
  }

  const getPrice = (plan: Plan, cycle: string) => {
    switch (cycle) {
      case 'monthly':
        return plan.price_monthly
      case 'quarterly':
        return plan.price_quarterly
      case 'yearly':
        return plan.price_yearly
      default:
        return plan.price_monthly
    }
  }

  const getBillingCycleLabel = (cycle: string) => {
    switch (cycle) {
      case 'monthly':
        return '/month'
      case 'quarterly':
        return '/quarter'
      case 'yearly':
        return '/year'
      default:
        return '/month'
    }
  }

  const getUsagePercentage = (current: number, limit: number) => {
    if (limit === -1) return 0 // Unlimited
    if (limit === 0) return 0
    return Math.min((current / limit) * 100, 100)
  }

  const formatLimit = (limit: number) => {
    if (limit === -1) return 'Unlimited'
    return limit.toString()
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Subscription & Billing</h1>
            <p className="text-gray-600 text-lg">Manage your subscription plan and billing information</p>
          </div>

          {/* Tabs */}
          <div className="mb-8 border-b border-gray-200">
            <nav className="flex space-x-8">
              {[
                { id: 'current', label: 'Current Plan', icon: CreditCard },
                { id: 'plans', label: 'Browse Plans', icon: Star },
                { id: 'usage', label: 'Usage & Limits', icon: BarChart3 },
                { id: 'billing', label: 'Billing History', icon: Calendar }
              ].map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-2 pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                      activeTab === tab.id
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {tab.label}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* Current Subscription Tab */}
          {activeTab === 'current' && subscription && (
            <div className="space-y-6">
              {/* Current Plan Card */}
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                <div className={`${getPlanColor(subscription.plan.plan_type)} p-6`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white/20 rounded-xl">
                        {getPlanIcon(subscription.plan.plan_type)}
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold mb-1">{subscription.plan.plan_name}</h2>
                        <p className="opacity-90">{subscription.plan.description}</p>
                      </div>
                    </div>
                    {getStatusBadge(subscription.status)}
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  {/* Billing Info */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gray-50 rounded-xl p-4">
                      <div className="text-sm text-gray-600 mb-1">Current Price</div>
                      <div className="text-2xl font-bold text-gray-900">
                        {formatPrice(subscription.price, subscription.plan.currency)}
                        <span className="text-sm font-normal text-gray-600">/{subscription.billing_cycle}</span>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <div className="text-sm text-gray-600 mb-1">Billing Cycle</div>
                      <div className="text-lg font-semibold text-gray-900 capitalize">
                        {subscription.billing_cycle}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <div className="text-sm text-gray-600 mb-1">Next Billing Date</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {formatDateOnly(subscription.current_period_end)}
                      </div>
                    </div>
                  </div>

                  {/* Trial Info */}
                  {subscription.status === 'trial' && subscription.trial_end_date && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-5 w-5 text-blue-600" />
                        <span className="font-semibold text-blue-900">Trial Period</span>
                      </div>
                      <p className="text-blue-800">
                        Your trial ends on {formatDateOnly(subscription.trial_end_date)}. 
                        After that, you'll be charged {formatPrice(subscription.price, subscription.plan.currency)} per {subscription.billing_cycle}.
                      </p>
                    </div>
                  )}

                  {/* Cancellation Notice */}
                  {subscription.cancel_at_period_end && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-5 w-5 text-yellow-600" />
                        <span className="font-semibold text-yellow-900">Cancellation Scheduled</span>
                      </div>
                      <p className="text-yellow-800 mb-3">
                        Your subscription will be cancelled at the end of the current billing period ({formatDateOnly(subscription.current_period_end)}).
                      </p>
                      <button
                        onClick={handleReactivate}
                        className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors text-sm font-medium"
                      >
                        Reactivate Subscription
                      </button>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 pt-4 border-t border-gray-200">
                    {!subscription.cancel_at_period_end && (
                      <button
                        onClick={handleCancel}
                        className="px-6 py-2.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium"
                      >
                        Cancel Subscription
                      </button>
                    )}
                    <button
                      onClick={() => setActiveTab('plans')}
                      className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2"
                    >
                      Change Plan
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Plans Tab */}
          {activeTab === 'plans' && (
            <div className="space-y-8">
              {/* Billing Cycle Selector */}
              <div className="flex justify-center">
                <div className="inline-flex bg-white rounded-xl p-1 shadow-md border border-gray-200">
                  {(['monthly', 'quarterly', 'yearly'] as const).map((cycle) => (
                    <button
                      key={cycle}
                      onClick={() => setSelectedBillingCycle(cycle)}
                      className={`px-6 py-2 rounded-lg font-medium transition-all ${
                        selectedBillingCycle === cycle
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                      {cycle === 'yearly' && (
                        <span className="ml-2 text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">
                          Save 17%
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Plans Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {plans
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((plan) => {
                    const isCurrentPlan = subscription?.plan_id === plan.id
                    const price = getPrice(plan, selectedBillingCycle)
                    const isPopular = plan.is_featured

                    return (
                      <div
                        key={plan.id}
                        className={`relative bg-white rounded-2xl shadow-lg border-2 transition-all hover:shadow-xl ${
                          isPopular ? 'border-blue-500 scale-105' : 'border-gray-200'
                        } ${isCurrentPlan ? 'ring-2 ring-blue-500' : ''}`}
                      >
                        {isPopular && (
                          <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                            <span className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg flex items-center gap-1">
                              <Star className="h-3 w-3 fill-white" />
                              Most Popular
                            </span>
                          </div>
                        )}

                        {isCurrentPlan && (
                          <div className="absolute top-4 right-4">
                            <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-semibold">
                              Current Plan
                            </span>
                          </div>
                        )}

                        <div className={`${getPlanColor(plan.plan_type)} p-6 rounded-t-2xl`}>
                          <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-white/20 rounded-lg">
                              {getPlanIcon(plan.plan_type)}
                            </div>
                            <div>
                              <h3 className="text-xl font-bold">{plan.plan_name}</h3>
                              <p className="text-sm opacity-90">{plan.plan_code}</p>
                            </div>
                          </div>
                          <div className="mb-4">
                            <div className="text-4xl font-bold mb-1">
                              {formatPrice(price, plan.currency)}
                            </div>
                            <div className="text-sm opacity-90">{getBillingCycleLabel(selectedBillingCycle)}</div>
                          </div>
                          <p className="text-sm opacity-90">{plan.description}</p>
                        </div>

                        <div className="p-6">
                          {/* Features */}
                          <ul className="space-y-3 mb-6">
                            {plan.features?.slice(0, 5).map((feature, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <Check className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                                <span className="text-sm text-gray-700 capitalize">
                                  {feature.replace(/_/g, ' ')}
                                </span>
                              </li>
                            ))}
                          </ul>

                          {/* Limits */}
                          <div className="border-t border-gray-200 pt-4 mb-6 space-y-2">
                            {plan.limits && (
                              <>
                                {plan.limits.stations !== undefined && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Stations:</span>
                                    <span className="font-semibold">{formatLimit(plan.limits.stations)}</span>
                                  </div>
                                )}
                                {plan.limits.users !== undefined && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Users:</span>
                                    <span className="font-semibold">{formatLimit(plan.limits.users)}</span>
                                  </div>
                                )}
                                {plan.limits.storage_gb !== undefined && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Storage:</span>
                                    <span className="font-semibold">{formatLimit(plan.limits.storage_gb)} GB</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {/* CTA Button */}
                          <button
                            onClick={() => handleSubscribe(plan.id)}
                            disabled={isCurrentPlan || subscribing === plan.id}
                            className={`w-full py-3 rounded-lg font-semibold transition-all ${
                              isCurrentPlan
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : isPopular
                                ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-lg hover:scale-105'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                          >
                            {subscribing === plan.id ? (
                              <span className="flex items-center justify-center gap-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Processing...
                              </span>
                            ) : isCurrentPlan ? (
                              'Current Plan'
                            ) : (
                              'Subscribe Now'
                            )}
                          </button>

                          {plan.trial_days > 0 && (
                            <p className="text-center text-xs text-gray-500 mt-2">
                              {plan.trial_days}-day free trial
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Usage Tab */}
          {activeTab === 'usage' && usage && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Resource Usage</h2>
                <div className="space-y-6">
                  {Object.keys(usage.limits || {}).map((key) => {
                    const current = usage.usage?.[key] || 0
                    const limit = usage.limits?.[key] || 0
                    const percentage = getUsagePercentage(current, limit)
                    const isUnlimited = limit === -1
                    const isOverLimit = !isUnlimited && current >= limit

                    return (
                      <div key={key} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-semibold text-gray-700 capitalize">
                            {key.replace(/_/g, ' ')}
                          </span>
                          <span className={`text-sm font-bold ${isOverLimit ? 'text-red-600' : 'text-gray-900'}`}>
                            {current} / {formatLimit(limit)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isOverLimit
                                ? 'bg-red-500'
                                : percentage > 80
                                ? 'bg-yellow-500'
                                : 'bg-blue-500'
                            }`}
                            style={{ width: `${isUnlimited ? 0 : Math.min(percentage, 100)}%` }}
                          />
                        </div>
                        {isOverLimit && (
                          <p className="text-xs text-red-600 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Limit reached. Please upgrade your plan.
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Billing History Tab */}
          {activeTab === 'billing' && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-2xl font-bold text-gray-900">Payment History</h2>
              </div>
              {payments.length === 0 ? (
                <div className="p-12 text-center">
                  <CreditCard className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600">No payment history available</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Payment #
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Amount
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Period
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {payments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {payment.payment_number}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatPrice(payment.amount, payment.currency)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {formatDateOnly(payment.period_start)} - {formatDateOnly(payment.period_end)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(payment.status)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {payment.paid_date
                              ? formatDateOnly(payment.paid_date)
                              : formatDateOnly(payment.due_date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* No Subscription Message */}
          {activeTab === 'current' && !subscription && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-12 text-center">
              <Shield className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Active Subscription</h3>
              <p className="text-gray-600 mb-6">Subscribe to a plan to start using all features</p>
              <button
                onClick={() => setActiveTab('plans')}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium inline-flex items-center gap-2"
              >
                Browse Plans
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}



