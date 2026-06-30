export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-border border-t-blue-600 mx-auto mb-4" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  )
}
