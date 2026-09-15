'use client'

export function RememberMeField({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border-2 border-primary/40 bg-primary/5 px-3 py-3">
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
