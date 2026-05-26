const crypto = require('crypto');
const { getDb } = require('./db');

const CHARSET_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CHARSET_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const CHARSET_DIGITS = '0123456789';
const CHARSET_SPECIAL = '!@#$%^&*()';
const CHARSET_FULL = CHARSET_UPPER + CHARSET_LOWER + CHARSET_DIGITS + CHARSET_SPECIAL;

function generateLevel1Code() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CHARSET_DIGITS[Math.floor(Math.random() * 10)];
  }
  return code;
}

function generatePassword(length = 20) {
  let pwd = '';
  for (let i = 0; i < length; i++) {
    pwd += CHARSET_FULL[Math.floor(Math.random() * CHARSET_FULL.length)];
  }
  return pwd;
}

function generateHints(code) {
  const digits = code.split('').map(Number);
  const hints = [];

  const hintTypes = [
    () => ({ text: `Сумма цифр: ${digits.reduce((a, b) => a + b, 0)}` }),
    () => ({ text: `Произведение цифр: ${digits.reduce((a, b) => a * b, 1)}` }),
    () => ({ text: `Чётных цифр: ${digits.filter(d => d % 2 === 0).length}` }),
    () => ({ text: `Нечётных цифр: ${digits.filter(d => d % 2 !== 0).length}` }),
    () => ({ text: `Первая + последняя: ${digits[0] + digits[3]}` }),
    () => ({ text: `Сумма первых двух: ${digits[0] + digits[1]}` }),
    () => ({ text: `Сумма последних двух: ${digits[2] + digits[3]}` }),
    () => ({ text: `Диапазон цифр: ${Math.min(...digits)}-${Math.max(...digits)}` }),
    () => ({ text: `Сумма средних двух: ${digits[1] + digits[2]}` }),
    () => ({ text: `Первая * последняя: ${digits[0] * digits[3]}` }),
  ];

  const shuffled = hintTypes.sort(() => Math.random() - 0.5);
  for (let i = 0; i < 4; i++) {
    hints.push(shuffled[i]());
  }

  return hints;
}

function encodePassword(password) {
  const key = crypto.randomInt(1, 255);
  const buf = Buffer.from(password, 'utf-8');
  const encoded = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    encoded[i] = buf[i] ^ key;
  }
  return {
    encodedBase64: encoded.toString('base64'),
    xorKey: key,
    length: password.length,
    charset: CHARSET_FULL,
  };
}

