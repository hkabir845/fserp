import { redirect } from 'next/navigation'

/** Legacy / install entry — same PWA scope as /brain-app/login */
export default function BrainAppInstallPage() {
  redirect('/brain-app/login')
}
