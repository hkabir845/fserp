import api from '@/lib/api'
import { escapeHtml, printDocument } from '@/utils/printDocument'
import { loadPrintBranding } from '@/utils/printBranding'

/**
 * Print a simple HTML table (built by the caller) with company + station header.
 */
export async function printListView(options: {
  title: string
  subtitle?: string
  tableHtml: string
}): Promise<boolean> {
  const branding = await loadPrintBranding(api)
  return printDocument({
    title: options.title,
    branding,
    bodyHtml: `
      <h1>${escapeHtml(options.title)}</h1>
      ${
        options.subtitle
          ? `<p class="period">${escapeHtml(options.subtitle)}</p>`
          : ''
      }
      ${options.tableHtml}
    `,
  })
}
