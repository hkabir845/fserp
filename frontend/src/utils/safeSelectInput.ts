/** Select all text in an input without throwing when the browser blocks programmatic select. */
export function safeSelectInput(el: HTMLInputElement | null | undefined): void {
  if (!el) return
  try {
    el.select()
  } catch {
    // NotAllowedError: select() must run during the user activation that focused the field.
  }
}
