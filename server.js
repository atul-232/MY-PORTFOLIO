const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const VISITORS_FILE = path.join(__dirname, 'visitors.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure database files exist
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(VISITORS_FILE)) fs.writeFileSync(VISITORS_FILE, '[]');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Seed Analytics Logs if empty to render realistic history
const seedAnalyticsIfEmpty = () => {
  try {
    const data = fs.readFileSync(VISITORS_FILE, 'utf8');
    const logs = JSON.parse(data || '[]');
    if (logs.length > 0) return;

    const seededLogs = [];
    const now = new Date();
    const countries = ['India', 'United States', 'United Kingdom', 'Germany', 'Canada', 'Singapore', 'Australia', 'Japan'];
    const userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.2 Mobile/15E148 Safari/604.1'
    ];

    for (let i = 29; i >= 0; i--) {
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() - i);
      
      let dailyVisitorsCount = 20 + Math.floor(Math.sin((29 - i) / 5) * 10) + Math.floor(Math.random() * 8);
      dailyVisitorsCount = Math.floor(dailyVisitorsCount * 5.5); // around 100-200 per day
      const dailyViewsCount = Math.floor(dailyVisitorsCount * 1.6);

      for (let j = 0; j < dailyVisitorsCount; j++) {
        const dateWithHour = new Date(targetDate);
        dateWithHour.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
        
        const ip = `192.168.1.${10 + Math.floor(Math.random() * 190)}`;
        seededLogs.push({
          type: 'visitor',
          ip,
          userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
          time: dateWithHour.toISOString(),
          country: countries[Math.floor(Math.random() * countries.length)]
        });
      }

      for (let j = 0; j < dailyViewsCount; j++) {
        const dateWithHour = new Date(targetDate);
        dateWithHour.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
        
        const ip = `192.168.1.${10 + Math.floor(Math.random() * 190)}`;
        seededLogs.push({
          type: 'view',
          ip,
          userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
          time: dateWithHour.toISOString(),
          country: countries[Math.floor(Math.random() * countries.length)]
        });
      }
    }

    seededLogs.sort((a, b) => new Date(b.time) - new Date(a.time));
    fs.writeFileSync(VISITORS_FILE, JSON.stringify(seededLogs, null, 2));
    console.log(`🌱 Seeded ${seededLogs.length} analytics entries to database.`);
  } catch (err) {
    console.error('Failed to seed analytics:', err);
  }
};
// seedAnalyticsIfEmpty();

// Session memory store
const activeSessions = new Set();

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
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

// Visitor Analytics Middleware
const logVisitor = (req, res, next) => {
  const isHomepageHit = req.path === '/' || req.path === '/index.html' || req.path === '/index' || req.path === '/directory.html';
  if (isHomepageHit) {
    try {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'Unknown Browser';
      
      const countries = ['India', 'United States', 'United Kingdom', 'Germany', 'Canada', 'Singapore', 'Australia', 'Japan'];
      const mockCountry = countries[Math.floor(Math.random() * countries.length)];
      
      const logs = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8') || '[]');
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
      fs.writeFileSync(VISITORS_FILE, JSON.stringify(logs, null, 2));
    } catch (err) {
      console.error('Visitor logging failed:', err);
    }
  }
  next();
};
app.use(logVisitor);

// API: Get portfolio dataset
app.get('/api/data', (req, res) => {
  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read database records' });
    }
    try {
      res.json(JSON.parse(data));
    } catch {
      res.status(500).json({ error: 'Database JSON file is corrupted' });
    }
  });
});

// API: Save portfolio dataset (Requires Auth)
app.post('/api/save-data', authenticate, (req, res) => {
  const dataset = req.body;
  if (!dataset || typeof dataset !== 'object') {
    return res.status(400).json({ error: 'Invalid body dataset format' });
  }

  fs.writeFile(DATA_FILE, JSON.stringify(dataset, null, 2), 'utf8', (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to save database edits' });
    }
    res.json({ success: true, message: 'Database saved and compiled successfully' });
  });
});

// API: Login admin
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required fields' });
  }

  try {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    if (creds.email === email && creds.password === password) {
      const token = 'token_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      activeSessions.add(token);
      return res.json({ success: true, token });
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
app.post('/api/settings/security', authenticate, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ email, password }, null, 2));
    res.json({ success: true, message: 'Credentials updated successfully' });
  } catch {
    res.status(500).json({ error: 'Failed to update credentials database' });
  }
});

