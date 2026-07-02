const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// Tell Express to trust the Render load balancer so req.ip is the real client IP
app.set('trust proxy', true);

// In-memory cache for ultra-fast global IP blocking
const globalBlockedIps = new Set();

// Global Security Filter: Runs before ANY other route or static file
app.use((req, res, next) => {
  const rawIps = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress || '127.0.0.1';
  const ip = rawIps.split(',')[0].trim();
  
  // Check for banned cookie
  let bannedCookieIp = null;
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/banned_device=([^;]+)/);
    if (match) bannedCookieIp = match[1];
  }
  
  // Block if current IP is banned OR if the cookie's original IP is still banned
  if (globalBlockedIps.has(ip) || (bannedCookieIp && globalBlockedIps.has(bannedCookieIp))) {
    return res.status(403).send('Access Denied');
  }
  
  // If they have a cookie but the original IP is no longer banned (Admin unblocked it)
  if (bannedCookieIp && !globalBlockedIps.has(bannedCookieIp)) {
    res.clearCookie('banned_device'); // Automatically remove the ban cookie
  }
  
  // Attach the true IP to the request for easy access in routes
  req.trueIp = ip;
  next();
});

const DATA_FILE = path.join(__dirname, 'data.json');
const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const VISITORS_FILE = path.join(__dirname, 'visitors.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const BLOCKED_FILE = path.join(__dirname, 'blocked_ips.json');

// Ensure database files exist (fallback layer)
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(VISITORS_FILE)) fs.writeFileSync(VISITORS_FILE, '[]');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(CREDENTIALS_FILE)) fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ email: "admin@portfolio.com", password: "admin" }, null, 2));
if (!fs.existsSync(BLOCKED_FILE)) fs.writeFileSync(BLOCKED_FILE, '[]');

// Database Provider Configuration
const MONGODB_URI = process.env.MONGODB_URI;
let mongoClient = null;
let mongoDb = null;

// Expose public configs to frontend
app.get('/api/config', (req, res) => {
  res.json({
    web3FormsKey: process.env.WEB3FORMS_KEY || ''
  });
});

async function initDb() {
  if (MONGODB_URI) {
    try {
      console.log('Connecting to MongoDB Atlas...');
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      mongoDb = mongoClient.db();
      console.log('Connected to MongoDB successfully.');
      
      // Perform automated data migration if MongoDB collections are empty
      await migrateLocalToMongo();

      const blockedDocs = await mongoDb.collection('blocked_ips').find({}).toArray();
      blockedDocs.forEach(doc => globalBlockedIps.add(doc.ip));
      console.log('MongoDB initialized. Active blocks:', globalBlockedIps.size);
    } catch (err) {
      console.error('Failed to connect to MongoDB Atlas, falling back to local storage:', err);
      mongoDb = null;
      
      const blockedLocal = await db.getBlockedIps();
      blockedLocal.forEach(doc => globalBlockedIps.add(doc.ip));
      console.log('Local DB initialized. Active blocks:', globalBlockedIps.size);
    }
  } else {
    console.log('No MONGODB_URI provided. Running on local JSON file storage.');
    const blockedLocal = await db.getBlockedIps();
    blockedLocal.forEach(doc => globalBlockedIps.add(doc.ip));
    console.log('Local DB initialized. Active blocks:', globalBlockedIps.size);
  }
}

