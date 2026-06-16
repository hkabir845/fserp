import { ModuleHub } from '@/components/ModuleHub'
import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { salesHub } from '@/config/app-modules'

export default function SalesHubPage() {
  return (
    <div className="space-y-4 p-4">
      <ReportingHubBreadcrumb current="Sales hub" />
      <ModuleHub withLayout={false} {...salesHub} />
    </div>
  )
}
