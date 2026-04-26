import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

const {
  PORT = 4000,
  MONGODB_URI = 'mongodb://127.0.0.1:27017/bhogapp',
  JWT_SECRET = 'change-me-in-env',
  WHATSAPP_ACCESS_TOKEN = '',
  WHATSAPP_PHONE_NUMBER_ID = '',
  WHATSAPP_API_VERSION = 'v20.0',
  WHATSAPP_DEFAULT_COUNTRY_CODE = '91',
} = process.env

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['admin', 'reception', 'collector', 'scanner'],
      required: true,
    },
  },
  { timestamps: true },
)

const eventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    date: { type: String, required: true },
  },
  { timestamps: true },
)

const registrationSchema = new mongoose.Schema(
  {
    registrationId: { type: String, required: true, unique: true, index: true },
    eventId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    whatsapp: { type: String, required: true },
    quantity: { type: Number, required: true },
    memberType: { type: String, enum: ['member', 'non-member'], required: true },
    source: { type: String, enum: ['pre-registered', 'on-spot'], required: true },
    paymentStatus: { type: String, enum: ['paid', 'not-paid'], required: true },
    paymentReference: { type: String },
    status: { type: String, enum: ['pending', 'confirmed', 'cancelled'], required: true },
    createdAtRaw: { type: String, required: true },
    updatedAtRaw: { type: String, required: true },
  },
  { timestamps: true },
)

const couponSchema = new mongoose.Schema(
  {
    couponId: { type: String, required: true, unique: true, index: true },
    eventId: { type: String, required: true, index: true },
    registrationId: { type: String, required: true, index: true },
    qrToken: { type: String, required: true, unique: true, index: true },
    consumedAt: { type: String },
    scannerUser: { type: String },
    scannerRole: { type: String },
    scannerDevice: { type: String },
    createdAtRaw: { type: String, required: true },
  },
  { timestamps: true },
)

const paymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, unique: true, index: true },
    receiptNumber: { type: String, required: true, index: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    memberType: { type: String, enum: ['member', 'non-member'], required: true },
    memberId: { type: String },
    newMember: { type: Boolean, required: true },
    mode: { type: String, enum: ['cash', 'online'], required: true },
    transactionId: { type: String },
    purpose: { type: String, enum: ['donation', 'membership', 'other'], required: true },
    trustAccount: { type: String, required: true },
    collectorName: { type: String, required: true },
    createdAtRaw: { type: String, required: true },
  },
  { timestamps: true },
)

const auditLogSchema = new mongoose.Schema(
  {
    logId: { type: String, required: true, unique: true, index: true },
    action: { type: String, required: true, index: true },
    actor: { type: String, required: true, index: true },
    role: { type: String, required: true },
    eventId: { type: String },
    details: { type: String, required: true },
    createdAtRaw: { type: String, required: true, index: true },
  },
  { timestamps: true },
)

const systemStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
)

const User = mongoose.model('User', userSchema)
const Event = mongoose.model('Event', eventSchema)
const Registration = mongoose.model('Registration', registrationSchema)
const Coupon = mongoose.model('Coupon', couponSchema)
const Payment = mongoose.model('Payment', paymentSchema)
const AuditLog = mongoose.model('AuditLog', auditLogSchema)
const SystemState = mongoose.model('SystemState', systemStateSchema)

