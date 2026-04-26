import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

const {
  PORT = 4000,
  MONGODB_URI = 'mongodb://127.0.0.1:27017/bhogapp',
  JWT_SECRET = 'change-me-in-env',
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

const systemStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
)

const User = mongoose.model('User', userSchema)
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
  const state = await SystemState.findOne({ key: 'global' }).lean()
  return res.json({ state: state?.data ?? DEFAULT_STATE })
})

app.put('/api/state', requireAuth, async (req, res) => {
  const incoming = req.body?.state
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ message: 'state object is required' })
  }
  await SystemState.updateOne(
    { key: 'global' },
    { $set: { data: incoming } },
    { upsert: true },
  )
  return res.json({ ok: true })
})

async function start() {
  await mongoose.connect(MONGODB_URI)
  await seedUsers()
  await ensureStateDocument()
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`)
  })
}

start().catch((error) => {
  console.error('Failed to start server', error)
  process.exit(1)
})
