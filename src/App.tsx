import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import QRCode from 'qrcode'
import {
  LayoutDashboard,
  QrCode,
  CreditCard,
  FileText,
  History,
  LogOut,
  Plus,
  XCircle,
  Camera,
  Download,
  Calendar,
  Check,
  Smartphone,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import './App.css'
import {
  bulkCreateRegistrationsRequest,
  createEventRequest,
  createPaymentRequest,
  createRegistrationRequest,
  fetchState,
  loginRequest,
  scanCouponRequest,
  fetchPublicTicketData,
} from './lib/api'
import { downloadTextFile } from './lib/qr'
import { loadState, saveState, toCsv, type AppState } from './lib/storage'
import type {
  Coupon,
  MemberType,
  PaymentMode,
  PaymentPurpose,
  UserRole,
  UserSession,
} from './types'

type Tab = 'events' | 'issue' | 'scan' | 'payments' | 'reports' | 'audit'

const roleTabs: Record<UserRole, Tab[]> = {
  admin: ['events', 'issue', 'scan', 'payments', 'reports', 'audit'],
  reception: ['issue', 'scan'],
  collector: ['payments'],
  scanner: ['scan'],
}

const tabIcons: Record<Tab, any> = {
  events: Calendar,
  issue: Plus,
  scan: QrCode,
  payments: CreditCard,
  reports: FileText,
  audit: History,
}

function TicketView({ registrationId }: { registrationId: string }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [qrUrl, setQrUrl] = useState('')

  useEffect(() => {
    fetchPublicTicketData(registrationId)
      .then(setData)
      .catch((err) => setError(err.message))
  }, [registrationId])

  useEffect(() => {
    if (data?.coupons?.[currentIndex]) {
      QRCode.toDataURL(data.coupons[currentIndex].token, {
        width: 400,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      }).then(setQrUrl)
    }
  }, [data, currentIndex])

  if (error) return <div className="container" style={{ textAlign: 'center', marginTop: 100 }}><h2>Ticket not found</h2><p>{error}</p></div>
  if (!data) return <div className="container" style={{ textAlign: 'center', marginTop: 100 }}><div className="loading">Loading Ticket...</div></div>

  const total = data.coupons.length

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 40 }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 className="ticket-header">Hi {data.registration.name}!</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Here are your digital entry passes for <strong>{data.event?.name}</strong>.</p>
      </div>

      <div className="ticket-card">
        <p style={{ fontWeight: 600, fontSize: 18 }}>Ticket {currentIndex + 1} of {total}</p>

        <div className="qr-container">
          {qrUrl && <img src={qrUrl} alt="QR Code" style={{ width: '100%', maxWidth: 280, display: 'block' }} />}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 20 }}>
          <button
            className="ticket-nav-btn"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex(i => i - 1)}
          >
            <ChevronLeft size={24} />
          </button>
          <button
            className="ticket-nav-btn"
            disabled={currentIndex === total - 1}
            onClick={() => setCurrentIndex(i => i + 1)}
          >
            <ChevronRight size={24} />
          </button>
        </div>

        <div style={{ marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
          <button style={{ width: '100%', background: 'var(--bg-primary)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
            <ExternalLink size={18} style={{ marginRight: 8 }} /> View on Website
          </button>
        </div>
      </div>

      <p style={{ textAlign: 'center', marginTop: 40, color: 'var(--text-secondary)', fontSize: 13 }}>
        Powered by Bhog System &bull; Trust Official Pass
      </p>
    </div>
  )
}

function App() {
  const path = window.location.pathname
  const ticketId = path.startsWith('/ticket/') ? path.split('/')[2] : null

  if (ticketId) {
    return <TicketView registrationId={ticketId} />
  }

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

  const [paymentForm, setPaymentForm] = useState({
    name: '',
    email: '',
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
      const BarcodeDetectorClass = (window as any).BarcodeDetector
      if (!BarcodeDetectorClass) {
        setCameraError('Scanner not supported in this browser.')
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
        } catch { }
        rafRef.current = requestAnimationFrame(() => {
          void tick()
        })
      }
      void tick()
    } catch {
      setCameraError('Camera access denied.')
      stopCameraScanner()
    }
  }

  useEffect(() => () => stopCameraScanner(), [])

  if (!session) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-logo">
            <Smartphone size={32} />
          </div>
          <h1 style={{ marginBottom: 8 }}>Bhog System</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Secure Login</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group" style={{ textAlign: 'left' }}>
              <label>Role</label>
              <select value={loginForm.role} onChange={(e) => setLoginForm({ ...loginForm, role: e.target.value as UserRole })}>
                <option value="admin">Admin</option>
                <option value="reception">Reception</option>
                <option value="collector">Collector</option>
                <option value="scanner">Scanner</option>
              </select>
            </div>
            <div className="form-group" style={{ textAlign: 'left' }}>
              <label>Username</label>
              <input placeholder="Enter username" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
            </div>
            <div className="form-group" style={{ textAlign: 'left' }}>
              <label>Password</label>
              <input type="password" placeholder="••••••••" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
            </div>
            <button onClick={() => void login()} disabled={isLoading} style={{ marginTop: 8 }}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>

          <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 12 }}>
            <ShieldCheck size={14} />
            <span>Encrypted Session</span>
          </div>
        </div>
      </div>
    )
  }

  const tabs = roleTabs[session.role]

  const issueOnSpot = async () => {
    if (!authToken || !issueForm.name || !issueForm.whatsapp || !selectedEvent?.id || issueForm.quantity < 1) {
      return alert('Fill required fields.')
    }
    await createRegistrationRequest(authToken, {
      ...issueForm,
      source: 'on-spot',
      paymentStatus: 'paid',
    })
    await refreshFromServer(authToken)
    alert('QR Issued successfully.')
    setIssueForm({
      name: '',
      whatsapp: '',
      quantity: 1,
      memberType: 'member',
      eventId: selectedEvent?.id ?? '',
    })
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

  const addPayment = async () => {
    if (!authToken || !paymentForm.name || paymentForm.amount <= 0 || !paymentForm.collectorName) return
    const response = await createPaymentRequest(authToken, {
      ...paymentForm,
      amount: paymentForm.amount,
      memberId: paymentForm.memberId || undefined,
      transactionId: paymentForm.transactionId || undefined,
    })
    await refreshFromServer(authToken)
    alert(`Payment saved (${response.receiptNumber}).`)
    setPaymentForm({
      name: '',
      email: '',
      amount: 0,
      memberType: 'member',
      memberId: '',
      newMember: false,
      mode: 'cash',
      transactionId: '',
      purpose: 'donation',
      trustAccount: 'Trust',
      collectorName: paymentForm.collectorName, // Keep collector name for convenience
    })
  }

  const onUpload = async (event: ChangeEvent<HTMLInputElement>, type: 'bhog' | 'pre-reg') => {
    const file = event.target.files?.[0]
    if (!file) return

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' })

    if (!authToken || !selectedEvent?.id) return

    const uploadRows = rows.map((row: any) => {
      const name = String(row.name || row.Name || '').trim()
      const whatsapp = String(row['mobile number'] || row['Mobile Number'] || row.whatsapp || '').trim()

      const memberNonVeg = Number(row['member head count-non veg'] || row['Member Head Count-Non Veg'] || 0)
      const memberVeg = Number(row['member head count-veg'] || row['Member Head Count-Veg'] || 0)
      const guestNonVeg = Number(row['guest head count-non veg'] || row['Guest Head Count-Non Veg'] || 0)
      const guestVeg = Number(row['guest head count-veg'] || row['Guest Head Count-Veg'] || 0)

      const totalQuantity = (memberNonVeg + memberVeg + guestNonVeg + guestVeg) || Number(row.Quantity || row.quantity || 1)
      const isMember = (memberNonVeg + memberVeg) >= (guestNonVeg + guestVeg)

      return {
        eventId: selectedEvent.id,
        name,
        whatsapp,
        quantity: totalQuantity,
        memberType: isMember ? 'member' : 'non-member',
        source: 'on-spot',
        paymentStatus: 'paid',
      }
    })
    const validRows = uploadRows.filter((r: any) => r.name && r.whatsapp)
    const skippedCount = uploadRows.length - validRows.length

    const result = await bulkCreateRegistrationsRequest(authToken, {
      rows: validRows,
      defaults: { eventId: selectedEvent.id, source: type === 'bhog' ? 'on-spot' : 'pre-registered' },
    })

    await refreshFromServer(authToken)
    alert(`Uploaded ${result.successCount} rows.${skippedCount > 0 ? ` Skipped ${skippedCount} invalid rows (missing name/phone).` : ''}`)
    event.target.value = ''
  }

  return (
    <>
      <header className="top-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: 'var(--accent)', color: 'white', padding: 6, borderRadius: 8 }}>
            <LayoutDashboard size={20} />
          </div>
          <div>
            <h4 style={{ fontSize: 16 }}>{session.username}</h4>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{session.role}</p>
          </div>
        </div>
        <button className="secondary" style={{ padding: '8px 12px' }} onClick={() => { setSession(null); setAuthToken(''); }}>
          <LogOut size={18} />
        </button>
      </header>

      <main className="container">
        {/* Global Event Selector */}
        <section className="card" style={{ marginBottom: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Calendar className="card-icon" size={20} style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)' }} />
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Active Event</p>
              <h4 style={{ fontSize: 15 }}>{selectedEvent?.name}</h4>
            </div>
          </div>
          <select
            style={{ width: 'auto', minWidth: 150 }}
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
          >
            {state.events.map((event) => (
              <option key={event.id} value={event.id}>{event.name}</option>
            ))}
          </select>
        </section>

        {activeTab === 'events' && (
          <section className="grid">
            <article className="card">
              <div className="card-header">
                <div className="card-icon"><Plus size={20} /></div>
                <h3>New Event</h3>
              </div>
              <div className="form-group">
                <label>Event Name</label>
                <input placeholder="e.g. Sunday Bhog" value={newEvent.name} onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} />
              </div>
              <button onClick={createEvent}><Check size={18} /> Create Event</button>
            </article>

            <article className="card">
              <div className="card-header">
                <div className="card-icon"><Calendar size={20} /></div>
                <h3>History</h3>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>Name</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {state.events.map(e => (
                      <tr key={e.id}><td>{e.name}</td><td>{e.date}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {activeTab === 'issue' && (
          <section className="grid">
            <article className="card">
              <div className="card-header">
                <div className="card-icon"><Plus size={20} /></div>
                <h3>Manual Issuance</h3>
              </div>
              <div className="form-group">
                <label>Name</label>
                <input placeholder="Visitor Name" value={issueForm.name} onChange={(e) => setIssueForm({ ...issueForm, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>WhatsApp Number</label>
                <input placeholder="91XXXXXXXXXX" value={issueForm.whatsapp} onChange={(e) => setIssueForm({ ...issueForm, whatsapp: e.target.value })} />
              </div>
              <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Quantity</label>
                  <input type="number" min={1} value={issueForm.quantity} onChange={(e) => setIssueForm({ ...issueForm, quantity: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select value={issueForm.memberType} onChange={(e) => setIssueForm({ ...issueForm, memberType: e.target.value as MemberType })}>
                    <option value="member">Member</option>
                    <option value="non-member">Guest</option>
                  </select>
                </div>
              </div>
              <button onClick={issueOnSpot}><Smartphone size={18} /> Issue QR & Send</button>
            </article>

            <article className="card">
              <div className="card-header">
                <div className="card-icon"><Download size={20} /></div>
                <h3>Bulk Import</h3>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Required columns: <strong>name, mobile number, member head count-non veg, member head count-veg, guest head count-non veg, guest head count-veg</strong>
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <button className="secondary" onClick={() => {
                  const headers = ['"Name"', '"Mobile Number"', '"Member Head Count-Non Veg"', '"Member Head Count-Veg"', '"Guest Head Count-Non Veg"', '"Guest Head Count-Veg"']
                  downloadTextFile('sample_bhog_import.csv', headers.join(','))
                }}>
                  <Download size={16} /> Download Sample CSV
                </button>
                <div className="form-group">
                  <input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void onUpload(event, 'bhog')} style={{ padding: 8 }} />
                </div>
              </div>
            </article>
          </section>
        )}

        {activeTab === 'scan' && (
          <section style={{ maxWidth: 450, margin: '0 auto' }}>
            <article className="card" style={{ textAlign: 'center' }}>
              <div className="card-header" style={{ justifyContent: 'center' }}>
                <div className="card-icon"><QrCode size={24} /></div>
                <h3>Scan QR</h3>
              </div>

              <div className="scanner-container">
                {cameraActive && (
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
                <div className="scanner-overlay">
                  <div className="scanner-box"></div>
                </div>
              </div>

              {cameraError && <p className="badge badge-error" style={{ marginTop: 12 }}>{cameraError}</p>}

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                {!cameraActive ? (
                  <button style={{ flex: 1 }} onClick={() => void startCameraScanner()}><Camera size={18} /> Open Camera</button>
                ) : (
                  <button className="secondary" style={{ flex: 1 }} onClick={stopCameraScanner}><XCircle size={18} /> Stop</button>
                )}
              </div>

              <div className="form-group" style={{ marginTop: 20 }}>
                <input placeholder="Or enter token manually" value={scanToken} onChange={(e) => setScanToken(e.target.value)} />
                <button onClick={() => void scanCoupon()} style={{ marginTop: 8 }}>Validate QR</button>
              </div>

              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 24 }}>
                <div className="card" style={{ padding: 12, alignItems: 'center' }}>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Scanned</p>
                  <h2 style={{ color: 'var(--success)' }}>{scannedCount}</h2>
                </div>
                <div className="card" style={{ padding: 12, alignItems: 'center' }}>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Remaining</p>
                  <h2>{eventCoupons.length - scannedCount}</h2>
                </div>
              </div>
            </article>
          </section>
        )}

        {activeTab === 'payments' && (
          <section className="grid">
            <article className="card">
              <div className="card-header">
                <div className="card-icon"><CreditCard size={20} /></div>
                <h3>New Payment</h3>
              </div>
              <div className="form-group">
                <label>Name</label>
                <input placeholder="Payer Name" value={paymentForm.name} onChange={(e) => setPaymentForm({ ...paymentForm, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Email (for receipt)</label>
                <input type="email" placeholder="donor@example.com" value={paymentForm.email} onChange={(e) => setPaymentForm({ ...paymentForm, email: e.target.value })} />
              </div>
              <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Amount (₹)</label>
                  <input type="number" placeholder="0.00" value={paymentForm.amount || ''} onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Trust Account</label>
                  <select value={paymentForm.trustAccount} onChange={(e) => setPaymentForm({ ...paymentForm, trustAccount: e.target.value })}>
                    <option value="Trust">Trust Official</option>
                    <option value="SMCA">SMCA Account</option>
                  </select>
                </div>
              </div>
              <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Type</label>
                  <select value={paymentForm.memberType} onChange={(e) => setPaymentForm({ ...paymentForm, memberType: e.target.value as MemberType })}>
                    <option value="member">Member</option>
                    <option value="non-member">Non-Member</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Member ID</label>
                  <input placeholder="ID" value={paymentForm.memberId} onChange={(e) => setPaymentForm({ ...paymentForm, memberId: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={paymentForm.newMember} onChange={(e) => setPaymentForm({ ...paymentForm, newMember: e.target.checked })} />
                  Mark as New Member
                </label>
              </div>
              <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Mode</label>
                  <select value={paymentForm.mode} onChange={(e) => setPaymentForm({ ...paymentForm, mode: e.target.value as PaymentMode })}>
                    <option value="cash">Cash</option>
                    <option value="online">Online</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Purpose</label>
                  <select value={paymentForm.purpose} onChange={(e) => setPaymentForm({ ...paymentForm, purpose: e.target.value as PaymentPurpose })}>
                    <option value="donation">Donation</option>
                    <option value="membership">Membership</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              {paymentForm.mode === 'online' && (
                <div className="form-group">
                  <label>Transaction ID</label>
                  <input placeholder="UPI / Ref No" value={paymentForm.transactionId} onChange={(e) => setPaymentForm({ ...paymentForm, transactionId: e.target.value })} />
                </div>
              )}
              <div className="form-group">
                <label>Collector</label>
                <input placeholder="Your Name" value={paymentForm.collectorName} onChange={(e) => setPaymentForm({ ...paymentForm, collectorName: e.target.value })} />
              </div>
              <button onClick={addPayment}><Smartphone size={18} /> Save & Send Receipt</button>
            </article>
          </section>
        )}

        {activeTab === 'reports' && (
          <section className="grid">
            <article className="card">
              <div className="card-header">
                <div className="card-icon"><FileText size={20} /></div>
                <h3>Exports</h3>
              </div>
              <button onClick={() => {
                const rows = eventRegistrations.map((r) => {
                  const issued = state.coupons.filter((c) => c.registrationId === r.id)
                  const scanned = issued.filter((c) => c.consumedAt)
                  return {
                    name: r.name,
                    phone: r.whatsapp,
                    quantity: r.quantity,
                    member_type: r.memberType,
                    source: r.source,
                    payment: r.paymentStatus,
                    issued_count: issued.length,
                    scanned_count: scanned.length,
                    scan_timestamps: scanned.map(s => s.consumedAt).join('; ')
                  }
                })
                downloadTextFile('bhog-report.csv', toCsv(rows))
              }}>
                <Download size={18} /> Bhog Report CSV
              </button>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div className="form-group">
                  <label>Filter by Date</label>
                  <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
                </div>
                <button className="secondary" style={{ marginTop: 8, width: '100%' }} onClick={() => {
                  const filtered = reportDate ? state.payments.filter(p => p.createdAt.slice(0, 10) === reportDate) : state.payments
                  const rows = filtered.map(p => ({
                    date: p.createdAt.slice(0, 10),
                    receipt_no: p.receiptNumber,
                    payer_name: p.name,
                    phone: p.phone,
                    amount: p.amount,
                    mode: p.mode.toUpperCase(),
                    purpose: p.purpose.toUpperCase(),
                    trust_account: p.trustAccount,
                    collector: p.collectorName,
                    member_type: p.memberType,
                    member_id: p.memberId || 'N/A',
                    is_new_member: p.newMember ? 'Yes' : 'No'
                  }))
                  downloadTextFile(`payment-report-${reportDate || 'all'}.csv`, toCsv(rows))
                }}>
                  <Download size={18} /> Payment CSV (All Fields)
                </button>
              </div>
            </article>

            <article className="card" style={{ background: 'var(--accent)', color: 'white' }}>
              <div className="card-header">
                <div className="card-icon" style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}><LayoutDashboard size={20} /></div>
                <h3>Summary</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 8 }}>
                  <span>Total Issued</span>
                  <strong>{eventCoupons.length}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 8 }}>
                  <span>Total Scanned</span>
                  <strong>{scannedCount}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 8 }}>
                  <span>Members</span>
                  <strong>{eventRegistrations.filter(r => r.memberType === 'member').reduce((acc, r) => acc + r.quantity, 0)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 8 }}>
                  <span>Guests</span>
                  <strong>{eventRegistrations.filter(r => r.memberType === 'non-member').reduce((acc, r) => acc + r.quantity, 0)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 8 }}>
                  <span>On-Spot</span>
                  <strong>{eventRegistrations.filter(r => r.source === 'on-spot').reduce((acc, r) => acc + r.quantity, 0)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 8 }}>
                  <span>Pre-Reg (Paid)</span>
                  <strong>{eventRegistrations.filter(r => r.source === 'pre-registered' && r.status === 'confirmed').reduce((acc, r) => acc + r.quantity, 0)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Pre-Reg (Unpaid)</span>
                  <strong>{eventRegistrations.filter(r => r.source === 'pre-registered' && r.status === 'pending').reduce((acc, r) => acc + r.quantity, 0)}</strong>
                </div>
              </div>
            </article>
          </section>
        )}

        {activeTab === 'audit' && (
          <section className="card">
            <div className="card-header">
              <div className="card-icon"><History size={20} /></div>
              <h3>Audit Logs</h3>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Action</th><th>Actor</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {state.auditLogs.slice(0, 50).map((log) => (
                    <tr key={log.id}>
                      <td>{log.action}</td>
                      <td>{log.actor}</td>
                      <td>{dayjs(log.createdAt).format('HH:mm')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="secondary" style={{ marginTop: 16 }} onClick={() => downloadTextFile('audit.csv', toCsv(state.auditLogs))}>
              <Download size={18} /> Download All Logs
            </button>
          </section>
        )}
      </main>

      <nav className="bottom-nav">
        {tabs.map((tab) => {
          const Icon = tabIcons[tab]
          return (
            <button key={tab} className={`nav-item ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
              <Icon size={22} />
              <span>{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}

export default App
