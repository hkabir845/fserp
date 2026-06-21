export default function DashboardLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center bg-slate-50 px-4">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <div
          className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600"
          aria-hidden
        />
        Loading dashboard…
      </div>
    </div>
  )
}
