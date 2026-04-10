'use client'

import { Droplet, Gauge } from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { getCurrencySymbol } from '@/utils/currency'

interface NozzleCardProps {
  nozzle: {
    nozzle_number: string
    nozzle_name: string
    meter_number: string
    meter_reading: number
    dispenser_number: string
    island_number: string
    tank_number: string
    tank_stock: number
    product_name: string
    product_price: number
    color_code?: string
    is_operational: boolean
  }
  onClick?: () => void
}

export default function NozzleCard({ nozzle, onClick }: NozzleCardProps) {
  const stockColor = nozzle.tank_stock > 1000 ? 'text-green-600' : nozzle.tank_stock > 500 ? 'text-yellow-600' : 'text-red-600'
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT

  useEffect(() => {
    // Fetch company currency
    const fetchCurrency = async () => {
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        console.error('Error fetching company currency:', error)
      }
    }
    fetchCurrency()
  }, [])

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border-l-4 ${
        nozzle.is_operational ? 'border-green-500' : 'border-red-500'
      }`}
      style={{ borderLeftColor: nozzle.color_code || undefined }}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-2xl font-bold text-gray-900">{nozzle.nozzle_number}</h3>
          <p className="text-sm text-gray-600">{nozzle.nozzle_name}</p>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
          nozzle.is_operational ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {nozzle.is_operational ? 'Active' : 'Inactive'}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-gray-600 font-medium">{nozzle.product_name}</span>
          <span className="text-lg font-bold text-blue-600">{currencySymbol}{nozzle.product_price.toFixed(2)}/L</span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Meter #</p>
            <p className="font-medium">{nozzle.meter_number}</p>
          </div>
          <div>
            <p className="text-gray-500">Dispenser #</p>
            <p className="font-medium">{nozzle.dispenser_number}</p>
          </div>
          <div>
            <p className="text-gray-500">Island #</p>
            <p className="font-medium">{nozzle.island_number}</p>
          </div>
          <div>
            <p className="text-gray-500">Tank #</p>
            <p className="font-medium">{nozzle.tank_number}</p>
          </div>
        </div>

        <div className="pt-3 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Droplet className={stockColor} size={18} />
              <span className="text-sm text-gray-600">Current Stock</span>
            </div>
            <span className={`text-lg font-bold ${stockColor}`}>
              {nozzle.tank_stock.toFixed(2)} L
            </span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="text-blue-600" size={18} />
              <span className="text-sm text-gray-600">Meter Reading</span>
            </div>
            <span className="text-lg font-bold text-blue-600">
              {nozzle.meter_reading.toFixed(2)} R
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

