async function migrateLocalToMongo() {
  if (!mongoDb) return;
  
  // 1. Migrate Portfolio Data
  const portfolioCol = mongoDb.collection('portfolio_data');
  const countPortfolio = await portfolioCol.countDocuments();
  if (countPortfolio === 0 && fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
      if (Object.keys(data).length > 0) {
        await portfolioCol.insertOne({ key: 'main', data });
        console.log('Migrated portfolio data to MongoDB.');
      }
    } catch (e) { console.error('Migration of data.json failed:', e); }
  }

  // 2. Migrate Credentials
  const credsCol = mongoDb.collection('credentials');
  const countCreds = await credsCol.countDocuments();
  if (countCreds === 0 && fs.existsSync(CREDENTIALS_FILE)) {
    try {
      const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8') || '{}');
      if (creds.email && creds.password) {
        await credsCol.insertOne({ email: creds.email, password: creds.password });
        console.log('Migrated admin credentials to MongoDB.');
      }
    } catch (e) { console.error('Migration of credentials failed:', e); }
  }

  // 3. Migrate Messages
  const msgCol = mongoDb.collection('messages');
  const countMsg = await msgCol.countDocuments();
  if (countMsg === 0 && fs.existsSync(MESSAGES_FILE)) {
    try {
      const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8') || '[]');
      if (messages.length > 0) {
        await msgCol.insertMany(messages);
        console.log(`Migrated ${messages.length} messages to MongoDB.`);
      }
    } catch (e) { console.error('Migration of messages failed:', e); }
  }

  // 4. Migrate Visitors
  const visCol = mongoDb.collection('visitors');
  const countVis = await visCol.countDocuments();
  if (countVis === 0 && fs.existsSync(VISITORS_FILE)) {
    try {
      const visitors = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8') || '[]');
      if (visitors.length > 0) {
        const chunks = [];
        const chunkSize = 1000;
        for (let i = 0; i < visitors.length; i += chunkSize) {
          chunks.push(visitors.slice(i, i + chunkSize));
        }
        for (const chunk of chunks) {
          await visCol.insertMany(chunk);
        }
        console.log(`Migrated ${visitors.length} visitor logs to MongoDB.`);
      }
    } catch (e) { console.error('Migration of visitor logs failed:', e); }
  }
}

const db = {
  getPortfolioData: async () => {
    if (mongoDb) {
      const doc = await mongoDb.collection('portfolio_data').findOne({ key: 'main' });
      return doc ? doc.data : {};
    }
    try {
      if (!fs.existsSync(DATA_FILE)) return {};
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
    } catch { return {}; }
  },

  savePortfolioData: async (data) => {
    if (mongoDb) {
      await mongoDb.collection('portfolio_data').replaceOne({ key: 'main' }, { key: 'main', data }, { upsert: true });
      return;
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  },

  getCredentials: async () => {
    if (mongoDb) {
      const doc = await mongoDb.collection('credentials').findOne({});
      return doc || { email: 'admin@portfolio.com', password: 'admin' };
    }
    try {
      if (!fs.existsSync(CREDENTIALS_FILE)) return { email: 'admin@portfolio.com', password: 'admin' };
      return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    } catch { return { email: 'admin@portfolio.com', password: 'admin' }; }
  },

  saveCredentials: async (creds) => {
    if (mongoDb) {
      await mongoDb.collection('credentials').deleteMany({});
      await mongoDb.collection('credentials').insertOne({ email: creds.email, password: creds.password });
      return;
    }
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
  },

  getMessages: async () => {
    if (mongoDb) {
      return await mongoDb.collection('messages').find({}).sort({ date: -1 }).toArray();
    }
    try {
      if (!fs.existsSync(MESSAGES_FILE)) return [];
      return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8') || '[]');
    } catch { return []; }
  },

  saveMessages: async (messages) => {
    if (mongoDb) {
      await mongoDb.collection('messages').deleteMany({});
      if (messages.length > 0) {
        await mongoDb.collection('messages').insertMany(messages);
      }
      return;
    }
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  },

  addMessage: async (msg) => {
    if (mongoDb) {
      await mongoDb.collection('messages').insertOne(msg);
      return;
    }
    const messages = await db.getMessages();
    messages.unshift(msg);
    await db.saveMessages(messages);
  },

  getVisitors: async () => {
    if (mongoDb) {
      return await mongoDb.collection('visitors').find({}).sort({ time: -1 }).toArray();
    }
    try {
      if (!fs.existsSync(VISITORS_FILE)) return [];
      return JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8') || '[]');
    } catch { return []; }
  },

  saveVisitors: async (visitors) => {
    if (mongoDb) {
      await mongoDb.collection('visitors').deleteMany({});
      if (visitors.length > 0) {
        const chunkSize = 1000;
        for (let i = 0; i < visitors.length; i += chunkSize) {
          await mongoDb.collection('visitors').insertMany(visitors.slice(i, i + chunkSize));
        }
      }
      return;
    }
    fs.writeFileSync(VISITORS_FILE, JSON.stringify(visitors, null, 2));
  },

  addVisitor: async (log) => {
    if (mongoDb) {
      await mongoDb.collection('visitors').insertOne(log);
      return;
    }
    const logs = await db.getVisitors();
    logs.unshift(log);
    await db.saveVisitors(logs);
  },

  saveUpload: async (pathKey, fileDataBuffer, mimeType) => {
    if (mongoDb) {
      await mongoDb.collection('uploads').replaceOne(
        { pathKey },
        { pathKey, fileData: fileDataBuffer.toString('base64'), mimeType },
        { upsert: true }
      );
      return;
    }
    const targetPath = path.join(__dirname, pathKey);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetPath, fileDataBuffer);
  },

  getUpload: async (pathKey) => {
    if (mongoDb) {
      const doc = await mongoDb.collection('uploads').findOne({ pathKey });
      if (doc) {
        return {
          buffer: Buffer.from(doc.fileData, 'base64'),
          mimeType: doc.mimeType
        };
      }
    }
    const targetPath = path.join(__dirname, pathKey);
    if (fs.existsSync(targetPath)) {
      const ext = path.extname(targetPath).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.pdf') mimeType = 'application/pdf';
      return {
        buffer: fs.readFileSync(targetPath),
        mimeType
      };
    }
    return null;
  },

  getBlockedIps: async () => {
    if (mongoDb) {
      return await mongoDb.collection('blocked_ips').find({}).toArray();
    }
    try {
      if (!fs.existsSync(BLOCKED_FILE)) return [];
      return JSON.parse(fs.readFileSync(BLOCKED_FILE, 'utf8') || '[]');
    } catch { return []; }
  },

  saveBlockedIps: async (ips) => {
    if (mongoDb) {
      await mongoDb.collection('blocked_ips').deleteMany({});
      if (ips.length > 0) {
        await mongoDb.collection('blocked_ips').insertMany(ips);
      }
      return;
    }
    fs.writeFileSync(BLOCKED_FILE, JSON.stringify(ips, null, 2));
  },

  addBlockedIp: async (ipData) => {
    if (mongoDb) {
      await mongoDb.collection('blocked_ips').insertOne(ipData);
      return;
    }
    const ips = await db.getBlockedIps();
    ips.push(ipData);
    await db.saveBlockedIps(ips);
  },

  removeBlockedIp: async (ip) => {
    if (mongoDb) {
      await mongoDb.collection('blocked_ips').deleteOne({ ip });
      return;
    }
    let ips = await db.getBlockedIps();
    ips = ips.filter(b => b.ip !== ip);
    await db.saveBlockedIps(ips);
  }
};