const DEFAULT_STATE = {
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

const signToken = (user) =>
  jwt.sign(
    { userId: user._id.toString(), username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' },
  )

async function seedUsers() {
  const count = await User.countDocuments()
  if (count > 0) return
  const users = [
    { username: 'admin', password: 'admin123', role: 'admin' },
    { username: 'reception', password: 'reception123', role: 'reception' },
    { username: 'collector', password: 'collector123', role: 'collector' },
    { username: 'scanner', password: 'scanner123', role: 'scanner' },
  ]
  const docs = await Promise.all(
    users.map(async (u) => ({
      username: u.username,
      role: u.role,
      passwordHash: await bcrypt.hash(u.password, 10),
    })),
  )
  await User.insertMany(docs)
  console.log('Seeded default users.')
}

async function ensureStateDocument() {
  const existing = await SystemState.findOne({ key: 'global' }).lean()
  if (!existing) {
    await SystemState.create({ key: 'global', data: DEFAULT_STATE })
  }
}

async function migrateLegacyStateIfNeeded() {
  const hasData =
    (await Registration.countDocuments()) +
      (await Coupon.countDocuments()) +
      (await Payment.countDocuments()) >
    0
  if (hasData) return
  const legacy = await SystemState.findOne({ key: 'global' }).lean()
  if (legacy?.data) {
    await replaceCollectionsFromState(legacy.data)
  }
}

async function seedEvents() {
  const count = await Event.countDocuments()
  if (count > 0) return
  await Event.create({
    eventId: 'evt-1',
    name: 'Sunday Bhog',
    date: new Date().toISOString().slice(0, 10),
  })
}

async function writeAudit(req, action, details, eventId) {
  await AuditLog.create({
    logId: randomUUID(),
    action,
    actor: req.user.username,
    role: req.user.role,
    eventId,
    details,
    createdAtRaw: new Date().toISOString(),
  })
}

async function buildStateFromCollections() {
  const [events, registrations, coupons, payments, auditLogs] = await Promise.all([
    Event.find().sort({ date: -1, createdAt: -1 }).lean(),
    Registration.find().sort({ createdAt: -1 }).lean(),
    Coupon.find().sort({ createdAt: -1 }).lean(),
    Payment.find().sort({ createdAt: -1 }).lean(),
    AuditLog.find().sort({ createdAt: -1 }).limit(1000).lean(),
  ])
  return {
    events: events.map((e) => ({ id: e.eventId, name: e.name, date: e.date })),
    registrations: registrations.map((r) => ({
      id: r.registrationId,
      eventId: r.eventId,
      name: r.name,
      whatsapp: r.whatsapp,
      quantity: r.quantity,
      memberType: r.memberType,
      source: r.source,
      paymentStatus: r.paymentStatus,
      paymentReference: r.paymentReference,
      status: r.status,
      createdAt: r.createdAtRaw,
      updatedAt: r.updatedAtRaw,
    })),
    coupons: coupons.map((c) => ({
      id: c.couponId,
      eventId: c.eventId,
      registrationId: c.registrationId,
      qrToken: c.qrToken,
      consumedAt: c.consumedAt,
      scannerUser: c.scannerUser,
      scannerRole: c.scannerRole,
      scannerDevice: c.scannerDevice,
      createdAt: c.createdAtRaw,
    })),
    payments: payments.map((p) => ({
      id: p.paymentId,
      receiptNumber: p.receiptNumber,
      name: p.name,
      phone: p.phone,
      amount: p.amount,
      memberType: p.memberType,
      memberId: p.memberId,
      newMember: p.newMember,
      mode: p.mode,
      transactionId: p.transactionId,
      purpose: p.purpose,
      trustAccount: p.trustAccount,
      collectorName: p.collectorName,
      createdAt: p.createdAtRaw,
    })),
    auditLogs: auditLogs.map((a) => ({
      id: a.logId,
      action: a.action,
      actor: a.actor,
      role: a.role,
      eventId: a.eventId,
      details: a.details,
      createdAt: a.createdAtRaw,
    })),
  }
}

async function replaceCollectionsFromState(state) {
  await Promise.all([
    Event.deleteMany({}),
    Registration.deleteMany({}),
    Coupon.deleteMany({}),
    Payment.deleteMany({}),
  ])
  if (state.events?.length) {
    await Event.insertMany(
      state.events.map((e) => ({ eventId: e.id, name: e.name, date: e.date })),
    )
  }
  if (state.registrations?.length) {
    await Registration.insertMany(
      state.registrations.map((r) => ({
        registrationId: r.id,
        eventId: r.eventId,
        name: r.name,
        whatsapp: r.whatsapp,
        quantity: r.quantity,
        memberType: r.memberType,
        source: r.source,
        paymentStatus: r.paymentStatus,
        paymentReference: r.paymentReference,
        status: r.status,
        createdAtRaw: r.createdAt,
        updatedAtRaw: r.updatedAt,
      })),
    )
  }
  if (state.coupons?.length) {
    await Coupon.insertMany(
      state.coupons.map((c) => ({
        couponId: c.id,
        eventId: c.eventId,
        registrationId: c.registrationId,
        qrToken: c.qrToken,
        consumedAt: c.consumedAt,
        scannerUser: c.scannerUser,
        scannerRole: c.scannerRole,
        scannerDevice: c.scannerDevice,
        createdAtRaw: c.createdAt,
      })),
    )
  }
  if (state.payments?.length) {
    await Payment.insertMany(
      state.payments.map((p) => ({
        paymentId: p.id,
        receiptNumber: p.receiptNumber,
        name: p.name,
        phone: p.phone,
        amount: p.amount,
        memberType: p.memberType,
        memberId: p.memberId,
        newMember: p.newMember,
        mode: p.mode,
        transactionId: p.transactionId,
        purpose: p.purpose,
        trustAccount: p.trustAccount,
        collectorName: p.collectorName,
        createdAtRaw: p.createdAt,
      })),
    )
  }
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  const token = auth.replace('Bearer ', '')
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = payload
    return next()
  } catch {
    return res.status(401).json({ message: 'Invalid token' })
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' })
    }
    return next()
  }
}

