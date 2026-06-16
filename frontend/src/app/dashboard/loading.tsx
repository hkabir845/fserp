export default function DashboardLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 max-w-md text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-indigo-600 border-r-transparent mb-4" />
        <p className="text-gray-800 font-medium">Loading dashboard…</p>
        <p className="mt-2 text-sm text-gray-500">
          If this takes more than a few seconds, make sure the <strong>backend is running</strong> on port 8000
          and you are logged in. Run <code className="bg-gray-100 px-1 rounded">start-backend.bat</code> from the project folder, then refresh.
        </p>
      </div>
    </div>
  )
}
