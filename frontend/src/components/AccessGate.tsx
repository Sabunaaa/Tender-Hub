import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { ParticleWave } from './ParticleWave'

const UNLOCKED_KEY = 'tender_unlocked'

function readUnlockedHint(): boolean {
  try {
    return sessionStorage.getItem(UNLOCKED_KEY) === '1'
  } catch {
    return false
  }
}

function writeUnlockedHint(value: boolean) {
  try {
    if (value) sessionStorage.setItem(UNLOCKED_KEY, '1')
    else sessionStorage.removeItem(UNLOCKED_KEY)
  } catch {
    // Private mode or blocked storage — cookie check still applies.
  }
}

async function authRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
  })
}

export async function lockSession() {
  try {
    await authRequest('/api/auth', { method: 'DELETE' })
  } catch {
    // Still lock the UI if the request fails.
  }
  window.dispatchEvent(new Event('tender-lock'))
}

export function AccessGate({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false)
  const [authed, setAuthed] = useState(readUnlockedHint)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const markAuthed = (value: boolean) => {
    writeUnlockedHint(value)
    setAuthed(value)
  }

  useEffect(() => {
    let cancelled = false
    authRequest('/api/auth')
      .then((res) => res.json() as Promise<{ ok?: boolean }>)
      .then((data) => {
        if (!cancelled) markAuthed(Boolean(data.ok))
      })
      .catch(() => {
        if (!cancelled) markAuthed(false)
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const lock = () => markAuthed(false)
    window.addEventListener('tender-lock', lock)
    return () => window.removeEventListener('tender-lock', lock)
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await authRequest('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string; error?: string } | null
        setError(payload?.error ?? payload?.detail ?? 'Incorrect password.')
        return
      }
      setPassword('')
      markAuthed(true)
    } catch {
      setError('Unable to verify password.')
    } finally {
      setSubmitting(false)
    }
  }

  if (authed) return children

  if (!authReady) {
    return <div className="access-screen" aria-busy="true" />
  }

  return (
    <div className="access-screen">
      <ParticleWave className="access-wave" />
      <form className="access-panel" onSubmit={submit}>
        <div className="access-brand">
          <div className="access-logo">
            <img src="/huawei-logo.png" alt="Huawei" width={96} height={96} />
          </div>
          <small>TENDER HUB</small>
        </div>
        <div className="access-fields">
          <div className="access-input-wrap">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              aria-label="Password"
            />
            <button
              type="submit"
              disabled={submitting || !password}
              aria-label={submitting ? 'Checking' : 'Unlock'}
            >
              {submitting ? <span className="access-spinner" /> : <ChevronRight size={18} strokeWidth={2.5} />}
            </button>
          </div>
        </div>
        {error && <p className="access-error">{error}</p>}
      </form>
    </div>
  )
}