function buildQrToken(eventId) {
  return `${eventId}-${randomUUID()}`
}

function normalizePhone(rawPhone) {
  const digits = String(rawPhone ?? '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return `${WHATSAPP_DEFAULT_COUNTRY_CODE}${digits}`
  return digits
}

async function sendWhatsAppText(toPhone, message) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) return { sent: false, skipped: true }
  const to = normalizePhone(toPhone)
  if (!to) return { sent: false, skipped: true }
  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
    },
  )
  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`WhatsApp API failed: ${errorBody}`)
  }
  return { sent: true }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' })
  }
  const user = await User.findOne({ username }).lean()
  if (!user) return res.status(401).json({ message: 'Invalid credentials' })
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' })
  const token = signToken(user)
  return res.json({
    token,
    user: { username: user.username, role: user.role },
  })
})

app.get('/api/state', requireAuth, async (_req, res) => {
  const state = await buildStateFromCollections()
  return res.json({ state })
})

app.put('/api/state', requireAuth, async (req, res) => {
  const incoming = req.body?.state
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ message: 'state object is required' })
  }
  await replaceCollectionsFromState(incoming)
  await writeAudit(req, 'state.replace', 'Legacy state sync performed')
  await SystemState.updateOne({ key: 'global' }, { $set: { data: incoming } }, { upsert: true })
  return res.json({ ok: true })
})

app.get('/api/events', requireAuth, async (_req, res) => {
  const events = await Event.find().sort({ date: -1, createdAt: -1 }).lean()
  return res.json({
    events: events.map((e) => ({ id: e.eventId, name: e.name, date: e.date })),
  })
})

app.post('/api/events', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only' })
  const { name, date } = req.body ?? {}
  if (!name || !date) return res.status(400).json({ message: 'name and date required' })
  const eventId = randomUUID()
  await Event.create({ eventId, name, date })
  await writeAudit(req, 'event.create', `Created event ${name} (${date})`, eventId)
  return res.status(201).json({ event: { id: eventId, name, date } })
})

