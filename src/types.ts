export type UserRole = 'admin' | 'reception' | 'collector' | 'scanner'

export type MemberType = 'member' | 'non-member'
export type SourceType = 'pre-registered' | 'on-spot'
export type PaymentStatus = 'paid' | 'not-paid'
export type PaymentMode = 'cash' | 'online'
export type PaymentPurpose = 'donation' | 'membership' | 'other'

export interface Event {
  id: string
  name: string
  date: string
}

export interface UserSession {
  username: string
  role: UserRole
}

export interface Registration {
  id: string
  eventId: string
  name: string
  whatsapp: string
  quantity: number
  memberType: MemberType
  source: SourceType
  paymentStatus: PaymentStatus
  paymentReference?: string
  status: 'pending' | 'confirmed' | 'cancelled'
  createdAt: string
  updatedAt: string
}

export interface Coupon {
  id: string
  eventId: string
  registrationId: string
  qrToken: string
  consumedAt?: string
  scannerUser?: string
  scannerRole?: UserRole
  scannerDevice?: string
  createdAt: string
}

export interface Payment {
  id: string
  receiptNumber: string
  name: string
  phone: string
  amount: number
  memberType: MemberType
  memberId?: string
  newMember: boolean
  mode: PaymentMode
  transactionId?: string
  purpose: PaymentPurpose
  trustAccount: string
  collectorName: string
  createdAt: string
}

export interface AuditLog {
  id: string
  action: string
  actor: string
  role: UserRole
  eventId?: string
  createdAt: string
  details: string
}
