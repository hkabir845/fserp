import { redirect } from 'next/navigation'

/** Server redirect — avoids a heavy client-only home page and long dev compiles on `/`. */
export default function HomePage() {
  redirect('/login')
}