// API: Get messages (Requires Auth)
app.get('/api/messages', authenticate, (req, res) => {
  try {
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8') || '[]');
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

// API: Submit message inquiry (Public)
app.post('/api/messages', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8') || '[]');
    const newMsg = {
      id: 'msg_' + Date.now(),
      name,
      email,
      subject,
      message,
      date: new Date().toISOString(),
      status: 'inbox'
    };
    messages.unshift(newMsg);
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    res.json({ success: true, message: 'Inquiry submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record message inquiry' });
  }
});

// API: Archive or Delete Message (Requires Auth)
app.post('/api/messages/action', authenticate, (req, res) => {
  const { id, action } = req.body;
  if (!id || !action) return res.status(400).json({ error: 'Invalid message action details' });

  try {
    let messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8') || '[]');
    if (action === 'delete') {
      messages = messages.filter(m => m.id !== id);
    } else if (action === 'archive') {
      messages = messages.map(m => m.id === id ? { ...m, status: 'archived' } : m);
    }
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to update message inquiry status' });
  }
});

// API: Log page hits (Public)
app.post('/api/analytics/hit', (req, res) => {
  const { type } = req.body;
  try {
    const logs = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8') || '[]');
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    if (ip.includes('::ffff:')) {
      ip = ip.replace('::ffff:', '');
    }
    const userAgent = req.headers['user-agent'] || 'Browser';
    
    const countries = ['India', 'United States', 'Canada', 'United Kingdom', 'Germany', 'Australia', 'Singapore'];
    const country = countries[Math.floor(Math.random() * countries.length)];

    logs.unshift({
      type: type === 'visitor' ? 'visitor' : 'view',
      ip,
      userAgent,
      time: new Date().toISOString(),
      country
    });

    fs.writeFileSync(VISITORS_FILE, JSON.stringify(logs, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record visitor hit' });
  }
});

// API: Get analytics (Requires Auth)
app.get('/api/analytics', authenticate, (req, res) => {
  try {
    const logs = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8') || '[]');
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Failed to load visitor analytics' });
  }
});

// API: Modify visitor analytics logs (Requires Auth)
app.post('/api/analytics/action', authenticate, (req, res) => {
  const { action, time, logEntry } = req.body;
  if (!action) return res.status(400).json({ error: 'Action parameter is required' });

  try {
    let logs = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8') || '[]');
    
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
    
    fs.writeFileSync(VISITORS_FILE, JSON.stringify(logs, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to execute analytics action' });
  }
});

// API: Get computed dashboard analytics summary (Requires Auth)
app.get('/api/analytics/summary', authenticate, (req, res) => {
  try {
    const logs = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8') || '[]');
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8') || '[]');
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
    const projects = data.projects || [];
    const now = new Date();
    
    const siteSettings = data.siteSettings || {};
    const analyticsBase = siteSettings.analyticsBase || { visitors: 0, views: 0 };
    
    const baseVisitors = parseInt(analyticsBase.visitors) || 0;
    const baseViews = parseInt(analyticsBase.views) || 0;

    const totalVisitors = baseVisitors + logs.filter(l => l.type === 'visitor').length;
    const totalViews = baseViews + logs.filter(l => l.type === 'view').length;

    // Calculate percentage change comparing [0-30 days ago] vs [30-60 days ago]
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(now.getDate() - 60);

    const currVisitors = logs.filter(l => {
      const t = new Date(l.time);
      return l.type === 'visitor' && t >= thirtyDaysAgo && t <= now;
    }).length;
    const prevVisitors = logs.filter(l => {
      const t = new Date(l.time);
      return l.type === 'visitor' && t >= sixtyDaysAgo && t < thirtyDaysAgo;
    }).length;

    const currViews = logs.filter(l => {
      const t = new Date(l.time);
      return l.type === 'view' && t >= thirtyDaysAgo && t <= now;
    }).length;
    const prevViews = logs.filter(l => {
      const t = new Date(l.time);
      return l.type === 'view' && t >= sixtyDaysAgo && t < thirtyDaysAgo;
    }).length;

    const currMsgs = messages.filter(m => {
      const t = new Date(m.date);
      return t >= thirtyDaysAgo && t <= now;
    }).length;
    const prevMsgs = messages.filter(m => {
      const t = new Date(m.date);
      return t >= sixtyDaysAgo && t < thirtyDaysAgo;
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
app.post('/api/upload', authenticate, (req, res) => {
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

    const typeDir = path.join(UPLOADS_DIR, fileType);
    if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

    // Sanitize fileName
    const cleanName = path.basename(fileName).replace(/[^a-zA-Z0-9.\-_]/g, '');
    const targetPath = path.join(typeDir, cleanName);

    const fileBuffer = Buffer.from(matches[2], 'base64');
    
    // Check file size (5MB limit)
    if (fileBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds maximum limit of 5MB' });
    }

    fs.writeFileSync(targetPath, fileBuffer);
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

  // Return cached if fresh
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
    // Dynamic import for node-fetch compatibility
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

// Fallback all other GET routes to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Run server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Portfolio Server running at http://localhost:${PORT}`);
  console.log(`⚙️  Admin Dashboard running at http://localhost:${PORT}/admin.html`);
  console.log(`====================================================`);
});
