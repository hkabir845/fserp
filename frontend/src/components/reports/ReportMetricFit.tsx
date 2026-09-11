/**
 * Report KPI card overflow helpers.
 *
 * Primary fit behavior lives in `globals.css` under `.report-body` /
 * `.report-metric-grid` / `.report-metric-inline` (container-relative font size).
 * Use these class strings when a card is outside that wrapper.
 */

/** Outer shell: enables container-relative font sizing and clips overflow. */
export const reportMetricCardClass =
  'report-metric-inline min-w-0 overflow-hidden'

/** Grid wrapper for KPI card rows outside `.report-body`. */
export const reportMetricGridClass = 'report-metric-grid'
