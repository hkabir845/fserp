export type EntityAnalyticsRow = {
  entity_type: string
  entity_id: number
  entity_name: string
  document_sales: number
  pl_income: number
  pl_cogs: number
  pl_expenses: number
  gross_profit: number
  net_income: number
  management_revenue_bdt?: number
  management_profit_bdt?: number
}

export type AquacultureAnalyticsSummary = {
  active_ponds: number
  total_pond_sales_bdt: number
  total_management_revenue_bdt: number
  total_management_profit_bdt: number
}