app.post('/api/registrations', requireAuth, requireRoles('admin'), async (req, res) => {
  const {
    eventId,
    name,
    whatsapp,
    quantity,
    memberType = 'non-member',
    source = 'on-spot',
    paymentStatus = 'paid',
    paymentReference,
  } = req.body ?? {}
  if (!eventId || !name || !whatsapp || !quantity || quantity < 1) {
    return res.status(400).json({ message: 'eventId, name, whatsapp, quantity required' })
  }
  const now = new Date().toISOString()
  const registrationId = randomUUID()
  const status = paymentStatus === 'paid' ? 'confirmed' : 'pending'
  await Registration.create({
    registrationId,
    eventId,
    name,
    whatsapp,
    quantity,
    memberType,
    source,
    paymentStatus,
    paymentReference,
    status,
    createdAtRaw: now,
    updatedAtRaw: now,
  })
  const coupons = []
  if (paymentStatus === 'paid') {
    for (let i = 0; i < quantity; i += 1) {
      coupons.push({
        couponId: randomUUID(),
        eventId,
        registrationId,
        qrToken: buildQrToken(eventId),
        createdAtRaw: now,
      })
    }
    if (coupons.length) await Coupon.insertMany(coupons)
  }
  await writeAudit(
    req,
    'registration.create',
    `Created registration ${name} (${source}) qty ${quantity}, payment ${paymentStatus}`,
    eventId,
  )
  if (paymentStatus === 'paid') {
    const message = [
      `Jai Shree Krishna ${name},`,
      `Your Bhog QR(s) for event ${eventId}:`,
      ...coupons.map((c, i) => `${i + 1}. ${c.qrToken}`),
      'Each QR can be scanned once.',
    ].join('\n')
    sendWhatsAppText(whatsapp, message).catch(() => undefined)
  } else {
    sendWhatsAppText(whatsapp, 'Registration received, payment pending. Please complete payment for QR issue.').catch(() => undefined)
  }
  return res.status(201).json({
    registrationId,
    status,
    qrCount: coupons.length,
    qrTokens: coupons.map((c) => c.qrToken),
  })
})

app.post('/api/registrations/bulk', requireAuth, requireRoles('admin'), async (req, res) => {
  const { rows = [], defaults = {} } = req.body ?? {}
  if (!Array.isArray(rows)) return res.status(400).json({ message: 'rows must be an array' })
  const now = new Date().toISOString()
  let successCount = 0
  const errors = []
  for (const [index, row] of rows.entries()) {
    try {
      const eventId = row.eventId || defaults.eventId
      const quantity = Number(row.quantity ?? 0)
      if (!eventId || !row.name || !row.whatsapp || quantity < 1) {
        errors.push(`Row ${index + 1}: missing required fields`)
        continue
      }
      const registrationId = randomUUID()
      const paymentStatus = row.paymentStatus ?? defaults.paymentStatus ?? 'paid'
      const status = paymentStatus === 'paid' ? 'confirmed' : 'pending'
      await Registration.create({
        registrationId,
        eventId,
        name: row.name,
        whatsapp: row.whatsapp,
        quantity,
        memberType: row.memberType ?? defaults.memberType ?? 'non-member',
        source: row.source ?? defaults.source ?? 'on-spot',
        paymentStatus,
        paymentReference: row.paymentReference ?? '',
        status,
        createdAtRaw: now,
        updatedAtRaw: now,
      })
      const coupons = []
      if (paymentStatus === 'paid') {
        for (let i = 0; i < quantity; i += 1) {
          coupons.push({
            couponId: randomUUID(),
            eventId,
            registrationId,
            qrToken: buildQrToken(eventId),
            createdAtRaw: now,
          })
        }
        if (coupons.length) await Coupon.insertMany(coupons)
      }
      successCount += 1
    } catch {
      errors.push(`Row ${index + 1}: failed to create`)
    }
  }
  await writeAudit(req, 'registration.bulk-create', `Bulk created ${successCount} registrations`, defaults.eventId)
  return res.json({ ok: true, successCount, errors })
})