// Session memory store
const activeSessions = new Set();
const preAuthSessions = new Map(); // Step 1 Biometric Pre-Auth (token -> { ip })
const failedAttempts = new Map(); // Track failed login attempts by IP

// Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Authorization token is required' });

  const token = authHeader.split(' ')[1];
  if (!token || !activeSessions.has(token)) {
    return res.status(403).json({ error: 'Invalid or expired session token' });
  }
  next();
};

// Middlewares
app.use(cors());
app.use(express.json({ limit: '15mb' })); // support large base64 strings

// Intercept uploads path to pull from MongoDB database first
app.get('/uploads/:type/:name', async (req, res) => {
  const { type, name } = req.params;
  const pathKey = `uploads/${type}/${name}`;
  try {
    const file = await db.getUpload(pathKey);
    if (file) {
      res.setHeader('Content-Type', file.mimeType);
      return res.send(file.buffer);
    }
  } catch (err) {
    console.error('Error fetching file from db:', err);
  }
  const localPath = path.join(UPLOADS_DIR, type, name);
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }
  res.status(404).send('File not found');
});

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

// Visitor Analytics Middleware
const logVisitor = (req, res, next) => {
  const isHomepageHit = req.path === '/' || req.path === '/index.html' || req.path === '/index' || req.path === '/directory.html';
  if (isHomepageHit) {
    (async () => {
      try {
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        if (ip.includes('::ffff:')) ip = ip.replace('::ffff:', '');
        const userAgent = req.headers['user-agent'] || 'Unknown Browser';
        
        const countries = ['India', 'United States', 'United Kingdom', 'Germany', 'Canada', 'Singapore', 'Australia', 'Japan'];
        const mockCountry = countries[Math.floor(Math.random() * countries.length)];
        
        const logs = await db.getVisitors();
        const todayStr = new Date().toISOString().substring(0, 10);
        const hasVisitedToday = logs.some(l => l.type === 'visitor' && l.ip === ip && l.time.startsWith(todayStr));

        // Always log a view
        logs.unshift({
          type: 'view',
          ip,
          userAgent,
          time: new Date().toISOString(),
          country: mockCountry
        });

        // Log unique visitor daily
        if (!hasVisitedToday) {
          logs.unshift({
            type: 'visitor',
            ip,
            userAgent,
            time: new Date().toISOString(),
            country: mockCountry
          });
        }

        if (logs.length > 5000) logs.pop();
        await db.saveVisitors(logs);
      } catch (err) {
        console.error('Visitor logging failed:', err);
      }
    })();
  }
  next();
};
app.use(logVisitor);

