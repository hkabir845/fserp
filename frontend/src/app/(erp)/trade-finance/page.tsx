import { ModuleHub } from '@/components/ModuleHub'
import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { tradeFinanceHub } from '@/config/app-modules'

export default function TradeFinanceHubPage() {
  return (
    <div className="space-y-4 p-4">
      <ReportingHubBreadcrumb current="Trade finance hub" />
      <ModuleHub {...tradeFinanceHub} />
    </div>
  )
}
