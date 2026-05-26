const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('./db');

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function executePythonCode(code, gameCodeId) {
  const db = getDb();
  const game = db.prepare('SELECT * FROM game_codes WHERE id = ?').get(gameCodeId);
  if (!game) {
    return { success: false, output: 'Game not found', correct: false };
  }

  const fileId = crypto.randomBytes(8).toString('hex');
  const filePath = path.join(TEMP_DIR, `${fileId}.py`);

  const encoded = game.encoded_data;
  const xorKey = game.xor_key;
  const password = game.code;

  const wrapped = `import base64

encoded = "${encoded.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
xor_key = ${xorKey}

${code}
`;

  try {
    fs.writeFileSync(filePath, wrapped, 'utf-8');
    const output = execSync(`python "${filePath}"`, {
      timeout: 15000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      cwd: TEMP_DIR,
      env: { ...process.env, PATH: process.env.PATH },
    }).trim();
    fs.unlinkSync(filePath);
    const correct = output === password;
    return { success: true, output, correct, expectedPassword: correct ? null : password };
  } catch (err) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    return { success: false, output: err.stderr || err.message || 'Execution error', correct: false };
  }
}

function executeGoCode(code, gameCodeId) {
  const db = getDb();
  const game = db.prepare('SELECT * FROM game_codes WHERE id = ?').get(gameCodeId);
  if (!game) {
    return { success: false, output: 'Game not found', correct: false };
  }

  const fileId = crypto.randomBytes(8).toString('hex');
  const filePath = path.join(TEMP_DIR, `${fileId}.go`);

  const encoded = game.encoded_data;
  const xorKey = game.xor_key;
  const password = game.code;

  const wrapped = `package main

import (
	"encoding/base64"
	"fmt"
)

func main() {
	encoded := "${encoded}"
	xorKey := byte(${xorKey})

${code}
}
`;

  try {
    fs.writeFileSync(filePath, wrapped, 'utf-8');
    const output = execSync(`go run "${filePath}"`, {
      timeout: 30000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      cwd: TEMP_DIR,
      env: { ...process.env, PATH: process.env.PATH },
    }).trim();
    fs.unlinkSync(filePath);
    const correct = output === password;
    return { success: true, output, correct, expectedPassword: correct ? null : password };
  } catch (err) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    return { success: false, output: err.stderr || err.message || 'Execution error', correct: false };
  }
}

module.exports = { executePythonCode, executeGoCode };