// API: Get portfolio dataset
app.get('/api/data', async (req, res) => {
  try {
    const data = await db.getPortfolioData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read database records' });
  }
});

// API: Save portfolio dataset (Requires Auth)
app.post('/api/save-data', authenticate, async (req, res) => {
  const dataset = req.body;
  if (!dataset || typeof dataset !== 'object') {
    return res.status(400).json({ error: 'Invalid body dataset format' });
  }
  try {
    await db.savePortfolioData(dataset);
    res.json({ success: true, message: 'Database saved and compiled successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save database edits' });
  }
});

// API: Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const ip = req.trueIp; // Use the parsed IP from the middleware

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required fields' });
  }

  try {
    let creds = await db.getCredentials();

    if (creds.email === email && creds.password === password) {
      // Step 1 Passed!
      const authenticators = creds.authenticators || [];
      const token = 'token_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      
      if (authenticators.length > 0) {
        // Biometrics are enabled. Require Step 2.
        preAuthSessions.set(token, { ip });
        return res.json({ success: true, requireBiometric: true, token });
      }

      // Biometrics not enabled yet. Full Login.
      activeSessions.add(token);
      failedAttempts.delete(ip);
      
      // Note: Frontend admin.js will handle the success notification
      return res.json({ success: true, token });
    }
    
    // Handle failed login attempt
    let attempts = (failedAttempts.get(ip) || 0) + 1;
    failedAttempts.set(ip, attempts);
    
    if (attempts >= 3) {
      await db.addBlockedIp({ ip, timestamp: new Date().toISOString(), userAgent: req.headers['user-agent'] || 'Unknown' });
      failedAttempts.delete(ip);
      globalBlockedIps.add(ip); // Add to global ban list instantly
      
      // Set a permanent cookie to ban the device, storing the original banned IP
      res.cookie('banned_device', ip, { maxAge: 9999999999, httpOnly: false });
      
      return res.status(403).json({ 
        error: 'Too many failed attempts. Your device has been permanently blocked.',
        deviceBlocked: true,
        blockedIp: ip,
        web3FormsKey: process.env.WEB3FORMS_KEY || ''
      });
    }

    res.status(401).json({ error: 'Invalid email or password' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process authentication query' });
  }
});

// API: Check token verification
app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.json({ valid: false });
  const token = authHeader.split(' ')[1];
  if (activeSessions.has(token)) {
    return res.json({ valid: true });
  }
  res.json({ valid: false });
});

// API: Logout
app.post('/api/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    activeSessions.delete(token);
  }
  res.json({ success: true });
});

// API: Update Security Settings
app.post('/api/settings/security', authenticate, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    await db.saveCredentials({ email, password });
    // Invalidate all active sessions to force re-login
    activeSessions.clear();
    res.json({ success: true, message: 'Credentials updated successfully' });
  } catch {
    res.status(500).json({ error: 'Failed to update credentials database' });
  }
});

// API: Get blocked devices
app.get('/api/settings/blocked', authenticate, async (req, res) => {
  try {
    const ips = await db.getBlockedIps();
    res.json(ips);
  } catch {
    res.status(500).json({ error: 'Failed to get blocked devices' });
  }
});

// API: Unblock device
app.post('/api/settings/unblock', authenticate, async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP address is required' });
  
  try {
    await db.removeBlockedIp(ip);
    globalBlockedIps.delete(ip); // Remove from global ban list
    res.json({ success: true, message: 'Device unblocked' });
  } catch {
    res.status(500).json({ error: 'Failed to unblock device' });
  }
});

