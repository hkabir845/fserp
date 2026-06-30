export default function DashboardLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center bg-muted/40 px-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <div
          className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary"
          aria-hidden
        />
        Loading dashboard…
      </div>
    </div>
  )
}
