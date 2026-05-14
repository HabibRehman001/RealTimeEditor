import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { YSocketIO } from 'y-socket.io/dist/server'



const app = express()
const httpServer = createServer(app)
const PORT = Number(process.env.PORT) || 3000

app.use(express.static('public'))

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

const ySocketIO = new YSocketIO(io)
ySocketIO.initialize()




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
