'use client'

export function RememberMeField({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/50 px-3 py-2.5">
      <input
        type="checkbox"
        name="remember"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-border text-primary focus:ring-2 focus:ring-ring"
      />
      <span>
        <span className="block text-sm font-semibold text-foreground">Remember me</span>
        <span className="block text-xs text-muted-foreground">
          Save username and password on this device
        </span>
      </span>
    </label>
  )
}
