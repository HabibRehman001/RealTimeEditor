import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { YSocketIO } from 'y-socket.io/dist/server'

const app = express()
const httpServer = createServer(app)
const PORT = Number(process.env.PORT) || 3000

/** Active rooms created by a host (code without "room-" prefix) */
const activeRooms = new Map()

const normalizeCode = (code) => String(code || '').trim().toUpperCase()
const isValidCode = (code) => /^[A-Z0-9]{4,8}$/.test(code)

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json())
app.use(express.static('public'))

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

const ySocketIO = new YSocketIO(io)
ySocketIO.initialize()

// lib0 Observable spreads args: emit(name, [doc]) → listener(doc), not listener([doc])
ySocketIO.on('all-document-connections-closed', (doc) => {
  if (doc?.name?.startsWith('room-')) {
    activeRooms.delete(doc.name.slice(5))
  }
})

app.post('/api/rooms/:code', (req, res) => {
  const code = normalizeCode(req.params.code)
  if (!isValidCode(code)) {
    return res.status(400).json({ ok: false, error: 'Invalid room code format' })
  }
  activeRooms.set(code, { createdAt: Date.now() })
  res.json({ ok: true, code, exists: true })
})

app.get('/api/rooms/:code', (req, res) => {
  const code = normalizeCode(req.params.code)
  if (!isValidCode(code)) {
    return res.json({ exists: false })
  }
  res.json({ exists: activeRooms.has(code) })
})

app.get('/health', (req, res) => {
  res.json({
    message: 'Hello World!',
    success: true
  })
})




httpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. In PowerShell, start with a different port: $env:PORT=3001; npm.cmd run dev`)
    process.exit(1)
  }

  throw error
})

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
