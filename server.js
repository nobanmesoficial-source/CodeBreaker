const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, initDb } = require('./db');
const { executePythonCode, executeGoCode } = require('./codeExecutor');
const {
  submitGuess,
  getLevel1GameData,
  getLevel2GameData,
  getLevel3GameData,
  getLeaderboard,
  getUserStats,
} = require('./gameLogic');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'code-breaker-secret-key-2024';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminAuthMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    decoded.role === 'admin';
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || password.length < 3) {
      return res.status(400).json({ error: 'Username and password must be at least 3 characters' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);

    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    const token = jwt.sign({ userId: user.id, username }, JWT_SECRET, { expiresIn: '24h' });

    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Credentials required' });
    }

    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const db = getDb();
    let admin = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!admin) {
      const hash = await bcrypt.hash(password, 10);
      db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run(username, hash);
      admin = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    } else {
      db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run(username);
    }

    const token = jwt.sign({ userId: admin.id, username, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/stats', adminAuthMiddleware, (req, res) => {
  try {
    const db = getDb();
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalGames = db.prepare('SELECT COUNT(*) as count FROM game_codes').get().count;
    const totalGuesses = db.prepare('SELECT COUNT(*) as count FROM guesses').get().count;
    const totalPoints = db.prepare('SELECT COALESCE(SUM(points), 0) as total FROM points').get().total;
    res.json({ totalUsers, totalGames, totalGuesses, totalPoints });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/leaderboard', adminAuthMiddleware, (req, res) => {
  try {
    const data = getLeaderboard();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/games', adminAuthMiddleware, (req, res) => {
  try {
    const db = getDb();
    const games = db.prepare('SELECT * FROM game_codes ORDER BY id DESC LIMIT 50').all();
    res.json(games);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/activity', adminAuthMiddleware, (req, res) => {
  try {
    const db = getDb();
    const activity = db.prepare(`
      SELECT g.id, g.guess, g.correct, g.level, g.timestamp, u.username
      FROM guesses g
      JOIN users u ON u.id = g.user_id
      ORDER BY g.id DESC LIMIT 50
    `).all();
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/export', adminAuthMiddleware, (req, res) => {
  try {
    const db = getDb();
    const exportData = {
      exportedAt: new Date().toISOString(),
      users: db.prepare('SELECT id, username, is_admin, created_at FROM users').all(),
      gameCodes: db.prepare('SELECT * FROM game_codes').all(),
      guesses: db.prepare('SELECT * FROM guesses').all(),
      points: db.prepare('SELECT * FROM points').all(),
      leaderboard: getLeaderboard(),
    };
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/game/level1', authMiddleware, (req, res) => {
  try {
    const data = getLevel1GameData(req.userId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/game/level1/guess', authMiddleware, (req, res) => {
  try {
    const { guess } = req.body;
    if (!guess || !/^\d{4}$/.test(guess)) {
      return res.status(400).json({ error: 'Guess must be 4 digits' });
    }
    const result = submitGuess(req.userId, 1, guess);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/game/level2', authMiddleware, (req, res) => {
  try {
    const data = getLevel2GameData(req.userId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/game/level2/submit', authMiddleware, async (req, res) => {
  try {
    const { code, gameId } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }
    const result = executePythonCode(code, gameId);
    if (result.correct) {
      submitGuess(req.userId, 2, result.output);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/game/level3', authMiddleware, (req, res) => {
  try {
    const data = getLevel3GameData(req.userId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/game/level3/submit', authMiddleware, async (req, res) => {
  try {
    const { code, gameId } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }
    const result = executeGoCode(code, gameId);
    if (result.correct) {
      submitGuess(req.userId, 3, result.output);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/leaderboard', authMiddleware, (req, res) => {
  try {
    const data = getLeaderboard();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/user/stats', authMiddleware, (req, res) => {
  try {
    const data = getUserStats(req.userId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/', (req, res) => {
  res.redirect('/admin');
});

async function start() {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Code Breaker server running on http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
    console.log(`Admin login: ${ADMIN_USER} / ${ADMIN_PASS}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
