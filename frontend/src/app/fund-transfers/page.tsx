'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Edit2, Trash2, X, CheckCircle, XCircle, AlertCircle, ArrowRightLeft } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { extractErrorMessage } from '@/utils/errorHandler'
import api from '@/lib/api'
import { getCurrencySymbol } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import { AMOUNT_FUND_TRANSFER_INPUT_CLASS } from '@/utils/amountFieldStyles'

interface FundTransfer {
  id: number
  transfer_number: string
  transfer_date: string
  from_account_id: number
  to_account_id: number
  amount: number | string
  memo?: string
  is_posted: boolean
  journal_entry_id?: number
  created_by?: number
  created_at: string
  updated_at: string
  from_account_name?: string
  to_account_name?: string
  from_account_number?: string
  to_account_number?: string
}

interface BankAccount {
  id: number
  account_name: string
  account_number: string
  bank_name: string
  current_balance: number | string
  is_active: boolean
  chart_account_id?: number
  /** True for equity chart lines exposed only for transfers (not a bank). */
  is_equity_register?: boolean
}

function renderTransferAccountOptions(accounts: BankAccount[], currencySymbol: string) {
  const bankCash = accounts.filter((a) => !a.is_equity_register)
  const equity = accounts.filter((a) => a.is_equity_register)
  const row = (b: BankAccount) => (
    <option key={b.id} value={b.id}>
      {b.account_name} ({b.account_number}) · {b.bank_name} — {currencySymbol}
      {Number(b.current_balance || 0).toFixed(2)}
    </option>
  )
  return (
    <>
      {bankCash.length > 0 ? (
        <optgroup label="Bank and cash">{bankCash.map(row)}</optgroup>
      ) : null}
      {equity.length > 0 ? <optgroup label="Equity">{equity.map(row)}</optgroup> : null}
    </>
  )
}

