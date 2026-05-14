import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import {YSocketIO} from 'y-socket.io/dist/server'



const app = express()
const httpServer = createServer(app)

app.use(express.static('public'))

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

const ySocketIO = new YSocketIO(io)
ySocketIO.initialize();




app.get('/health', (req, res) => {
  res.json({
    message: 'Hello World!',
    success: true
  })
})




httpServer.listen(3000, () => {
  console.log('Server is running on port 3000')
})  