/**
 * Shared modal viewport sizes — match Aquaculture sales listing (`max-w-[1440px]`).
 * Use FORM for large create/edit dialogs; COMPACT / CONFIRM for short forms.
 */

/** Same width as AquaculturePageShell default and /aquaculture/sales listing. */
export const ERP_PAGE_VIEWPORT = 'max-w-[1440px]' as const

/** Full-screen dimmed overlay for centered modals. */
export const MODAL_BACKDROP =
  'fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-3 sm:p-6'

/** Large data-entry modal (header + scroll body + footer), matches Record pond sale. */
export const MODAL_FORM_PANEL =
  'flex max-h-[96vh] w-full max-w-[1440px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-border'

/** Large scrollable form without fixed header/footer chrome. */
export const MODAL_FORM_SCROLL =
  'max-h-[96vh] w-full max-w-[1440px] overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-border app-modal-pad'

/** Medium forms (few fields): finalize, ledger entry, edit single row. */
export const MODAL_COMPACT_SCROLL =
  'max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl ring-1 ring-border'

/** Confirm / delete / pick-one dialogs. */
export const MODAL_CONFIRM =
  'w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl ring-1 ring-border'
