'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Settings as SettingsIcon, Building2, Users, Fuel } from 'lucide-react'
import { getApiDocsUrl } from '@/lib/api'

export default function SettingsPage() {
  const router = useRouter()
  const apiDocsUrl = getApiDocsUrl()

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
  }, [])

  return (
    <div className="flex">
      <Sidebar />
      
      <main className="flex-1 bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
            <p className="text-gray-600 mt-1">Manage system configuration</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Company Settings */}
            <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-blue-100 p-3 rounded-lg">
                  <Building2 className="text-blue-600" size={24} />
                </div>
                <h3 className="text-lg font-semibold">Company</h3>
              </div>
              <p className="text-gray-600 text-sm mb-4">
                Manage company profile, fiscal settings, and preferences
              </p>
              <button className="text-blue-600 hover:text-blue-800 font-medium text-sm">
                Configure →
              </button>
            </div>

            {/* User Management */}
            <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-green-100 p-3 rounded-lg">
                  <Users className="text-green-600" size={24} />
                </div>
                <h3 className="text-lg font-semibold">Users & Roles</h3>
              </div>
              <p className="text-gray-600 text-sm mb-4">
                Manage users, assign roles, and configure permissions
              </p>
              <button className="text-green-600 hover:text-green-800 font-medium text-sm">
                Manage →
              </button>
            </div>

            {/* Station Management */}
            <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-purple-100 p-3 rounded-lg">
                  <Fuel className="text-purple-600" size={24} />
                </div>
                <h3 className="text-lg font-semibold">Stations</h3>
              </div>
              <p className="text-gray-600 text-sm mb-4">
                Configure stations, tanks, nozzles, and equipment
              </p>
              <button className="text-purple-600 hover:text-purple-800 font-medium text-sm">
                Setup →
              </button>
            </div>
          </div>

          {/* Quick Info */}
          <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex gap-3">
              <SettingsIcon className="text-blue-600 flex-shrink-0" size={24} />
              <div>
                <h4 className="font-semibold text-blue-900 mb-2">Configuration</h4>
                <p className="text-blue-800 text-sm">
                  Use the API index at <code className="bg-blue-100 px-2 py-1 rounded break-all">{apiDocsUrl}</code> (when Django DEBUG is on) to configure:
                </p>
                <ul className="mt-3 space-y-2 text-blue-800 text-sm">
                  <li>• Create company and stations</li>
                  <li>• Add tanks linked to products</li>
                  <li>• Configure islands, dispensers, meters, and nozzles for cashier POS</li>
                  <li>• Manage chart of accounts</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

