app.post('/api/registrations/:registrationId/approve', requireAuth, requireRoles('admin'), async (req, res) => {
  const { registrationId } = req.params
  const registration = await Registration.findOne({ registrationId })
  if (!registration) return res.status(404).json({ message: 'Registration not found' })
  if (registration.status !== 'pending') {
    return res.status(400).json({ message: 'Registration is not pending' })
  }
  const now = new Date().toISOString()
  registration.status = 'confirmed'
  registration.paymentStatus = 'paid'
  registration.updatedAtRaw = now
  await registration.save()
  const coupons = []
  for (let i = 0; i < registration.quantity; i += 1) {
    coupons.push({
      couponId: randomUUID(),
      eventId: registration.eventId,
      registrationId: registration.registrationId,
      qrToken: buildQrToken(registration.eventId),
      createdAtRaw: now,
    })
  }
  if (coupons.length) await Coupon.insertMany(coupons)
  await writeAudit(
    req,
    'registration.approve',
    `Approved ${registration.name} and issued ${coupons.length} QRs`,
    registration.eventId,
  )
  const message = [
    `Jai Shree Krishna ${registration.name},`,
    'Your payment is confirmed. QR(s):',
    ...coupons.map((c, i) => `${i + 1}. ${c.qrToken}`),
    'Each QR can be scanned once.',
  ].join('\n')
  sendWhatsAppText(registration.whatsapp, message).catch(() => undefined)
  return res.json({ ok: true, qrTokens: coupons.map((c) => c.qrToken) })
})

app.post('/api/registrations/:registrationId/reject', requireAuth, requireRoles('admin'), async (req, res) => {
  const { registrationId } = req.params
  const registration = await Registration.findOne({ registrationId })
  if (!registration) return res.status(404).json({ message: 'Registration not found' })
  registration.status = 'cancelled'
  registration.updatedAtRaw = new Date().toISOString()
  await registration.save()
  await writeAudit(req, 'registration.reject', `Rejected ${registration.name}`, registration.eventId)
  sendWhatsAppText(registration.whatsapp, 'Your registration has been cancelled. Contact admin for details.').catch(() => undefined)
  return res.json({ ok: true })
})

app.post('/api/coupons/scan', requireAuth, requireRoles('admin', 'reception', 'scanner'), async (req, res) => {
  const { qrToken, eventId, scannerDevice } = req.body ?? {}
  if (!qrToken || !eventId) return res.status(400).json({ message: 'qrToken and eventId required' })
  const coupon = await Coupon.findOne({ qrToken })
  if (!coupon) return res.status(404).json({ message: 'Invalid QR token' })
  if (coupon.eventId !== eventId) return res.status(400).json({ message: 'QR belongs to another event' })
  if (coupon.consumedAt) return res.status(409).json({ message: 'QR already scanned' })
  coupon.consumedAt = new Date().toISOString()
  coupon.scannerUser = req.user.username
  coupon.scannerRole = req.user.role
  coupon.scannerDevice = scannerDevice || ''
  await coupon.save()
  await writeAudit(req, 'coupon.scan', `Scanned token ${qrToken}`, eventId)
  return res.json({ ok: true, consumedAt: coupon.consumedAt })
})

app.post('/api/payments', requireAuth, requireRoles('admin', 'collector'), async (req, res) => {
  const {
    name,
    phone,
    amount,
    memberType,
    memberId,
    newMember,
    mode,
    transactionId,
    purpose,
    trustAccount,
    collectorName,
  } = req.body ?? {}
  if (!name || !phone || !amount || !mode || !purpose || !trustAccount || !collectorName) {
    return res.status(400).json({ message: 'Missing required fields' })
  }
  const now = new Date().toISOString()
  const today = now.slice(0, 10).replaceAll('-', '')
  const dailyCount = await Payment.countDocuments({ createdAtRaw: { $regex: `^${now.slice(0, 10)}` } })
  const receiptNumber = `RCPT-${today}-${String(dailyCount + 1).padStart(4, '0')}`
  const paymentId = randomUUID()
  await Payment.create({
    paymentId,
    receiptNumber,
    name,
    phone,
    amount,
    memberType,
    memberId,
    newMember: Boolean(newMember),
    mode,
    transactionId,
    purpose,
    trustAccount,
    collectorName,
    createdAtRaw: now,
  })
  await writeAudit(req, 'payment.create', `Created payment ${receiptNumber} (${amount})`)
  const receiptText = [
    `Receipt: ${receiptNumber}`,
    `Date: ${now}`,
    `Purpose: ${purpose}`,
    `Amount: ${amount}`,
    `Mode: ${mode}`,
    `Trust: ${trustAccount}`,
    `Transaction ID: ${transactionId || 'N/A'}`,
  ].join('\n')
  sendWhatsAppText(phone, `Thank you. Payment received.\n${receiptText}`).catch(() => undefined)
  return res.status(201).json({ paymentId, receiptNumber, createdAt: now })
})

