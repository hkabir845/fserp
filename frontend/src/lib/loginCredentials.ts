/** Browser / Android password-manager helpers. Never persist the password in localStorage. */

const REMEMBER_USER_KEY = 'fserp_remember_username'

export function readRememberedUsername(): string {
  if (typeof window === 'undefined') return ''
  try {
    return (localStorage.getItem(REMEMBER_USER_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function persistRememberedUsername(username: string, remember: boolean): void {
  if (typeof window === 'undefined') return
  try {
    const trimmed = username.trim()
    if (remember && trimmed) localStorage.setItem(REMEMBER_USER_KEY, trimmed)
    else localStorage.removeItem(REMEMBER_USER_KEY)
  } catch {
    /* private mode / quota */
  }
}

/** Ask Chrome / Edge / Android to save the login after a successful sign-in. */
export async function storePasswordInBrowserManager(username: string, password: string): Promise<void> {
  const id = username.trim()
  if (typeof window === 'undefined' || !id || !password) return
  try {
    if (!navigator.credentials?.store || typeof PasswordCredential === 'undefined') return
    const cred = new PasswordCredential({ id, password, name: id })
    await navigator.credentials.store(cred)
  } catch {
    /* user declined or API unsupported */
  }
}

export async function readPasswordFromBrowserManager(): Promise<{
  username: string
  password: string
} | null> {
  if (typeof window === 'undefined' || !navigator.credentials?.get) return null
  try {
    const cred = await navigator.credentials.get({
      password: true,
      mediation: 'optional',
    })
    if (!cred || cred.type !== 'password') return null
    const pc = cred as PasswordCredential
    if (!pc.id || !pc.password) return null
    return { username: pc.id, password: pc.password }
  } catch {
    return null
  }
}