export default function FundTransfersPage() {
  const router = useRouter()
  const toast = useToast()
  const [transfers, setTransfers] = useState<FundTransfer[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null)
  const [editingTransfer, setEditingTransfer] = useState<FundTransfer | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [formData, setFormData] = useState({
    transfer_date: new Date().toISOString().split('T')[0],
    from_account_id: '',
    to_account_id: '',
    amount: '',
    memo: ''
  })

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
      if (!token) {
        router.push('/login')
        return
      }
      
      // Fetch company currency
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        console.error('Error fetching company currency:', error)
      }

      const [transfersRes, accountsRes] = await Promise.allSettled([
        api.get('/fund-transfers/'),
        api.get('/bank-accounts/', { params: { for_fund_transfer: 1 } }),
      ])

      if (transfersRes.status === 'fulfilled') {
        setTransfers(transfersRes.value.data)
      } else {
        console.error('Error loading fund transfers:', transfersRes.reason)
        toast.error('Failed to load fund transfers')
      }

      if (accountsRes.status === 'fulfilled') {
        const accountsData = accountsRes.value.data as BankAccount[]
        setBankAccounts(accountsData)
      } else {
        console.error('Error loading bank accounts:', accountsRes.reason)
        toast.error('Failed to load bank accounts')
      }
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      transfer_date: new Date().toISOString().split('T')[0],
      from_account_id: '',
      to_account_id: '',
      amount: '',
      memo: ''
    })
    setEditingTransfer(null)
  }

  const handleCreate = async () => {
    try {
      if (!formData.from_account_id || !formData.to_account_id || !formData.amount) {
        toast.error('Please fill in all required fields')
        return
      }

      if (formData.from_account_id === formData.to_account_id) {
        toast.error('From and To accounts must be different')
        return
      }

      const amount = parseFloat(formData.amount)
      if (isNaN(amount) || amount <= 0) {
        toast.error('Amount must be greater than 0')
        return
      }

      await api.post('/fund-transfers/', {
        transfer_date: formData.transfer_date,
        from_account_id: parseInt(formData.from_account_id, 10),
        to_account_id: parseInt(formData.to_account_id, 10),
        amount,
        memo: formData.memo || null,
      })
      toast.success('Fund transfer created successfully')
      setShowModal(false)
      resetForm()
      fetchData()
    } catch (error) {
      console.error('Error creating fund transfer:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to create fund transfer')
      toast.error(errorMessage)
    }
  }

  const handleEdit = (transfer: FundTransfer) => {
    if (transfer.is_posted) {
      toast.error('Cannot edit a posted transfer. Unpost it first.')
      return
    }
    setEditingTransfer(transfer)
    setFormData({
      transfer_date: transfer.transfer_date.split('T')[0],
      from_account_id: transfer.from_account_id.toString(),
      to_account_id: transfer.to_account_id.toString(),
      amount: transfer.amount.toString(),
      memo: transfer.memo || ''
    })
    setShowModal(true)
  }

  const handleUpdate = async () => {
    if (!editingTransfer) return

    try {
      if (!formData.from_account_id || !formData.to_account_id || !formData.amount) {
        toast.error('Please fill in all required fields')
        return
      }

      if (formData.from_account_id === formData.to_account_id) {
        toast.error('From and To accounts must be different')
        return
      }

      const amount = parseFloat(formData.amount)
      if (isNaN(amount) || amount <= 0) {
        toast.error('Amount must be greater than 0')
        return
      }

      await api.put(`/fund-transfers/${editingTransfer.id}/`, {
        transfer_date: formData.transfer_date,
        from_account_id: parseInt(formData.from_account_id, 10),
        to_account_id: parseInt(formData.to_account_id, 10),
        amount,
        memo: formData.memo || null,
      })
      toast.success('Fund transfer updated successfully')
      setShowModal(false)
      resetForm()
      fetchData()
    } catch (error) {
      console.error('Error updating fund transfer:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to update fund transfer')
      toast.error(errorMessage)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/fund-transfers/${id}/`)
      toast.success('Fund transfer deleted successfully')
      setShowDeleteConfirm(null)
      fetchData()
    } catch (error) {
      console.error('Error deleting fund transfer:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to delete fund transfer')
      toast.error(errorMessage)
    }
  }

  const handlePost = async (id: number) => {
    try {
      await api.post(`/fund-transfers/${id}/post/`)
      toast.success('Fund transfer posted successfully')
      fetchData()
    } catch (error) {
      console.error('Error posting fund transfer:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to post fund transfer')
      toast.error(errorMessage)
    }
  }

  const handleUnpost = async (id: number) => {
    try {
      await api.post(`/fund-transfers/${id}/unpost/`)
      toast.success('Fund transfer unposted successfully')
      fetchData()
    } catch (error) {
      console.error('Error unposting fund transfer:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to unpost fund transfer')
      toast.error(errorMessage)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-auto">
          <div className="app-scroll-pad flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="app-scroll-pad">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Fund Transfers</h1>
              <p className="text-gray-600 mt-1">
                Move money between <strong>bank / cash</strong> registers and <strong>equity</strong> accounts (same idea
                as QuickBooks: transfers between balance-sheet accounts for contributions, draws, and till/bank moves).
                Bank lines come from your chart; equity lines are all active <strong>Equity</strong> type accounts.
              </p>
            </div>
            <button
              onClick={() => {
                resetForm()
                setShowModal(true)
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-5 w-5" />
              <span>New Transfer</span>
            </button>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Transfer #</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">From Account</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">To Account</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Memo</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700 uppercase">Status</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {transfers.map((transfer) => (
                  <tr key={transfer.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {transfer.transfer_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {formatDateOnly(transfer.transfer_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {transfer.from_account_name || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {transfer.to_account_name || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 text-right">
                      {currencySymbol}{Number(transfer.amount).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">
                      {transfer.memo || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      {transfer.is_posted ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Posted
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Draft
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                      <div className="flex items-center justify-center space-x-2">
                        {!transfer.is_posted ? (
                          <>
                            <button
                              onClick={() => handlePost(transfer.id)}
                              className="text-green-600 hover:text-green-900"
                              title="Post Transfer"
                            >
                              <CheckCircle className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => handleEdit(transfer)}
                              className="text-blue-600 hover:text-blue-900"
                              title="Edit"
                            >
                              <Edit2 className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => setShowDeleteConfirm(transfer.id)}
                              className="text-red-600 hover:text-red-900"
                              title="Delete"
                            >
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleUnpost(transfer.id)}
                            className="text-orange-600 hover:text-orange-900"
                            title="Unpost Transfer"
                          >
                            <XCircle className="h-5 w-5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {transfers.length === 0 && (
              <div className="p-12 text-center">
                <ArrowRightLeft className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No fund transfers found. Create your first transfer to get started.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">
                  {editingTransfer ? 'Edit Fund Transfer' : 'New Fund Transfer'}
                </h2>
                <button
                  onClick={() => {
                    setShowModal(false)
                    resetForm()
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Transfer Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={formData.transfer_date}
                  onChange={(e) => setFormData({ ...formData, transfer_date: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    From Account <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.from_account_id}
                    onChange={(e) => setFormData({ ...formData, from_account_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select Account</option>
                    {renderTransferAccountOptions(bankAccounts, currencySymbol)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    To Account <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.to_account_id}
                    onChange={(e) => setFormData({ ...formData, to_account_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select Account</option>
                    {renderTransferAccountOptions(bankAccounts, currencySymbol)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Amount <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500">{currencySymbol}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className={AMOUNT_FUND_TRANSFER_INPUT_CLASS}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Memo
                </label>
                <textarea
                  value={formData.memo}
                  onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Optional memo or description"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex items-center justify-end space-x-3">
              <button
                onClick={() => {
                  setShowModal(false)
                  resetForm()
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={editingTransfer ? handleUpdate : handleCreate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {editingTransfer ? 'Update Transfer' : 'Create Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Confirm Delete</h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete this fund transfer? This action cannot be undone.
              </p>
              <div className="flex items-center justify-end space-x-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(showDeleteConfirm)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

