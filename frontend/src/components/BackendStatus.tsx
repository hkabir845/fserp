'use client'

import { backendUrl, getBackendOrigin } from '@/lib/api'
import { useState, useEffect } from 'react'

export function BackendStatus() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(true)
  /** Set after mount only — getBackendOrigin() differs SSR vs browser (hydration-safe). */
  const [apiOriginHint, setApiOriginHint] = useState('')

  useEffect(() => {
    setApiOriginHint(getBackendOrigin() || 'same-origin · /health → Next proxy')

    const checkBackend = async () => {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000)
        
        const response = await fetch(backendUrl('/health'), {
          method: 'GET',
          mode: 'cors',
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        setIsOnline(response.ok)
      } catch (error) {
        setIsOnline(false)
      } finally {
        setChecking(false)
      }
    }

    checkBackend()
    // Check every 10 seconds
    const interval = setInterval(checkBackend, 10000)
    return () => clearInterval(interval)
  }, [])

  if (checking) {
    return (
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-lg shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
          <div className="text-sm font-semibold text-amber-900">Checking backend connection…</div>
          <div className="text-xs text-amber-800">
            {apiOriginHint || '—'}
          </div>
        </div>
      </div>
    )
  }

  if (!isOnline) {
    return (
      <div className="bg-red-50 border-l-4 border-red-500 p-6 mb-6 rounded-lg shadow-lg">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-6 w-6 text-red-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-4 flex-1">
            <h3 className="text-lg font-bold text-red-800 mb-2">
              ⚠️ Backend Server is NOT Running!
            </h3>
            <p className="text-sm text-red-700 mb-4">
              The CORS errors you're seeing are because the backend server is not running. 
              The frontend cannot connect to the API without the backend.
            </p>
            <p className="text-sm text-red-800 mb-4 rounded border border-red-200 bg-red-100/50 p-3">
              <strong>FMERP API is FastAPI (Uvicorn)</strong> on port 8000 — not{' '}
              <code className="rounded bg-white px-1">python manage.py runserver</code> (Django). Stop anything else
              bound to 8000, then start the backend from the repo root with{' '}
              <code className="rounded bg-white px-1">start-backend.bat</code> or:{' '}
              <code className="rounded bg-white px-1 text-xs block mt-1">
                cd backend; python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
              </code>
            </p>
            <div className="bg-white p-4 rounded border border-red-200 mb-4">
              <p className="font-semibold text-red-800 mb-2">To Fix This:</p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-red-700">
                <li>Go to the project root folder</li>
                <li>Double-click: <code className="bg-red-100 px-2 py-1 rounded font-mono">start-backend.bat</code></li>
                <li>Wait for the backend window to show "Uvicorn running on http://127.0.0.1:8000"</li>
                <li>Refresh this page (F5)</li>
              </ol>
            </div>
            <div className="flex gap-2">
              <a
                href="http://localhost:8000/health"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700"
              >
                Test Backend Health
              </a>
              <a
                href="http://localhost:8000/api/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-md hover:bg-gray-700"
              >
                Open API Docs
              </a>
            </div>
            <p className="mt-4 text-xs text-red-600">
              <strong>Note:</strong> If the links above don't work, the backend is definitely not running.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return null
}
