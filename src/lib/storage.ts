import type { AuditLog, Coupon, Event, Payment, Registration } from '../types'

const KEY = 'bhogapp-state-v1'

export interface AppState {
  events: Event[]
  registrations: Registration[]
  coupons: Coupon[]
  payments: Payment[]
  auditLogs: AuditLog[]
}

const initialState: AppState = {
  events: [
    {
      id: 'evt-1',
      name: 'Sunday Bhog',
      date: new Date().toISOString().slice(0, 10),
    },
  ],
  registrations: [],
  coupons: [],
  payments: [],
  auditLogs: [],
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initialState
    return { ...initialState, ...JSON.parse(raw) as AppState }
  } catch {
    return initialState
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function toCsv<T extends object>(rows: T[]): string {
  if (!rows.length) return ''
  const columns = Object.keys(rows[0] as Record<string, unknown>)
  const escaped = (value: unknown) =>
    `"${String(value ?? '').replaceAll('"', '""')}"`

  const header = columns.join(',')
  const body = rows
    .map((row) =>
      columns
        .map((col) => escaped((row as Record<string, unknown>)[col]))
        .join(','),
    )
    .join('\n')
  return `${header}\n${body}`
}