function createNewGame(level) {
  const db = getDb();
  let code, hints, encodedData, xorKey;

  if (level === 1) {
    code = generateLevel1Code();
    hints = generateHints(code);
  } else {
    code = generatePassword(20);
    const enc = encodePassword(code);
    encodedData = enc.encodedBase64;
    xorKey = enc.xorKey;
    hints = JSON.stringify([{ text: `Длина пароля: ${enc.length}` }, { text: `Символы: буквы, цифры, спецсимволы` }]);
  }

  const stmt = db.prepare(`
    INSERT INTO game_codes (level, code, hints, encoded_data, xor_key, charset, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  if (level === 1) {
    stmt.run(level, code, JSON.stringify(hints), null, null, null);
  } else {
    stmt.run(level, code, hints, encodedData, xorKey, CHARSET_FULL);
  }

  return db.prepare('SELECT * FROM game_codes WHERE id = last_insert_rowid()').get();
}

function getActiveGame(level) {
  const db = getDb();
  let game = db.prepare('SELECT * FROM game_codes WHERE level = ? AND active = 1 ORDER BY id DESC LIMIT 1').get(level);
  if (!game) {
    game = createNewGame(level);
  }
  return game;
}

function rotateGameIfNeeded(level) {
  const db = getDb();
  const game = getActiveGame(level);
  if (!game) return createNewGame(level);

  const guessCount = db.prepare('SELECT COUNT(*) as count FROM guesses WHERE game_code_id = ? AND correct = 1').get(game.id).count;

  if (guessCount >= 1) {
    db.prepare('UPDATE game_codes SET active = 0 WHERE id = ?').run(game.id);
    return createNewGame(level);
  }

  return game;
}

function submitGuess(userId, level, guess) {
  const db = getDb();
  const game = rotateGameIfNeeded(level);

  const isCorrect = String(guess).trim() === String(game.code).trim();
  const correctVal = isCorrect ? 1 : 0;

  db.prepare('INSERT INTO guesses (user_id, level, game_code_id, guess, correct) VALUES (?, ?, ?, ?, ?)')
    .run(userId, level, game.id, guess, correctVal);

  if (isCorrect) {
    const alreadyEarned = db.prepare('SELECT id FROM points WHERE user_id = ? AND game_code_id = ?')
      .get(userId, game.id);
    if (!alreadyEarned) {
      db.prepare('INSERT INTO points (user_id, level, points, game_code_id) VALUES (?, ?, 15, ?)')
        .run(userId, level, game.id);

      db.prepare('UPDATE game_codes SET active = 0 WHERE id = ?').run(game.id);
      createNewGame(level);
    }
    return { correct: true, points: 15, message: 'Correct! +15 points' };
  }

  return { correct: false, points: 0, message: 'Wrong guess. Try again!' };
}

function getLevel1GameData(userId) {
  const db = getDb();
  const game = getActiveGame(1);
  const hints = JSON.parse(game.hints || '[]');

  const totalGuesses = db.prepare('SELECT COUNT(*) as count FROM guesses WHERE game_code_id = ?').get(game.id).count;
  const userGuesses = db.prepare('SELECT guess, correct, timestamp FROM guesses WHERE game_code_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 10')
    .all(game.id, userId);

  return {
    gameId: game.id,
    hints: hints,
    totalGuesses: totalGuesses,
    yourGuesses: userGuesses,
  };
}

function getLevel2GameData(userId) {
  const db = getDb();
  const game = getActiveGame(2);
  const encodedData = game.encoded_data;
  const xorKey = game.xor_key;

  const userGuesses = db.prepare('SELECT guess, correct, timestamp FROM guesses WHERE game_code_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 5')
    .all(game.id, userId);

  return {
    gameId: game.id,
    encodedBase64: encodedData,
    xorKey: xorKey,
    length: 20,
    charset: CHARSET_FULL,
    yourSubmissions: userGuesses,
    serverCodeExample: generateServerCodeExample(encodedData, xorKey),
  };
}

function getLevel3GameData(userId) {
  const db = getDb();
  const game = getActiveGame(3);
  const encodedData = game.encoded_data;
  const xorKey = game.xor_key;

  const userGuesses = db.prepare('SELECT guess, correct, timestamp FROM guesses WHERE game_code_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 5')
    .all(game.id, userId);

  return {
    gameId: game.id,
    encodedBase64: encodedData,
    xorKey: xorKey,
    length: 20,
    charset: CHARSET_FULL,
    yourSubmissions: userGuesses,
    serverCodeExample: generateServerCodeExample(encodedData, xorKey),
  };
}

function generateServerCodeExample(encodedBase64, xorKey) {
  return `# Сервер закодировал пароль:
# base64: ${encodedBase64}
# xor_key: ${xorKey}
# 
# Ваш код должен декодировать и вывести пароль.`;
}

function getLeaderboard() {
  const db = getDb();
  return db.prepare(`
    SELECT u.username, COALESCE(SUM(p.points), 0) as total_points,
           COUNT(DISTINCT CASE WHEN p.level = 1 THEN p.game_code_id END) as level1_wins,
           COUNT(DISTINCT CASE WHEN p.level = 2 THEN p.game_code_id END) as level2_wins,
           COUNT(DISTINCT CASE WHEN p.level = 3 THEN p.game_code_id END) as level3_wins
    FROM users u
    LEFT JOIN points p ON u.id = p.user_id
    GROUP BY u.id
    ORDER BY total_points DESC
    LIMIT 50
  `).all();
}

function getUserStats(userId) {
  const db = getDb();
  const totalPoints = db.prepare('SELECT COALESCE(SUM(points), 0) as total FROM points WHERE user_id = ?').get(userId).total;
  const levelWins = db.prepare(`
    SELECT level, COUNT(DISTINCT game_code_id) as wins
    FROM points WHERE user_id = ?
    GROUP BY level
  `).all(userId);

  const rank = db.prepare(`
    SELECT COUNT(*) + 1 as rank FROM (
      SELECT user_id, SUM(points) as total
      FROM points GROUP BY user_id
      HAVING total > (SELECT COALESCE(SUM(points), 0) FROM points WHERE user_id = ?)
    )
  `).get(userId).rank;

  return { totalPoints, levelWins, rank };
}

module.exports = {
  getActiveGame,
  submitGuess,
  getLevel1GameData,
  getLevel2GameData,
  getLevel3GameData,
  getLeaderboard,
  getUserStats,
  encodePassword,
  generatePassword,
  CHARSET_FULL,
};
