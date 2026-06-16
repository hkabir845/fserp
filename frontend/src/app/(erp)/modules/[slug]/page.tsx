import { redirect, notFound } from 'next/navigation'
import { getModuleHubBySlug, moduleSlugList } from '@/config/app-modules'
import { ModuleHub } from '@/components/ModuleHub'

export function generateStaticParams() {
  return moduleSlugList.map((slug) => ({ slug }))
}

export default function ModuleHubMirrorPage({ params }: { params: { slug: string } }) {
  const res = getModuleHubBySlug(params.slug)
  if (!res) notFound()
  if (res.kind === 'redirect') redirect(res.to)
  return <ModuleHub withLayout={false} title={res.title} subtitle={res.subtitle} links={res.links} />
}