// API: Get messages (Requires Auth)
app.get('/api/messages', authenticate, async (req, res) => {
  try {
    const messages = await db.getMessages();
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

// API: Submit message inquiry (Public)
app.post('/api/messages', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    const newMsg = {
      id: 'msg_' + Date.now(),
      name,
      email,
      subject,
      message,
      date: new Date().toISOString(),
      status: 'inbox'
    };
    await db.addMessage(newMsg);
    // Note: Email notification is now handled purely by the frontend browser
    // to comply with Web3Forms free tier policies.
    res.json({ success: true, message: 'Inquiry submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record message inquiry' });
  }
});

// API: Archive or Delete Message (Requires Auth)
app.post('/api/messages/action', authenticate, async (req, res) => {
  const { id, action } = req.body;
  if (!id || !action) return res.status(400).json({ error: 'Invalid message action details' });
  try {
    let messages = await db.getMessages();
    if (action === 'delete') {
      messages = messages.filter(m => m.id !== id);
    } else if (action === 'archive') {
      messages = messages.map(m => m.id === id ? { ...m, status: 'archived' } : m);
    }
    await db.saveMessages(messages);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to update message status' });
  }
});

// API: Log page hits (Public)
app.post('/api/analytics/hit', async (req, res) => {
  const { type } = req.body;
  try {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    if (ip.includes('::ffff:')) {
      ip = ip.replace('::ffff:', '');
    }
    const userAgent = req.headers['user-agent'] || 'Browser';
    const countries = ['India', 'United States', 'Canada', 'United Kingdom', 'Germany', 'Australia', 'Singapore'];
    const country = countries[Math.floor(Math.random() * countries.length)];

    await db.addVisitor({
      type: type === 'visitor' ? 'visitor' : 'view',
      ip,
      userAgent,
      time: new Date().toISOString(),
      country
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record visitor hit' });
  }
});

// API: Get analytics (Requires Auth)
app.get('/api/analytics', authenticate, async (req, res) => {
  try {
    const logs = await db.getVisitors();
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Failed to load visitor analytics' });
  }
});

// API: Modify visitor analytics logs (Requires Auth)
app.post('/api/analytics/action', authenticate, async (req, res) => {
  const { action, time, logEntry } = req.body;
  if (!action) return res.status(400).json({ error: 'Action parameter is required' });
  try {
    let logs = await db.getVisitors();
    if (action === 'delete') {
      logs = logs.filter(l => l.time !== time);
    } else if (action === 'clear') {
      logs = [];
    } else if (action === 'add') {
      if (!logEntry || !logEntry.type || !logEntry.time) {
        return res.status(400).json({ error: 'Invalid logEntry details' });
      }
      logs.unshift({
        type: logEntry.type,
        ip: logEntry.ip || '127.0.0.1',
        userAgent: logEntry.userAgent || 'Manual Log Entry',
        time: new Date(logEntry.time).toISOString(),
        country: logEntry.country || 'India'
      });
      logs.sort((a, b) => new Date(b.time) - new Date(a.time));
    }
    await db.saveVisitors(logs);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to execute analytics action' });
  }
});

// API: Get computed dashboard analytics summary (Requires Auth)
app.get('/api/analytics/summary', authenticate, async (req, res) => {
  try {
    const logs = await db.getVisitors();
    const data = await db.getPortfolioData();
    const messages = await db.getMessages();
    const projects = data.projects || [];
    const now = new Date();

    // Respect ?days= param from date picker (0 = all time)
    const days = parseInt(req.query.days) || 30;
    const rangeStart = days > 0 ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000) : new Date(0);
    const prevStart = days > 0 ? new Date(now.getTime() - days * 2 * 24 * 60 * 60 * 1000) : new Date(0);

    const siteSettings = data.siteSettings || {};
    const analyticsBase = siteSettings.analyticsBase || { visitors: 0, views: 0 };
    
    const baseVisitors = parseInt(analyticsBase.visitors) || 0;
    const baseViews = parseInt(analyticsBase.views) || 0;

    const totalVisitors = baseVisitors + logs.filter(l => l.type === 'visitor').length;
    const totalViews = baseViews + logs.filter(l => l.type === 'view').length;

    // Calculate percentage change comparing current range vs previous range
    const currVisitors = logs.filter(l => {
      const t = new Date(l.time);
      return l.type === 'visitor' && t >= rangeStart && t <= now;
    }).length;
    const prevVisitors = logs.filter(l => {
      const t = new Date(l.time);
      return l.type === 'visitor' && t >= prevStart && t < rangeStart;
    }).length;

    const currViews = logs.filter(l => {
      const t = new Date(l.time);
      return l.type === 'view' && t >= rangeStart && t <= now;
    }).length;
    const prevViews = logs.filter(l => {
      const t = new Date(l.time);
      return l.type === 'view' && t >= prevStart && t < rangeStart;
    }).length;

    const msgList = Array.isArray(messages) ? messages : [];
    const currMsgs = msgList.filter(m => {
      const t = new Date(m.date);
      return t >= rangeStart && t <= now;
    }).length;
    const prevMsgs = msgList.filter(m => {
      const t = new Date(m.date);
      return t >= prevStart && t < rangeStart;
    }).length;

    const getPercent = (curr, prev) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    const visitorsTrend = getPercent(currVisitors, prevVisitors);
    const viewsTrend = getPercent(currViews, prevViews);
    const messagesTrend = getPercent(currMsgs, prevMsgs);
    const projectsTrend = projects.length > 0 ? 5 : 0;

    // Group logs by date for the past 27 days for chart plotting (9 intervals of 3 days)
    const chartLabels = [];
    const chartVisitors = [];
    const chartViews = [];
    
    for (let i = 8; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i * 3);
      
      const labelStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      chartLabels.push(labelStr);
      
      // Aggregates for the 3-day window
      const dateStart = new Date(d);
      dateStart.setDate(d.getDate() - 1);
      const dateEnd = new Date(d);
      dateEnd.setDate(d.getDate() + 1);
      
      const visitorsCount = logs.filter(l => {
        const t = new Date(l.time);
        return l.type === 'visitor' && t >= dateStart && t <= dateEnd;
      }).length;
      
      const viewsCount = logs.filter(l => {
        const t = new Date(l.time);
        return l.type === 'view' && t >= dateStart && t <= dateEnd;
      }).length;
      
      chartVisitors.push(visitorsCount);
      chartViews.push(viewsCount);
    }
    
    // Recent activities: construct a dynamic feed list
    const recentActivity = [];
    
    // 1. New message activities
    messages.slice(0, 3).forEach(m => {
      const diffMin = Math.max(1, Math.floor((now - new Date(m.date)) / (1000 * 60)));
      let timeStr = `${diffMin}m ago`;
      if (diffMin >= 60) {
        const diffHrs = Math.floor(diffMin / 60);
        timeStr = `${diffHrs}h ago`;
        if (diffHrs >= 24) {
          const diffDays = Math.floor(diffHrs / 24);
          timeStr = `${diffDays}d ago`;
        }
      }
      recentActivity.push({
        type: 'message',
        title: `New message from ${m.name}`,
        time: timeStr,
        timestamp: new Date(m.date)
      });
    });

    // 2. Projects update activities
    projects.slice(0, 2).forEach(p => {
      const updateDate = p.endDate ? new Date(p.endDate) : new Date();
      const diffMin = Math.max(5, Math.floor((now - updateDate) / (1000 * 60)));
      let timeStr = `${diffMin}m ago`;
      if (diffMin >= 60) {
        const diffHrs = Math.floor(diffMin / 60);
        timeStr = `${diffHrs}h ago`;
        if (diffHrs >= 24) {
          timeStr = '3 days ago';
        }
      }
      recentActivity.push({
        type: 'project',
        title: `Project "${p.title}" updated`,
        time: timeStr,
        timestamp: updateDate
      });
    });

    // 3. New visitor activity
    const lastVisitor = logs.find(l => l.type === 'visitor');
    if (lastVisitor) {
      const diffMin = Math.max(1, Math.floor((now - new Date(lastVisitor.time)) / (1000 * 60)));
      let timeStr = `${diffMin}m ago`;
      if (diffMin >= 60) {
        timeStr = `${Math.floor(diffMin / 60)}h ago`;
      }
      recentActivity.push({
        type: 'visitor',
        title: `New visitor from ${lastVisitor.country}`,
        time: timeStr,
        timestamp: new Date(lastVisitor.time)
      });
    }

    // Sort activities by timestamp desc
    recentActivity.sort((a, b) => b.timestamp - a.timestamp);

    res.json({
      totalVisitors,
      totalViews,
      totalMessages: messages.length,
      totalProjects: projects.length,
      chart: {
        labels: chartLabels,
        visitors: chartVisitors,
        views: chartViews
      },
      recentActivity: recentActivity.slice(0, 5),
      trends: {
        visitors: visitorsTrend,
        views: viewsTrend,
        messages: messagesTrend,
        projects: projectsTrend
      }
    });
  } catch (err) {
    console.error('Analytics summary failed:', err);
    res.status(500).json({ error: 'Failed to compute analytics summary' });
  }
});

// API: Handle base64 uploads (Requires Auth)
app.post('/api/upload', authenticate, async (req, res) => {
  const { fileName, fileType, fileData } = req.body;
  if (!fileName || !fileType || !fileData) {
    return res.status(400).json({ error: 'Required: fileName, fileType, fileData' });
  }

  if (!['avatars', 'cv', 'projects'].includes(fileType)) {
    return res.status(400).json({ error: 'Invalid file upload category' });
  }

  try {
    const matches = fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: 'Invalid base64 payload format' });
    }

    const mimeType = matches[1];
    const cleanName = path.basename(fileName).replace(/[^a-zA-Z0-9.\-_]/g, '');
    const pathKey = `uploads/${fileType}/${cleanName}`;
    const fileBuffer = Buffer.from(matches[2], 'base64');
    
    // Check file size (5MB limit)
    if (fileBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds maximum limit of 5MB' });
    }

    await db.saveUpload(pathKey, fileBuffer, mimeType);
    const fileUrl = `/uploads/${fileType}/${cleanName}`;
    res.json({ success: true, fileUrl });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: 'Failed to process and write uploaded file' });
  }
});

