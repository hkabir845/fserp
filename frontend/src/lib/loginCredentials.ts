/** Browser / Android password-manager helpers. Never persist the password in localStorage. */

const REMEMBER_USER_KEY = 'fserp_remember_username'

type PasswordLikeCredential = Credential & { id: string; password?: string }

type PasswordCredentialCtor = new (data: {
  id: string
  password: string
  name?: string
}) => Credential

function passwordCredentialCtor(): PasswordCredentialCtor | null {
  if (typeof window === 'undefined') return null
  const ctor = (window as unknown as { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential
  return typeof ctor === 'function' ? ctor : null
}

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
  const Ctor = passwordCredentialCtor()
  if (!Ctor || !navigator.credentials?.store) return
  try {
    await navigator.credentials.store(new Ctor({ id, password, name: id }))
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
    const cred = (await navigator.credentials.get({
      password: true,
      mediation: 'optional',
    } as CredentialRequestOptions)) as PasswordLikeCredential | null
    if (!cred || cred.type !== 'password' || !cred.id || !cred.password) return null
    return { username: cred.id, password: cred.password }
  } catch {
    return null
  }
}
