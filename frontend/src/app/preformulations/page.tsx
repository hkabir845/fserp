'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface PreFormulation {
  id: number
  code: string
  title: string
  category: string
  species: string
  stage: string
  process_type: string
  float_type?: string
  pellet_mm?: number
  default_batch_kg: number
  protein_target_min?: number
  protein_target_max?: number
  is_reference_only: boolean
  is_active: boolean
}

interface Filters {
  categories: string[]
  species: string[]
  stages: string[]
  process_types: string[]
  pellet_sizes_mm: number[]
  float_types: string[]
}

export default function PreFormulationsPage() {
  const router = useRouter()
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedSpecies, setSelectedSpecies] = useState<string>('')
  const [selectedStage, setSelectedStage] = useState<string>('')
  const [selectedProcessType, setSelectedProcessType] = useState<string>('')
  const [selectedPelletMm, setSelectedPelletMm] = useState<number | ''>('')
  const [selectedFloatType, setSelectedFloatType] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Fetch filters
  const { data: filters } = useQuery<Filters>({
    queryKey: ['preform-filters', selectedCategory, selectedSpecies, selectedStage, selectedProcessType],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedCategory) params.append('category', selectedCategory)
      if (selectedSpecies) params.append('species', selectedSpecies)
      if (selectedStage) params.append('stage', selectedStage)
      if (selectedProcessType) params.append('process_type', selectedProcessType)
      
      const response = await api.get(`/preformulations/filters?${params.toString()}`)
      return response.data
    }
  })

  // Fetch pre-formulations
  const { data: preformulations, isLoading } = useQuery<PreFormulation[]>({
    queryKey: ['preformulations', selectedCategory, selectedSpecies, selectedStage, selectedProcessType, selectedPelletMm, selectedFloatType, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedCategory) params.append('category', selectedCategory)
      if (selectedSpecies) params.append('species', selectedSpecies)
      if (selectedStage) params.append('stage', selectedStage)
      if (selectedProcessType) params.append('process_type', selectedProcessType)
      if (selectedPelletMm) params.append('pellet_mm', selectedPelletMm.toString())
      if (selectedFloatType) params.append('float_type', selectedFloatType)
      if (searchQuery) params.append('q', searchQuery)
      
      const response = await api.get(`/preformulations?${params.toString()}`)
      return response.data
    }
  })

  const handleRowClick = (id: number) => {
    router.push(`/preformulations/${id}`)
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-2">Pre-Formulation Library</h1>
        <p className="text-muted-foreground">World Standard Pre-Formulation Templates</p>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {/* Search */}
          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-foreground/85 mb-1">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Code or title..."
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-foreground/85 mb-1">Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value)
                setSelectedSpecies('')
                setSelectedStage('')
              }}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All</option>
              {filters?.categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Species */}
          <div>
            <label className="block text-sm font-medium text-foreground/85 mb-1">Species</label>
            <select
              value={selectedSpecies}
              onChange={(e) => {
                setSelectedSpecies(e.target.value)
                setSelectedStage('')
              }}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={!selectedCategory}
            >
              <option value="">All</option>
              {filters?.species.map(sp => (
                <option key={sp} value={sp}>{sp}</option>
              ))}
            </select>
          </div>

          {/* Stage */}
          <div>
            <label className="block text-sm font-medium text-foreground/85 mb-1">Stage</label>
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All</option>
              {filters?.stages.map(stage => (
                <option key={stage} value={stage}>{stage}</option>
              ))}
            </select>
          </div>

          {/* Process Type */}
          <div>
            <label className="block text-sm font-medium text-foreground/85 mb-1">Process</label>
            <select
              value={selectedProcessType}
              onChange={(e) => setSelectedProcessType(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All</option>
              {filters?.process_types.map(pt => (
                <option key={pt} value={pt}>{pt}</option>
              ))}
            </select>
          </div>

          {/* Pellet Size (for Fish) */}
          {selectedCategory === 'Fish' && (
            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">Pellet (mm)</label>
              <select
                value={selectedPelletMm}
                onChange={(e) => setSelectedPelletMm(e.target.value ? parseFloat(e.target.value) : '')}
                className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All</option>
                {filters?.pellet_sizes_mm.map(size => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          )}

          {/* Float Type (for Fish) */}
          {selectedCategory === 'Fish' && (
            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">Float Type</label>
              <select
                value={selectedFloatType}
                onChange={(e) => setSelectedFloatType(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All</option>
                {filters?.float_types.map(ft => (
                  <option key={ft} value={ft}>{ft}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Clear Filters */}
        <div className="mt-4">
          <button
            onClick={() => {
              setSelectedCategory('')
              setSelectedSpecies('')
              setSelectedStage('')
              setSelectedProcessType('')
              setSelectedPelletMm('')
              setSelectedFloatType('')
              setSearchQuery('')
            }}
            className="text-sm text-primary hover:text-foreground/85"
          >
            Clear All Filters
          </button>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Species</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Stage</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Process</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Pellet (mm)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Protein %</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-4 text-center text-muted-foreground">Loading...</td>
                </tr>
              ) : preformulations && preformulations.length > 0 ? (
                preformulations.map((preform) => (
                  <tr
                    key={preform.id}
                    onClick={() => handleRowClick(preform.id)}
                    className="hover:bg-muted/40 cursor-pointer"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">{preform.code}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">{preform.title}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{preform.category}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{preform.species}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{preform.stage}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{preform.process_type}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {preform.pellet_mm ? `${preform.pellet_mm} mm` : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {preform.protein_target_min && preform.protein_target_max
                        ? `${preform.protein_target_min}-${preform.protein_target_max}%`
                        : '-'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-4 text-center text-muted-foreground">No pre-formulations found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}