// LeetCode Stats Proxy (bypasses CORS restrictions from browser)
let leetcodeCache = {};  // { username: { data, fetchedAt } }
app.get('/api/leetcode/:username', async (req, res) => {
  const { username } = req.params;
  const now = Date.now();
  const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  if (leetcodeCache[username] && (now - leetcodeCache[username].fetchedAt) < CACHE_TTL) {
    return res.json(leetcodeCache[username].data);
  }

  const query = `
    query getUserProfile($username: String!) {
      matchedUser(username: $username) {
        username
        submitStats: submitStatsGlobal {
          acSubmissionNum {
            difficulty
            count
          }
        }
        profile {
          ranking
          reputation
          starRating
        }
        languageProblemCount {
          languageName
          problemsSolved
        }
        badges {
          id
          displayName
        }
      }
      userContestRanking(username: $username) {
        rating
        globalRanking
        totalParticipants
        attendedContestsCount
        topPercentage
      }
    }
  `;

  try {
    const https = require('https');
    const postData = JSON.stringify({ query, variables: { username } });

    const options = {
      hostname: 'leetcode.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Referer': 'https://leetcode.com',
        'User-Agent': 'Mozilla/5.0 (compatible; portfolio-proxy/1.0)'
      }
    };

    const data = await new Promise((resolve, reject) => {
      const httpReq = https.request(options, (httpRes) => {
        let raw = '';
        httpRes.on('data', chunk => { raw += chunk; });
        httpRes.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('Invalid JSON from LeetCode')); }
        });
      });
      httpReq.on('error', reject);
      httpReq.write(postData);
      httpReq.end();
    });

    if (data.errors) {
      return res.status(404).json({ error: 'LeetCode user not found', details: data.errors });
    }

    const result = data.data;
    leetcodeCache[username] = { data: result, fetchedAt: now };
    res.json(result);
  } catch (err) {
    console.error('LeetCode proxy error:', err.message);
    res.status(500).json({ error: 'Failed to fetch LeetCode profile data', message: err.message });
  }
});

// Load WebAuthn API Routes
require('./webauthn')(app, db, authenticate, preAuthSessions, activeSessions, failedAttempts, globalBlockedIps);

// Fallback all other GET routes to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Run server
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Portfolio Server running at http://localhost:${PORT}`);
    console.log(`⚙️  Admin Dashboard running at http://localhost:${PORT}/admin.html`);
    console.log(`====================================================`);
  });
});
