import { useMemo, useState, type ChangeEvent } from 'react'
import dayjs from 'dayjs'
import { v4 as uuid } from 'uuid'
import * as XLSX from 'xlsx'
import './App.css'
import { fetchState, loginRequest, saveStateRemote } from './lib/api'
import { buildQrToken, downloadTextFile } from './lib/qr'
import { loadState, saveState, toCsv, type AppState } from './lib/storage'
import type {
  AuditLog,
  Coupon,
  Event,
  MemberType,
  Payment,
  PaymentMode,
  PaymentPurpose,
  PaymentStatus,
  Registration,
  UserRole,
  UserSession,
} from './types'

type Tab = 'events' | 'issue' | 'scan' | 'pre-reg' | 'payments' | 'reports' | 'audit'

const roleTabs: Record<UserRole, Tab[]> = {
  admin: ['events', 'issue', 'scan', 'pre-reg', 'payments', 'reports', 'audit'],
  reception: ['scan'],
  collector: ['payments', 'reports'],
  scanner: ['scan'],
}

function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [session, setSession] = useState<UserSession | null>(null)
  const [authToken, setAuthToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('scan')
  const [loginForm, setLoginForm] = useState({ role: 'admin' as UserRole, username: '', password: '' })
  const [scanToken, setScanToken] = useState('')
  const [selectedEventId, setSelectedEventId] = useState(state.events[0]?.id ?? '')
  const [newEvent, setNewEvent] = useState({ name: '', date: dayjs().format('YYYY-MM-DD') })
  const [reportDate, setReportDate] = useState('')

  const [issueForm, setIssueForm] = useState({
    name: '',
    whatsapp: '',
    quantity: 1,
    memberType: 'member' as MemberType,
    eventId: state.events[0]?.id ?? '',
  })

  const [preRegForm, setPreRegForm] = useState({
    name: '',
    whatsapp: '',
    quantity: 1,
    memberType: 'non-member' as MemberType,
    paymentStatus: 'not-paid' as PaymentStatus,
    paymentRef: '',
    eventId: state.events[0]?.id ?? '',
  })

  const [paymentForm, setPaymentForm] = useState({
    name: '',
    phone: '',
    amount: 0,
    memberType: 'member' as MemberType,
    memberId: '',
    newMember: false,
    mode: 'cash' as PaymentMode,
    transactionId: '',
    purpose: 'donation' as PaymentPurpose,
    trustAccount: 'Trust',
    collectorName: '',
  })

  const couponsByEvent = useMemo(() => {
    const map = new Map<string, Coupon[]>()
    for (const coupon of state.coupons) {
      const list = map.get(coupon.eventId) ?? []
      list.push(coupon)
      map.set(coupon.eventId, list)
    }
    return map
  }, [state.coupons])

  const selectedEvent = state.events.find((event) => event.id === selectedEventId) ?? state.events[0]

  const eventRegistrations = useMemo(
    () => state.registrations.filter((registration) => registration.eventId === selectedEvent?.id),
    [selectedEvent?.id, state.registrations],
  )

  const eventCoupons = useMemo(
    () => couponsByEvent.get(selectedEvent?.id ?? '') ?? [],
    [couponsByEvent, selectedEvent?.id],
  )

  const scannedCount = eventCoupons.filter((coupon) => coupon.consumedAt).length

  const updateState = async (next: AppState) => {
    setState(next)
    saveState(next)
    if (authToken) {
      try {
        await saveStateRemote(authToken, next)
      } catch {
        alert('Failed to sync to server. Check backend connection.')
      }
    }
  }

  const pushStateAndLog = async (nextState: AppState, action: string, details: string, eventId?: string) => {
    const log: AuditLog = {
      id: uuid(),
      action,
      details,
      actor: session?.username ?? 'system',
      role: session?.role ?? 'admin',
      eventId,
      createdAt: new Date().toISOString(),
    }
    await updateState({ ...nextState, auditLogs: [log, ...nextState.auditLogs] })
  }

  const openWhatsApp = (phone: string, message: string) => {
    const url = `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const login = async () => {
    if (!loginForm.username.trim()) {
      alert('Enter username')
      return
    }
    setIsLoading(true)
    try {
      const result = await loginRequest(loginForm.username.trim(), loginForm.password)
      setSession(result.user)
      setAuthToken(result.token)
      const remoteState = await fetchState(result.token)
      setState(remoteState)
      saveState(remoteState)
      const firstEvent = remoteState.events[0]?.id ?? ''
      setSelectedEventId(firstEvent)
      setIssueForm((prev) => ({ ...prev, eventId: firstEvent }))
      setPreRegForm((prev) => ({ ...prev, eventId: firstEvent }))
      setActiveTab(roleTabs[result.user.role][0])
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  const createEvent = () => {
    if (!newEvent.name.trim() || !newEvent.date) return
    const event: Event = { id: uuid(), name: newEvent.name.trim(), date: newEvent.date }
    const nextState = { ...state, events: [event, ...state.events] }
    setSelectedEventId(event.id)
    setIssueForm({ ...issueForm, eventId: event.id })
    setPreRegForm({ ...preRegForm, eventId: event.id })
    pushStateAndLog(nextState, 'event.create', `Created event ${event.name} (${event.date})`, event.id)
    setNewEvent({ name: '', date: dayjs().format('YYYY-MM-DD') })
  }

  const generateCouponsForRegistration = (registration: Registration, now: string) =>
    Array.from({ length: registration.quantity }).map(() => ({
      id: uuid(),
      eventId: registration.eventId,
      registrationId: registration.id,
      qrToken: buildQrToken(registration.eventId),
      createdAt: now,
    }))

  const sendRegistrationQrsWhatsApp = (registration: Registration, coupons: Coupon[]) => {
    const event = state.events.find((item) => item.id === registration.eventId)
    const lines = coupons.map((coupon, index) => `${index + 1}. ${coupon.qrToken}`)
    const message = [
      `Jai Shree Krishna ${registration.name},`,
      `Your Bhog entry QR(s) for ${event?.name ?? 'event'} (${event?.date ?? ''}):`,
      ...lines,
      'Each QR is valid for one person and can be scanned once.',
    ].join('\n')
    openWhatsApp(registration.whatsapp, message)
  }

  if (!session) {
    return (
      <main className="container">
        <h1>Bhog Coupons + Collection PWA</h1>
        <p>Secure role login. Reception is scan-only by design.</p>
        <section className="card" style={{ maxWidth: 460 }}>
          <select value={loginForm.role} onChange={(e) => setLoginForm({ ...loginForm, role: e.target.value as UserRole })}>
            <option value="admin">Admin</option>
            <option value="reception">Reception</option>
            <option value="collector">Collector</option>
            <option value="scanner">Scanner</option>
          </select>
          <input placeholder="Username" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
          <input type="password" placeholder="Password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
          <button onClick={() => void login()} disabled={isLoading}>
            {isLoading ? 'Signing in...' : 'Login'}
          </button>
        </section>
      </main>
    )
  }

  const tabs = roleTabs[session.role]

  const issueOnSpot = () => {
    if (!issueForm.name || !issueForm.whatsapp || !selectedEvent?.id || issueForm.quantity < 1) return alert('Fill required fields.')
    const now = new Date().toISOString()
    const registrationId = uuid()
    const registration: Registration = {
      id: registrationId,
      eventId: selectedEvent.id,
      name: issueForm.name,
      whatsapp: issueForm.whatsapp,
      quantity: issueForm.quantity,
      memberType: issueForm.memberType,
      source: 'on-spot' as const,
      paymentStatus: 'paid' as const,
      status: 'confirmed' as const,
      createdAt: now,
      updatedAt: now,
    }
    const coupons = generateCouponsForRegistration(registration, now)
    const nextState = {
      ...state,
      registrations: [registration, ...state.registrations],
      coupons: [...coupons, ...state.coupons],
    }
    pushStateAndLog(nextState, 'bhog.issue.manual', `Issued ${coupons.length} QR(s) for ${registration.name}`, registration.eventId)
    sendRegistrationQrsWhatsApp(registration, coupons)
  }

  const scanCoupon = () => {
    const coupon = state.coupons.find((item) => item.qrToken === scanToken.trim())
    if (!coupon) return alert('Invalid QR token.')
    if (coupon.consumedAt) return alert('QR already scanned.')
    if (selectedEvent && coupon.eventId !== selectedEvent.id) return alert('QR belongs to another event.')
    const nextCoupons = state.coupons.map((item) =>
      item.id === coupon.id
        ? {
            ...item,
            consumedAt: new Date().toISOString(),
            scannerUser: session.username,
            scannerRole: session.role,
            scannerDevice: navigator.userAgent,
          }
        : item,
    )
    pushStateAndLog({ ...state, coupons: nextCoupons }, 'bhog.scan', `Scanned token ${coupon.qrToken}`, coupon.eventId)
    setScanToken('')
  }

  const addPreReg = () => {
    if (!preRegForm.name || !preRegForm.whatsapp || !selectedEvent?.id) return
    const now = new Date().toISOString()
    const id = uuid()
    const paid = preRegForm.paymentStatus === 'paid'
    const registration: Registration = {
      id,
      eventId: selectedEvent.id,
      name: preRegForm.name,
      whatsapp: preRegForm.whatsapp,
      quantity: preRegForm.quantity,
      memberType: preRegForm.memberType,
      source: 'pre-registered' as const,
      paymentStatus: preRegForm.paymentStatus,
      paymentReference: preRegForm.paymentRef,
      status: paid ? 'confirmed' as const : 'pending' as const,
      createdAt: now,
      updatedAt: now,
    }
    const coupons = paid ? generateCouponsForRegistration(registration, now) : []
    const nextState = {
      ...state,
      registrations: [registration, ...state.registrations],
      coupons: [...coupons, ...state.coupons],
    }
    pushStateAndLog(
      nextState,
      'pre-registration.create',
      paid ? `Pre-registration confirmed for ${registration.name}` : `Pre-registration pending for ${registration.name}`,
      registration.eventId,
    )
    if (paid) {
      sendRegistrationQrsWhatsApp(registration, coupons)
    } else {
      openWhatsApp(registration.whatsapp, 'Registration received, payment pending. Please complete payment for QR issue.')
    }
  }

  const approvePending = (registrationId: string) => {
    const registration = state.registrations.find((item) => item.id === registrationId)
    if (!registration || registration.status !== 'pending') return
    const now = new Date().toISOString()
    const coupons = generateCouponsForRegistration(registration, now)
    const registrations = state.registrations.map((item) =>
      item.id === registrationId
        ? { ...item, status: 'confirmed' as const, paymentStatus: 'paid' as const, updatedAt: now }
        : item,
    )
    const nextState = { ...state, registrations, coupons: [...coupons, ...state.coupons] }
    pushStateAndLog(nextState, 'pre-registration.approve', `Approved ${registration.name} and issued QR`, registration.eventId)
    sendRegistrationQrsWhatsApp(registration, coupons)
  }

  const rejectPreRegistration = (registrationId: string) => {
    const registration = state.registrations.find((item) => item.id === registrationId)
    if (!registration) return
    const registrations = state.registrations.map((item) =>
      item.id === registrationId ? { ...item, status: 'cancelled' as const, updatedAt: new Date().toISOString() } : item,
    )
    pushStateAndLog({ ...state, registrations }, 'pre-registration.reject', `Rejected ${registration.name}`, registration.eventId)
  }

  const addPayment = () => {
    if (!paymentForm.name || !paymentForm.phone || paymentForm.amount <= 0 || !paymentForm.collectorName) return
    const createdAt = new Date().toISOString()
    const payment: Payment = {
      id: uuid(),
      receiptNumber: `RCPT-${dayjs(createdAt).format('YYYYMMDD')}-${String(state.payments.length + 1).padStart(4, '0')}`,
      name: paymentForm.name,
      phone: paymentForm.phone,
      amount: paymentForm.amount,
      memberType: paymentForm.memberType,
      memberId: paymentForm.memberId || undefined,
      newMember: paymentForm.newMember,
      mode: paymentForm.mode,
      transactionId: paymentForm.transactionId || undefined,
      purpose: paymentForm.purpose,
      trustAccount: paymentForm.trustAccount,
      collectorName: paymentForm.collectorName,
      createdAt,
    }
    const nextState = { ...state, payments: [payment, ...state.payments] }
    pushStateAndLog(nextState, 'payment.create', `Created receipt ${payment.receiptNumber} for ${payment.name}`)
    const receiptText = [
      `Receipt: ${payment.receiptNumber}`,
      `Date: ${dayjs(payment.createdAt).format('DD MMM YYYY HH:mm')}`,
      `Purpose: ${payment.purpose}`,
      `Amount: ${payment.amount}`,
      `Mode: ${payment.mode}`,
      `Trust: ${payment.trustAccount}`,
      `Transaction ID: ${payment.transactionId ?? 'N/A'}`,
    ].join('\n')
    openWhatsApp(payment.phone, `Thank you. Payment received.\n${receiptText}`)
  }

  const parseUploadRows = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  }

  const bulkUploadBhog = async (file: File) => {
    const rows = await parseUploadRows(file)
    const now = new Date().toISOString()
    const newRegistrations: Registration[] = []
    const newCoupons: Coupon[] = []
    const errors: string[] = []
    for (const [index, row] of rows.entries()) {
      const name = String(row.Name ?? row.name ?? '').trim()
      const whatsapp = String(row['WhatsApp Number'] ?? row.whatsapp ?? '').trim()
      const quantity = Number(row.Quantity ?? row.quantity ?? 0)
      const eventName = String(row['Event Name'] ?? row.event ?? '').trim()
      const eventDate = String(row['Event Date'] ?? row.date ?? selectedEvent?.date ?? '').trim()
      if (!name || !whatsapp || quantity < 1) {
        errors.push(`Row ${index + 2}: invalid required data`)
        continue
      }
      let eventId = selectedEvent?.id ?? ''
      if (eventName) {
        const existing = state.events.find((event) => event.name === eventName && event.date === eventDate)
        if (existing) eventId = existing.id
      }
      if (!eventId) {
        errors.push(`Row ${index + 2}: event not found`)
        continue
      }
      const registration: Registration = {
        id: uuid(),
        eventId,
        name,
        whatsapp,
        quantity,
        memberType: 'non-member',
        source: 'on-spot',
        paymentStatus: 'paid',
        status: 'confirmed',
        createdAt: now,
        updatedAt: now,
      }
      newRegistrations.push(registration)
      newCoupons.push(...generateCouponsForRegistration(registration, now))
    }
    const nextState = {
      ...state,
      registrations: [...newRegistrations, ...state.registrations],
      coupons: [...newCoupons, ...state.coupons],
    }
    pushStateAndLog(
      nextState,
      'bhog.bulk-upload',
      `Bulk uploaded ${newRegistrations.length} registrations with ${newCoupons.length} QRs`,
      selectedEvent?.id,
    )
    alert(errors.length ? `Upload done with errors:\n${errors.slice(0, 6).join('\n')}` : 'Bulk upload successful.')
  }

  const bulkUploadPreReg = async (file: File) => {
    const rows = await parseUploadRows(file)
    const now = new Date().toISOString()
    const newRegistrations: Registration[] = []
    const newCoupons: Coupon[] = []
    for (const row of rows) {
      const rawStatus = String(row['Payment Status'] ?? row.paymentStatus ?? 'Not Paid').trim().toLowerCase()
      const paymentStatus: PaymentStatus = rawStatus === 'paid' ? 'paid' : 'not-paid'
      const registration: Registration = {
        id: uuid(),
        eventId: selectedEvent?.id ?? '',
        name: String(row.Name ?? '').trim(),
        whatsapp: String(row['WhatsApp Number'] ?? '').trim(),
        quantity: Number(row.Quantity ?? 1),
        memberType: 'non-member',
        source: 'pre-registered',
        paymentStatus,
        paymentReference: String(row['Payment Reference'] ?? '').trim() || undefined,
        status: paymentStatus === 'paid' ? 'confirmed' : 'pending',
        createdAt: now,
        updatedAt: now,
      }
      if (!registration.name || !registration.whatsapp || !registration.eventId || registration.quantity < 1) continue
      newRegistrations.push(registration)
      if (registration.paymentStatus === 'paid') {
        newCoupons.push(...generateCouponsForRegistration(registration, now))
      }
    }
    pushStateAndLog(
      {
        ...state,
        registrations: [...newRegistrations, ...state.registrations],
        coupons: [...newCoupons, ...state.coupons],
      },
      'pre-registration.bulk-upload',
      `Imported ${newRegistrations.length} pre-registrations`,
      selectedEvent?.id,
    )
  }

  const downloadBhogReport = () => {
    const rows = eventRegistrations.map((registration) => {
      const issued = state.coupons.filter((coupon) => coupon.registrationId === registration.id)
      const scanned = issued.filter((coupon) => coupon.consumedAt)
      return {
        eventName: selectedEvent?.name ?? '',
        eventDate: selectedEvent?.date ?? '',
        name: registration.name,
        phone: registration.whatsapp,
        quantity: registration.quantity,
        memberType: registration.memberType,
        source: registration.source,
        paymentStatus: registration.paymentStatus,
        registrationStatus: registration.status,
        qrIssuedCount: issued.length,
        qrScannedCount: scanned.length,
        scanTimestamps: scanned.map((coupon) => coupon.consumedAt).join(' | '),
      }
    })
    downloadTextFile('bhog-report.csv', toCsv(rows))
  }

  const downloadPaymentReport = () => {
    const filtered = reportDate
      ? state.payments.filter((payment) => payment.createdAt.slice(0, 10) === reportDate)
      : state.payments
    downloadTextFile('payment-report.csv', toCsv(filtered))
  }

  const onUpload = async (event: ChangeEvent<HTMLInputElement>, type: 'bhog' | 'pre-reg') => {
    const file = event.target.files?.[0]
    if (!file) return
    if (type === 'bhog') await bulkUploadBhog(file)
    else await bulkUploadPreReg(file)
    event.target.value = ''
  }

  return (
    <main className="container">
      <header className="row">
        <h1>Bhog System PWA</h1>
        <div className="row">
          <span>{session.username} ({session.role})</span>
          <button
            onClick={() => {
              setSession(null)
              setAuthToken('')
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <section className="row card">
        <label>Active Event</label>
        <select value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)}>
          {state.events.map((event) => (
            <option key={event.id} value={event.id}>{event.name} - {event.date}</option>
          ))}
        </select>
      </section>

      <nav className="row">
        {tabs.map((tab) => (
          <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === 'events' && (
        <section className="grid">
          <article className="card">
            <h2>Create Event</h2>
            <input placeholder="Event Name" value={newEvent.name} onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })} />
            <input type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} />
            <button onClick={createEvent}>Create Event</button>
          </article>
        </section>
      )}

      {activeTab === 'issue' && (
        <section className="grid">
          <article className="card">
            <h2>Manual Bhog Issuance (On-Spot)</h2>
            <input placeholder="Name" value={issueForm.name} onChange={(e) => setIssueForm({ ...issueForm, name: e.target.value })} />
            <input placeholder="WhatsApp Number" value={issueForm.whatsapp} onChange={(e) => setIssueForm({ ...issueForm, whatsapp: e.target.value })} />
            <input type="number" min={1} value={issueForm.quantity} onChange={(e) => setIssueForm({ ...issueForm, quantity: Number(e.target.value) })} />
            <select value={issueForm.memberType} onChange={(e) => setIssueForm({ ...issueForm, memberType: e.target.value as MemberType })}>
              <option value="member">Member</option>
              <option value="non-member">Non-Member / Guest</option>
            </select>
            <button onClick={issueOnSpot}>Issue QR(s) + Send WhatsApp</button>
          </article>
          <article className="card">
            <h2>Bulk Bhog Upload (Excel/CSV)</h2>
            <p>Columns: Name, WhatsApp Number, Quantity, Event Name, Event Date</p>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void onUpload(event, 'bhog')} />
          </article>
        </section>
      )}

      {activeTab === 'scan' && (
        <section className="grid">
          <article className="card">
            <h2>QR Scan & Validation</h2>
            <input placeholder="Paste / scan QR token" value={scanToken} onChange={(e) => setScanToken(e.target.value)} />
            <button onClick={scanCoupon}>Validate & Consume</button>
            <p>Event: {selectedEvent?.name}</p>
            <p>Issued: {eventCoupons.length}</p>
            <p>Scanned: {scannedCount}</p>
            <p>Remaining: {eventCoupons.length - scannedCount}</p>
          </article>
        </section>
      )}

      {activeTab === 'pre-reg' && (
        <section className="grid">
          <article className="card">
            <h2>Pre-Registration Entry</h2>
            <input placeholder="Name" value={preRegForm.name} onChange={(e) => setPreRegForm({ ...preRegForm, name: e.target.value })} />
            <input placeholder="WhatsApp Number" value={preRegForm.whatsapp} onChange={(e) => setPreRegForm({ ...preRegForm, whatsapp: e.target.value })} />
            <input type="number" min={1} value={preRegForm.quantity} onChange={(e) => setPreRegForm({ ...preRegForm, quantity: Number(e.target.value) })} />
            <select value={preRegForm.memberType} onChange={(e) => setPreRegForm({ ...preRegForm, memberType: e.target.value as MemberType })}>
              <option value="member">Member</option>
              <option value="non-member">Non-Member</option>
            </select>
            <select value={preRegForm.paymentStatus} onChange={(e) => setPreRegForm({ ...preRegForm, paymentStatus: e.target.value as PaymentStatus })}>
              <option value="paid">Paid</option>
              <option value="not-paid">Not Paid</option>
            </select>
            <input placeholder="Payment Reference (optional)" value={preRegForm.paymentRef} onChange={(e) => setPreRegForm({ ...preRegForm, paymentRef: e.target.value })} />
            <button onClick={addPreReg}>Save Pre-Registration</button>
          </article>
          <article className="card">
            <h2>Pre-Registration Bulk Upload</h2>
            <p>Columns: Name, WhatsApp Number, Quantity, Payment Status, Payment Reference</p>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void onUpload(event, 'pre-reg')} />
          </article>
          <article className="card">
            <h2>Pending Approvals</h2>
            {state.registrations
              .filter((item) => item.status === 'pending' && item.eventId === selectedEvent?.id)
              .map((item) => (
                <div className="row" key={item.id}>
                  <span>{item.name} ({item.quantity})</span>
                  <div className="row">
                    <button onClick={() => approvePending(item.id)}>Mark Paid + Issue QR</button>
                    <button onClick={() => rejectPreRegistration(item.id)}>Reject</button>
                  </div>
                </div>
              ))}
          </article>
        </section>
      )}

      {activeTab === 'payments' && (
        <section className="grid">
          <article className="card">
            <h2>Payment Collection</h2>
            <input placeholder="Name" value={paymentForm.name} onChange={(e) => setPaymentForm({ ...paymentForm, name: e.target.value })} />
            <input placeholder="Phone Number" value={paymentForm.phone} onChange={(e) => setPaymentForm({ ...paymentForm, phone: e.target.value })} />
            <input type="number" min={1} placeholder="Amount" value={paymentForm.amount || ''} onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })} />
            <input placeholder="Collector Name" value={paymentForm.collectorName} onChange={(e) => setPaymentForm({ ...paymentForm, collectorName: e.target.value })} />
            <select value={paymentForm.memberType} onChange={(e) => setPaymentForm({ ...paymentForm, memberType: e.target.value as MemberType })}>
              <option value="member">Member</option>
              <option value="non-member">Non-Member</option>
            </select>
            <input placeholder="Member ID (optional)" value={paymentForm.memberId} onChange={(e) => setPaymentForm({ ...paymentForm, memberId: e.target.value })} />
            <label className="row">
              <input type="checkbox" checked={paymentForm.newMember} onChange={(e) => setPaymentForm({ ...paymentForm, newMember: e.target.checked })} />
              New member
            </label>
            <select value={paymentForm.mode} onChange={(e) => setPaymentForm({ ...paymentForm, mode: e.target.value as PaymentMode })}>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
            </select>
            <input placeholder="Transaction ID (for online)" value={paymentForm.transactionId} onChange={(e) => setPaymentForm({ ...paymentForm, transactionId: e.target.value })} />
            <select value={paymentForm.purpose} onChange={(e) => setPaymentForm({ ...paymentForm, purpose: e.target.value as PaymentPurpose })}>
              <option value="donation">Donation</option>
              <option value="membership">Membership</option>
              <option value="other">Other</option>
            </select>
            <input placeholder="Trust / Account" value={paymentForm.trustAccount} onChange={(e) => setPaymentForm({ ...paymentForm, trustAccount: e.target.value })} />
            <button onClick={addPayment}>Generate Receipt + WhatsApp</button>
          </article>
        </section>
      )}

      {activeTab === 'reports' && (
        <section className="grid">
          <article className="card">
            <h2>Exports</h2>
            <button onClick={downloadBhogReport}>Download Bhog Report CSV</button>
            <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            <button
              onClick={downloadPaymentReport}
            >
              Download Payment CSV
            </button>
            <p>Pre-Registered Paid: {eventRegistrations.filter((r) => r.source === 'pre-registered' && r.paymentStatus === 'paid').length}</p>
            <p>Pre-Registered Unpaid: {eventRegistrations.filter((r) => r.source === 'pre-registered' && r.paymentStatus === 'not-paid').length}</p>
            <p>On-Spot Issued: {eventRegistrations.filter((r) => r.source === 'on-spot').length}</p>
            <p>Unified Bhog Consumed: {scannedCount}</p>
          </article>
        </section>
      )}

      {activeTab === 'audit' && (
        <section className="grid">
          <article className="card">
            <h2>Audit Logs</h2>
            {state.auditLogs.slice(0, 200).map((log) => (
              <div key={log.id}>
                <strong>{log.action}</strong> - {log.actor} ({log.role}) - {dayjs(log.createdAt).format('DD MMM YYYY HH:mm:ss')}
                <div>{log.details}</div>
              </div>
            ))}
          </article>
          <article className="card">
            <button onClick={() => downloadTextFile('audit-logs.csv', toCsv(state.auditLogs))}>
              Download Audit Logs CSV
            </button>
          </article>
        </section>
      )}
    </main>
  )
}

export default App
