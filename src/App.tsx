import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import './App.css'
import {
  approveRegistrationRequest,
  bulkCreateRegistrationsRequest,
  createEventRequest,
  createPaymentRequest,
  createRegistrationRequest,
  fetchState,
  loginRequest,
  scanCouponRequest,
  rejectRegistrationRequest,
} from './lib/api'
import { downloadTextFile } from './lib/qr'
import { loadState, saveState, toCsv, type AppState } from './lib/storage'
import type {
  Coupon,
  MemberType,
  PaymentMode,
  PaymentPurpose,
  PaymentStatus,
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
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
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
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const cameraActiveRef = useRef(false)

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

  const refreshFromServer = async (token: string) => {
    const remoteState = await fetchState(token)
    setState(remoteState)
    saveState(remoteState)
    if (!selectedEventId && remoteState.events[0]?.id) {
      setSelectedEventId(remoteState.events[0].id)
    }
  }

  const createEvent = async () => {
    if (!authToken) return
    if (!newEvent.name.trim() || !newEvent.date) return
    await createEventRequest(authToken, { name: newEvent.name.trim(), date: newEvent.date })
    await refreshFromServer(authToken)
    setNewEvent({ name: '', date: dayjs().format('YYYY-MM-DD') })
  }

  const stopCameraScanner = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
    cameraActiveRef.current = false
    setCameraActive(false)
  }

  const startCameraScanner = async () => {
    try {
      setCameraError('')
      const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: { new (options?: { formats?: string[] }): { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } } }).BarcodeDetector
      if (!BarcodeDetectorClass) {
        setCameraError('BarcodeDetector is not supported in this browser.')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      cameraActiveRef.current = true
      setCameraActive(true)
      const detector = new BarcodeDetectorClass({ formats: ['qr_code'] })
      const tick = async () => {
        if (!videoRef.current || !cameraActiveRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          const value = codes[0]?.rawValue?.trim()
          if (value) {
            setScanToken(value)
            stopCameraScanner()
            return
          }
        } catch {
          // Ignore transient frame parsing failures.
        }
        rafRef.current = requestAnimationFrame(() => {
          void tick()
        })
      }
      void tick()
    } catch {
      setCameraError('Unable to access camera. Check browser permissions.')
      stopCameraScanner()
    }
  }

  useEffect(() => () => stopCameraScanner(), [])

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

  const issueOnSpot = async () => {
    if (!authToken || !issueForm.name || !issueForm.whatsapp || !selectedEvent?.id || issueForm.quantity < 1) {
      return alert('Fill required fields.')
    }
    await createRegistrationRequest(authToken, {
      eventId: selectedEvent.id,
      name: issueForm.name,
      whatsapp: issueForm.whatsapp,
      quantity: issueForm.quantity,
      memberType: issueForm.memberType,
      source: 'on-spot',
      paymentStatus: 'paid',
    })
    await refreshFromServer(authToken)
    alert('QRs issued and WhatsApp dispatched via Cloud API (if configured).')
  }

  const scanCoupon = async () => {
    if (!authToken || !selectedEvent?.id || !scanToken.trim()) return
    try {
      await scanCouponRequest(authToken, {
        qrToken: scanToken.trim(),
        eventId: selectedEvent.id,
        scannerDevice: navigator.userAgent,
      })
      await refreshFromServer(authToken)
      setScanToken('')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to scan')
    }
  }

  const addPreReg = async () => {
    if (!authToken || !preRegForm.name || !preRegForm.whatsapp || !selectedEvent?.id) return
    await createRegistrationRequest(authToken, {
      eventId: selectedEvent.id,
      name: preRegForm.name,
      whatsapp: preRegForm.whatsapp,
      quantity: preRegForm.quantity,
      memberType: preRegForm.memberType,
      source: 'pre-registered',
      paymentStatus: preRegForm.paymentStatus,
      paymentReference: preRegForm.paymentRef || undefined,
    })
    await refreshFromServer(authToken)
    alert('Pre-registration saved. WhatsApp status message is sent by backend if configured.')
  }

  const approvePending = async (registrationId: string) => {
    if (!authToken) return
    const registration = state.registrations.find((item) => item.id === registrationId)
    if (!registration || registration.status !== 'pending') return
    await approveRegistrationRequest(authToken, registrationId)
    await refreshFromServer(authToken)
    alert('Approved. QR message dispatched via backend WhatsApp API.')
  }

  const rejectPreRegistration = async (registrationId: string) => {
    if (!authToken) return
    await rejectRegistrationRequest(authToken, registrationId)
    await refreshFromServer(authToken)
  }

  const addPayment = async () => {
    if (!authToken || !paymentForm.name || !paymentForm.phone || paymentForm.amount <= 0 || !paymentForm.collectorName) return
    const response = await createPaymentRequest(authToken, {
      ...paymentForm,
      amount: paymentForm.amount,
      memberId: paymentForm.memberId || undefined,
      transactionId: paymentForm.transactionId || undefined,
    })
    await refreshFromServer(authToken)
    alert(`Payment saved (${response.receiptNumber}). Receipt message sent via backend WhatsApp API.`)
  }

  const parseUploadRows = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  }

  const bulkUploadBhog = async (file: File) => {
    const rows = await parseUploadRows(file)
    if (!authToken || !selectedEvent?.id) return
    const uploadRows: Array<Record<string, unknown>> = []
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
      uploadRows.push({
        eventId,
        name,
        whatsapp,
        quantity,
        memberType: 'non-member',
        source: 'on-spot',
        paymentStatus: 'paid',
      })
    }
    const result = await bulkCreateRegistrationsRequest(authToken, {
      rows: uploadRows,
      defaults: { eventId: selectedEvent.id, source: 'on-spot', paymentStatus: 'paid' },
    })
    await refreshFromServer(authToken)
    const combinedErrors = [...errors, ...result.errors]
    alert(
      combinedErrors.length
        ? `Uploaded ${result.successCount} rows with errors:\n${combinedErrors.slice(0, 8).join('\n')}`
        : `Bulk upload successful (${result.successCount} rows).`,
    )
  }

  const bulkUploadPreReg = async (file: File) => {
    const rows = await parseUploadRows(file)
    if (!authToken || !selectedEvent?.id) return
    const uploadRows: Array<Record<string, unknown>> = []
    for (const row of rows) {
      const rawStatus = String(row['Payment Status'] ?? row.paymentStatus ?? 'Not Paid').trim().toLowerCase()
      const paymentStatus: PaymentStatus = rawStatus === 'paid' ? 'paid' : 'not-paid'
      const name = String(row.Name ?? '').trim()
      const whatsapp = String(row['WhatsApp Number'] ?? '').trim()
      const quantity = Number(row.Quantity ?? 1)
      if (!name || !whatsapp || quantity < 1) continue
      uploadRows.push({
        eventId: selectedEvent.id,
        name,
        whatsapp,
        quantity,
        memberType: 'non-member',
        source: 'pre-registered',
        paymentStatus,
        paymentReference: String(row['Payment Reference'] ?? '').trim() || undefined,
      })
    }
    const result = await bulkCreateRegistrationsRequest(authToken, {
      rows: uploadRows,
      defaults: { eventId: selectedEvent.id, source: 'pre-registered' },
    })
    await refreshFromServer(authToken)
    alert(result.errors.length ? `Uploaded ${result.successCount} rows. Some failed.` : `Bulk upload successful (${result.successCount} rows).`)
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
            <div className="row">
              <button onClick={() => void scanCoupon()}>Validate & Consume</button>
              {!cameraActive ? (
                <button onClick={() => void startCameraScanner()}>Start Camera Scan</button>
              ) : (
                <button onClick={stopCameraScanner}>Stop Camera</button>
              )}
            </div>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 8, display: cameraActive ? 'block' : 'none' }} />
            {cameraError && <p>{cameraError}</p>}
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
