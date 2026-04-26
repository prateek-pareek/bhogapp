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

export async function writeAuditLog(
  token: string,
  input: { action: string; details: string; eventId?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/audit-logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error('Failed to write audit log')
}

export async function createEventRequest(
  token: string,
  input: { name: string; date: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error('Failed to create event')
}

export async function createRegistrationRequest(
  token: string,
  input: {
    eventId: string
    name: string
    whatsapp: string
    quantity: number
    memberType: 'member' | 'non-member'
    source: 'on-spot' | 'pre-registered'
    paymentStatus: 'paid' | 'not-paid'
    paymentReference?: string
  },
): Promise<{ qrTokens: string[] }> {
  const res = await fetch(`${API_BASE}/api/registrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error('Failed to create registration')
  const json = await res.json() as { qrTokens?: string[] }
  return { qrTokens: json.qrTokens ?? [] }
}

export async function approveRegistrationRequest(token: string, registrationId: string): Promise<{ qrTokens: string[] }> {
  const res = await fetch(`${API_BASE}/api/registrations/${registrationId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to approve registration')
  const json = await res.json() as { qrTokens?: string[] }
  return { qrTokens: json.qrTokens ?? [] }
}

export async function scanCouponRequest(
  token: string,
  input: { qrToken: string; eventId: string; scannerDevice: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/coupons/scan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Failed to scan' }))
    throw new Error(body.message ?? 'Failed to scan')
  }
}

export async function createPaymentRequest(token: string, payload: Record<string, unknown>): Promise<{ receiptNumber: string; createdAt: string }> {
  const res = await fetch(`${API_BASE}/api/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to create payment')
  return res.json() as Promise<{ receiptNumber: string; createdAt: string }>
}

export async function rejectRegistrationRequest(token: string, registrationId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/registrations/${registrationId}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to reject registration')
}

export async function bulkCreateRegistrationsRequest(
  token: string,
  input: {
    rows: Array<Record<string, unknown>>
    defaults?: Record<string, unknown>
  },
): Promise<{ successCount: number; errors: string[] }> {
  const res = await fetch(`${API_BASE}/api/registrations/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error('Failed bulk upload')
  const json = await res.json() as { successCount: number; errors: string[] }
  return { successCount: json.successCount ?? 0, errors: json.errors ?? [] }
}