app.get('/api/reports/bhog', requireAuth, async (req, res) => {
  const { eventId } = req.query
  const registrationQuery = eventId ? { eventId: String(eventId) } : {}
  const registrations = await Registration.find(registrationQuery).lean()
  const registrationIds = registrations.map((r) => r.registrationId)
  const coupons = await Coupon.find({ registrationId: { $in: registrationIds } }).lean()
  const couponByRegistration = new Map()
  for (const coupon of coupons) {
    const arr = couponByRegistration.get(coupon.registrationId) ?? []
    arr.push(coupon)
    couponByRegistration.set(coupon.registrationId, arr)
  }
  const rows = registrations.map((r) => {
    const issued = couponByRegistration.get(r.registrationId) ?? []
    const scanned = issued.filter((c) => c.consumedAt)
    return {
      name: r.name,
      phone: r.whatsapp,
      quantity: r.quantity,
      eventId: r.eventId,
      memberType: r.memberType,
      source: r.source,
      paymentStatus: r.paymentStatus,
      registrationStatus: r.status,
      qrIssuedCount: issued.length,
      qrScannedCount: scanned.length,
      scanTimestamps: scanned.map((s) => s.consumedAt).join(' | '),
    }
  })
  return res.json({ rows })
})

app.get('/api/reports/payments', requireAuth, async (req, res) => {
  const { date } = req.query
  const query = date ? { createdAtRaw: { $regex: `^${String(date)}` } } : {}
  const payments = await Payment.find(query).sort({ createdAt: -1 }).lean()
  const rows = payments.map((p) => ({
    receiptNumber: p.receiptNumber,
    createdAt: p.createdAtRaw,
    name: p.name,
    phone: p.phone,
    amount: p.amount,
    memberType: p.memberType,
    mode: p.mode,
    purpose: p.purpose,
    trustAccount: p.trustAccount,
    collectorName: p.collectorName,
    transactionId: p.transactionId ?? '',
    newMember: p.newMember,
  }))
  return res.json({ rows })
})

app.get('/api/audit-logs', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 1000)
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(limit).lean()
  return res.json({
    logs: logs.map((a) => ({
      id: a.logId,
      action: a.action,
      actor: a.actor,
      role: a.role,
      eventId: a.eventId,
      details: a.details,
      createdAt: a.createdAtRaw,
    })),
  })
})

app.post('/api/audit-logs', requireAuth, async (req, res) => {
  const { action, details, eventId } = req.body ?? {}
  if (!action || !details) {
    return res.status(400).json({ message: 'action and details required' })
  }
  await writeAudit(req, action, details, eventId)
  return res.status(201).json({ ok: true })
})

app.post('/api/whatsapp/send', requireAuth, requireRoles('admin', 'collector', 'reception'), async (req, res) => {
  const { to, message } = req.body ?? {}
  if (!to || !message) return res.status(400).json({ message: 'to and message required' })
  try {
    const result = await sendWhatsAppText(to, message)
    await writeAudit(req, 'whatsapp.send', `Sent WhatsApp message to ${to}`)
    return res.json({ ok: true, result })
  } catch (error) {
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to send WhatsApp' })
  }
})

async function start() {
  await mongoose.connect(MONGODB_URI)
  await seedUsers()
  await seedEvents()
  await ensureStateDocument()
  await migrateLegacyStateIfNeeded()
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`)
  })
}

start().catch((error) => {
  console.error('Failed to start server', error)
  process.exit(1)
})
