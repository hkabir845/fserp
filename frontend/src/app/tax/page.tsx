'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Edit2, Trash2, X, Percent, FileText, Building2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getBackendOrigin } from '@/lib/api'

interface TaxRate {
  id: number
  name: string
  rate: number
  tax_agency: string | null
  tax_code_id: number
  created_at: string
  updated_at: string
}

interface TaxCode {
  id: number
  code: string
  name: string
  description: string | null
  /** VAT | SD | AIT — may be missing on legacy rows */
  tax_type?: string | null
  is_active: boolean
  company_id: number
  created_at: string
  updated_at: string
  tax_rates?: TaxRate[]
}

export default function TaxPage() {
  const router = useRouter()
  const toast = useToast()
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showRateModal, setShowRateModal] = useState(false)
  const [selectedTaxCode, setSelectedTaxCode] = useState<number | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    tax_type: 'VAT',
    is_active: true
  })
  const [rateFormData, setRateFormData] = useState({
    name: '',
    rate: '',
    tax_agency: 'NBR',
    tax_code_id: 0
  })
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')

  // Bangladesh Tax Code Templates
  const taxCodeTemplates = [
    {
      code: 'VAT-15',
      name: 'Value Added Tax',
      description: 'Standard VAT rate for fuel sales as per Bangladesh VAT Act 2012',
      tax_type: 'VAT',
      rates: [{ name: 'Standard VAT Rate', rate: '15.00', agency: 'NBR' }]
    },
    {
      code: 'SD-PETROL',
      name: 'Supplementary Duty - Petrol',
      description: 'Supplementary Duty on Petrol/Octane as per Bangladesh Customs Act',
      tax_type: 'SD',
      rates: [{ name: 'Petrol SD Rate', rate: '37.00', agency: 'NBR' }]
    },
    {
      code: 'SD-DIESEL',
      name: 'Supplementary Duty - Diesel',
      description: 'Supplementary Duty on Diesel as per Bangladesh Customs Act',
      tax_type: 'SD',
      rates: [{ name: 'Diesel SD Rate', rate: '20.00', agency: 'NBR' }]
    },
    {
      code: 'AIT',
      name: 'Advance Income Tax',
      description: 'Advance Income Tax on certain transactions as per Income Tax Ordinance 1984',
      tax_type: 'AIT',
      rates: [{ name: 'Standard AIT Rate', rate: '3.00', agency: 'NBR' }]
    },
    {
      code: 'VAT-0',
      name: 'Zero Rated VAT',
      description: 'Zero rated VAT for exempted goods/services',
      tax_type: 'VAT',
      rates: [{ name: 'Zero VAT Rate', rate: '0.00', agency: 'NBR' }]
    },
    {
      code: 'SD-KEROSENE',
      name: 'Supplementary Duty - Kerosene',
      description: 'Supplementary Duty on Kerosene',
      tax_type: 'SD',
      rates: [{ name: 'Kerosene SD Rate', rate: '15.00', agency: 'NBR' }]
    }
  ]

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    
    // Get user role
    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const user = JSON.parse(userStr)
        setUserRole(user.role?.toLowerCase() || null)
      } catch (error) {
        console.error('Error parsing user data:', error)
      }
    }
    
    fetchTaxCodes()
  }, [router])

  const fetchTaxCodes = async () => {
    try {
      setLoading(true)
      const response = await api.get('/taxes/')
      if (response.data) {
        // Ensure tax_rates is an array
        const taxes = Array.isArray(response.data) ? response.data : []
        setTaxCodes(taxes.map((tax: TaxCode) => ({
          ...tax,
          tax_rates: tax.tax_rates || []
        })))
      }
    } catch (error: any) {
      // Handle connection refused or network errors (server not running)
      if (!error.response && (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error') || error.message?.includes('ERR_CONNECTION_REFUSED'))) {
        // Don't show error toast on initial load - just set empty array
        // The empty state will show appropriate message
        console.warn(`Backend server is not accessible. Please ensure the server is running on ${getBackendOrigin()}`)
        setTaxCodes([])
        setLoading(false)
        return
      }
      
      if (error.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
        toast.error('Session expired. Please login again.')
      } else if (error.response?.status === 404) {
        // No tax codes found, which is fine
        setTaxCodes([])
      } else if (error.response?.status >= 500) {
        // Server error
        toast.error('Server error. Please try again later.')
        console.error('Server error fetching tax codes:', error)
        setTaxCodes([])
      } else {
        // Other errors (400, 403, etc.)
        const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to load tax codes'
        console.error('Error fetching tax codes:', error)
        // Don't show toast for all errors - some might be expected (like empty list)
        setTaxCodes([])
      }
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      code: '',
      name: '',
      description: '',
      tax_type: 'VAT',
      is_active: true
    })
    setEditingId(null)
    setSelectedTemplate('')
  }

  const handleTemplateSelect = (templateCode: string) => {
    if (!templateCode) {
      resetForm()
      return
    }

    const template = taxCodeTemplates.find(t => t.code === templateCode)
    if (template) {
      setFormData({
        code: template.code,
        name: template.name,
        description: template.description,
        tax_type: template.tax_type,
        is_active: true
      })
      setSelectedTemplate(templateCode)
    }
  }

  const resetRateForm = () => {
    setRateFormData({
      name: '',
      rate: '',
      tax_agency: 'NBR',
      tax_code_id: 0
    })
  }

  const handleCreate = () => {
    resetForm()
    setShowModal(true)
  }

  const handleEdit = (tax: TaxCode) => {
    setEditingId(tax.id)
    setFormData({
      code: tax.code,
      name: tax.name,
      description: tax.description || '',
      tax_type: tax.tax_type?.trim() || 'VAT',
      is_active: tax.is_active
    })
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.code || !formData.name) {
      toast.error('Please fill in all required fields')
      return
    }

    try {
      if (editingId) {
        await api.put(`/taxes/${editingId}`, formData)
        toast.success('Tax code updated successfully!')
      } else {
        // Create tax code
        const response = await api.post('/taxes/', formData)
        const newTaxCodeId = response.data.id
        
        // If template was selected, create tax rates automatically
        if (selectedTemplate) {
          const template = taxCodeTemplates.find(t => t.code === selectedTemplate)
          if (template && template.rates) {
            for (const rateTemplate of template.rates) {
              try {
                await api.post('/taxes/rates', {
                  name: rateTemplate.name,
                  rate: parseFloat(rateTemplate.rate),
                  tax_agency: rateTemplate.agency || 'NBR',
                  tax_code_id: newTaxCodeId
                })
              } catch (rateError: any) {
                console.error('Error creating tax rate:', rateError)
                // Continue even if rate creation fails
              }
            }
            toast.success(`Tax code created successfully with ${template.rates.length} rate(s)!`)
          } else {
            toast.success('Tax code created successfully!')
          }
        } else {
          toast.success('Tax code created successfully!')
        }
      }
      setShowModal(false)
      resetForm()
      await fetchTaxCodes()
    } catch (error: any) {
      // Handle connection errors
      if (!error.response && (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error') || error.message?.includes('ERR_CONNECTION_REFUSED'))) {
        toast.error(`Cannot connect to server. Please ensure the backend server is running on ${getBackendOrigin()}`)
        return
      }
      
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || `Failed to ${editingId ? 'update' : 'create'} tax code`
      toast.error(errorMsg)
      console.error('Tax code error:', error)
    }
  }

  const handleDelete = async (tax: TaxCode) => {
    if (!confirm(`Are you sure you want to delete tax code "${tax.code}"? This action cannot be undone.`)) {
      return
    }

    try {
      await api.delete(`/taxes/${tax.id}`)
      toast.success('Tax code deleted successfully!')
      await fetchTaxCodes()
    } catch (error: any) {
      // Handle connection errors
      if (!error.response && (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error'))) {
        toast.error('Cannot connect to server. Please ensure the backend server is running.')
        return
      }
      
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to delete tax code'
      toast.error(errorMsg)
      console.error('Delete tax code error:', error)
    }
  }

  const handleAddRate = (taxCodeId: number) => {
    setSelectedTaxCode(taxCodeId)
    setRateFormData({
      name: '',
      rate: '',
      tax_agency: 'NBR',
      tax_code_id: taxCodeId
    })
    setShowRateModal(true)
  }

  const handleSubmitRate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!rateFormData.name || !rateFormData.rate) {
      toast.error('Please fill in all required fields')
      return
    }

    const rate = parseFloat(rateFormData.rate)
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Rate must be between 0 and 100')
      return
    }

    try {
      await api.post('/taxes/rates', {
        name: rateFormData.name,
        rate: rate,
        tax_agency: rateFormData.tax_agency || 'NBR',
        tax_code_id: selectedTaxCode
      })
      toast.success('Tax rate added successfully!')
      setShowRateModal(false)
      resetRateForm()
      setSelectedTaxCode(null)
      await fetchTaxCodes()
    } catch (error: any) {
      // Handle connection errors
      if (!error.response && (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error'))) {
        toast.error('Cannot connect to server. Please ensure the backend server is running.')
        return
      }
      
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to create tax rate'
      toast.error(errorMsg)
      console.error('Create tax rate error:', error)
    }
  }

  const handleDeleteRate = async (rateId: number, taxCodeId: number) => {
    if (!confirm('Are you sure you want to delete this tax rate?')) {
      return
    }

    try {
      await api.delete(`/taxes/rates/${rateId}`)
      toast.success('Tax rate deleted successfully!')
      await fetchTaxCodes()
    } catch (error: any) {
      // Handle connection errors
      if (!error.response && (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error'))) {
        toast.error('Cannot connect to server. Please ensure the backend server is running.')
        return
      }
      
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to delete tax rate'
      toast.error(errorMsg)
      console.error('Delete tax rate error:', error)
    }
  }

  const handleInitBangladeshTaxes = async () => {
    if (!confirm('This will create default Bangladesh tax codes (VAT 15%, SD rates, AIT). Continue?')) {
      return
    }

    try {
      const response = await api.post('/taxes/init-bangladesh')
      toast.success(`Bangladesh tax codes initialized! Created: ${response.data.total_created}, Skipped: ${response.data.total_skipped}`)
      await fetchTaxCodes()
    } catch (error: any) {
      // Handle connection errors
      if (!error.response && (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error'))) {
        toast.error('Cannot connect to server. Please ensure the backend server is running.')
        return
      }
      
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to initialize tax codes'
      toast.error(errorMsg)
      console.error('Init Bangladesh taxes error:', error)
    }
  }

  const getTaxTypeColor = (type: string | undefined | null) => {
    const t = String(type ?? '')
      .trim()
      .toUpperCase()
    switch (t) {
      case 'VAT':
        return 'bg-blue-100 text-blue-800'
      case 'SD':
        return 'bg-purple-100 text-purple-800'
      case 'AIT':
        return 'bg-orange-100 text-orange-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Tax Management</h1>
              <p className="text-gray-600 mt-1">Manage tax codes and rates as per Bangladesh Government Law</p>
            </div>
            <div className="flex items-center space-x-3">
              {userRole === 'admin' && (
                <button 
                  onClick={handleInitBangladeshTaxes}
                  className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Building2 className="h-5 w-5" />
                  <span>Initialize Bangladesh Tax Codes</span>
                </button>
              )}
              {(userRole === 'admin' || userRole === 'accountant') && (
                <button 
                  onClick={handleCreate}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-5 w-5" />
                  <span>New Tax Code</span>
                </button>
              )}
            </div>
          </div>

          {/* Bangladesh Tax Info Banner */}
          <div className="bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <Building2 className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Bangladesh Tax & VAT Information</h3>
                <p className="text-sm text-gray-700">
                  <strong>VAT (Value Added Tax):</strong> 15% standard rate on fuel sales
                  <br />
                  <strong>SD (Supplementary Duty):</strong> Varies by fuel type (Petrol ~37%, Diesel ~20%)
                  <br />
                  <strong>AIT (Advance Income Tax):</strong> May apply on certain transactions
                  <br />
                  <strong>Authority:</strong> National Board of Revenue (NBR)
                </p>
              </div>
            </div>
          </div>

          {/* Tax Codes Table View */}
          {taxCodes.length > 0 && (
            <div className="bg-white rounded-lg shadow mb-6 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h2 className="text-lg font-semibold text-gray-900">All Tax Codes ({taxCodes.length})</h2>
                <p className="text-sm text-gray-600 mt-1">Complete list of all tax codes and their rates</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rates</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                      {(userRole === 'admin' || userRole === 'accountant') && (
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {taxCodes.map((tax) => (
                      <tr key={tax.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-mono font-semibold text-gray-900">{tax.code}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-gray-900">{tax.name}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getTaxTypeColor(tax.tax_type)}`}>
                            {tax.tax_type?.trim() || '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col space-y-1">
                            {tax.tax_rates && tax.tax_rates.length > 0 ? (
                              tax.tax_rates.map((rate) => (
                                <span key={rate.id} className="text-sm text-gray-900">
                                  <strong className="text-blue-600">{Number(rate.rate).toFixed(2)}%</strong> - {rate.name}
                                  {rate.tax_agency && (
                                    <span className="text-xs text-gray-500 ml-1">({rate.tax_agency})</span>
                                  )}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-gray-400 italic">No rates defined</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                            tax.is_active 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {tax.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-600 max-w-xs truncate block" title={tax.description || ''}>
                            {tax.description || '-'}
                          </span>
                        </td>
                        {(userRole === 'admin' || userRole === 'accountant') && (
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => handleEdit(tax)}
                                className="p-1.5 text-blue-600 hover:text-blue-900 hover:bg-blue-50 rounded transition-colors"
                                title="Edit Tax Code"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              {userRole === 'admin' && (
                                <button
                                  onClick={() => handleDelete(tax)}
                                  className="p-1.5 text-red-600 hover:text-red-900 hover:bg-red-50 rounded transition-colors"
                                  title="Delete Tax Code"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tax Codes Grid (Card View) */}
          {taxCodes.length > 0 && (
            <>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Card View</h2>
                <p className="text-sm text-gray-600">Visual representation of tax codes</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {taxCodes.map((tax) => (
                  <div key={tax.id} className="bg-white rounded-lg shadow-lg p-6 border border-gray-200">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <h3 className="text-lg font-bold text-gray-900">{tax.name}</h3>
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getTaxTypeColor(tax.tax_type)}`}>
                        {tax.tax_type?.trim() || '—'}
                      </span>
                    </div>
                    <p className="text-sm font-mono text-gray-600 mb-1">Code: {tax.code}</p>
                    {tax.description && (
                      <p className="text-sm text-gray-600 mb-2">{tax.description}</p>
                    )}
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    tax.is_active 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {tax.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                
                {/* Tax Rates */}
                <div className="border-t pt-4 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-gray-700">Tax Rates</h4>
                    {(userRole === 'admin' || userRole === 'accountant') && (
                      <button
                        onClick={() => handleAddRate(tax.id)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        + Add Rate
                      </button>
                    )}
                  </div>
                  {tax.tax_rates && tax.tax_rates.length > 0 ? (
                    <div className="space-y-2">
                      {tax.tax_rates.map((rate: TaxRate) => (
                        <div key={rate.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">{rate.name}</p>
                            <p className="text-xs text-gray-600">{rate.tax_agency || 'NBR'}</p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="text-lg font-bold text-blue-600">{Number(rate.rate).toFixed(2)}%</span>
                            {userRole === 'admin' && (
                              <button
                                onClick={() => handleDeleteRate(rate.id, tax.id)}
                                className="p-1 text-red-600 hover:text-red-800 rounded transition-colors"
                                title="Delete Rate"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 text-center py-2">No rates defined. Click "+ Add Rate" to add a tax rate.</p>
                  )}
                </div>
                
                {/* Actions */}
                {(userRole === 'admin' || userRole === 'accountant') && (
                  <div className="flex items-center justify-end space-x-2 pt-4 border-t">
                    <button
                      onClick={() => handleEdit(tax)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="Edit Tax Code"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    {userRole === 'admin' && (
                      <button 
                        onClick={() => handleDelete(tax)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete Tax Code"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
              </div>
            </>
          )}

          {taxCodes.length === 0 && !loading && (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 text-lg mb-2">No tax codes found.</p>
              <p className="text-gray-400 text-sm">
                {userRole === 'admin' 
                  ? 'Use the buttons above to initialize default Bangladesh tax codes or create a custom tax code.'
                  : 'Contact your administrator to set up tax codes.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Tax Code Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
              <div className="flex items-center space-x-3">
                <Percent className="h-6 w-6 text-white" />
                <h2 className="text-2xl font-bold text-white">
                  {editingId ? 'Edit Tax Code' : 'New Tax Code'}
                </h2>
              </div>
              <button
                onClick={() => {
                  setShowModal(false)
                  resetForm()
                }}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-6">
                {!editingId && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Tax Code Template (Optional)
                    </label>
                    <select
                      value={selectedTemplate}
                      onChange={(e) => handleTemplateSelect(e.target.value)}
                      className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    >
                      <option value="">-- Select a template or create custom --</option>
                      {taxCodeTemplates.map((template) => (
                        <option key={template.code} value={template.code}>
                          {template.code} - {template.name} ({template.tax_type})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-600 mt-2">
                      Select a template to auto-fill the form, or leave blank to create a custom tax code
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tax Code <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.code}
                      onChange={(e) => {
                        setFormData({ ...formData, code: e.target.value.toUpperCase() })
                        setSelectedTemplate('') // Clear template selection when manually editing
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="e.g., VAT-15"
                    />
                    <p className="text-xs text-gray-500 mt-1">Unique code identifier</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tax Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => {
                        setFormData({ ...formData, name: e.target.value })
                        setSelectedTemplate('') // Clear template selection when manually editing
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="e.g., Value Added Tax"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tax Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={formData.tax_type}
                      onChange={(e) => setFormData({ ...formData, tax_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="VAT">VAT (Value Added Tax)</option>
                      <option value="SD">SD (Supplementary Duty)</option>
                      <option value="AIT">AIT (Advance Income Tax)</option>
                      <option value="CUSTOM">Custom Tax</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Tax description..."
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">Active</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    resetForm()
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {editingId ? 'Update Tax Code' : 'Create Tax Code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tax Rate Modal */}
      {showRateModal && selectedTaxCode && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="bg-gradient-to-r from-green-600 to-green-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
              <div className="flex items-center space-x-3">
                <Percent className="h-6 w-6 text-white" />
                <h2 className="text-xl font-bold text-white">Add Tax Rate</h2>
              </div>
              <button
                onClick={() => {
                  setShowRateModal(false)
                  resetRateForm()
                }}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
            </div>

            <form onSubmit={handleSubmitRate} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rate Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={rateFormData.name}
                    onChange={(e) => setRateFormData({ ...rateFormData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="e.g., Standard VAT Rate"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rate (%) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0"
                    max="100"
                    value={rateFormData.rate}
                    onChange={(e) => setRateFormData({ ...rateFormData, rate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="e.g., 15.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tax Agency
                  </label>
                  <input
                    type="text"
                    value={rateFormData.tax_agency}
                    onChange={(e) => setRateFormData({ ...rateFormData, tax_agency: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="e.g., NBR"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowRateModal(false)
                    resetRateForm()
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Add Rate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
