const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const compression = require('compression')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')

// Load environment variables
dotenv.config()

// Normalize CLIENT_URL to remove any trailing slash
if (process.env.CLIENT_URL && process.env.CLIENT_URL.endsWith('/')) {
  process.env.CLIENT_URL = process.env.CLIENT_URL.slice(0, -1)
}

// Initialize PostgreSQL pool (imported for side-effect: opens pool on startup)
require('./db')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? process.env.CLIENT_URL : 'http://localhost:3000',
    credentials: true,
  },
})

// Trust proxy for correct rate limiting and IP detection
app.set('trust proxy', 1)

// Security middleware
app.use(helmet())
app.use(compression())

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
})
// app.use('/api/', limiter)

// CORS configuration
app.use(
  cors({
    origin: process.env.NODE_ENV === 'production' ? process.env.CLIENT_URL : 'http://localhost:3000',
    credentials: true,
  }),
)

// Body parsing middleware
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
if (process.env.VERCEL || process.env.NOW_BUILDER) {
  app.use('/uploads', express.static('/tmp'))
}

// Middleware to recursively map PostgreSQL "id" to MongoDB style "_id" in JSON responses
// for frontend compatibility
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (body) {
    const mapIdToUnderscoreId = (obj) => {
      if (!obj || typeof obj !== 'object' || obj instanceof Date || Buffer.isBuffer(obj)) {
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(mapIdToUnderscoreId);
      }
      const newObj = {};
      for (const [key, val] of Object.entries(obj)) {
        newObj[key] = mapIdToUnderscoreId(val);
      }
      if ('id' in newObj && newObj.id !== undefined && newObj.id !== null) {
        newObj._id = newObj.id;
      }
      return newObj;
    };
    const transformedBody = mapIdToUnderscoreId(body);
    return originalJson.call(this, transformedBody);
  };
  next();
});

// Routes
app.use('/api/auth', require('./routes/auth'))
app.use('/api/travel', require('./routes/travel'))
app.use('/api/expense', require('./routes/expense'))
app.use('/api/notifications', require('./routes/notifications'))
app.use('/api/dashboard', require('./routes/dashboard'))
app.use('/api/users', require('./routes/users'))

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() })
})

// Track connected users by userId
const connectedUsers = {}
io.on('connection', (socket) => {
  socket.on('register', (userId) => {
    if (userId) {
      connectedUsers[String(userId)] = socket.id
    }
  })
  socket.on('disconnect', () => {
    for (const [userId, sockId] of Object.entries(connectedUsers)) {
      if (sockId === socket.id) {
        delete connectedUsers[userId]
        break
      }
    }
  })
})
app.set('io', io)
app.set('connectedUsers', connectedUsers)

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack)

  // If it's a multer error or our custom file format/size validation error, return 400 Bad Request
  if (err.message && (err.message.includes('allowed') || err.message.includes('file') || err.name === 'MulterError' || err.message.includes('limit') || err.message.includes('large'))) {
    return res.status(400).json({ message: err.message })
  }

  res.status(500).json({
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong!' : err.message,
  })
})

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

const PORT = process.env.PORT || 4000
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
})
