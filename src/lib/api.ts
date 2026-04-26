import type { AppState } from './storage'
import type { UserRole } from '../types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

interface LoginResponse {
  token: string
  user: {
    username: string
    role: UserRole
  }
}

export async function loginRequest(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error('Invalid username or password')
  return res.json() as Promise<LoginResponse>
}

export async function fetchState(token: string): Promise<AppState> {
  const res = await fetch(`${API_BASE}/api/state`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch state')
  const json = await res.json() as { state: AppState }
  return json.state
}

export async function saveStateRemote(token: string, state: AppState): Promise<void> {
  const res = await fetch(`${API_BASE}/api/state`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ state }),
  })
  if (!res.ok) throw new Error('Failed to save state')
}
