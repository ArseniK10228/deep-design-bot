#!/usr/bin/env node
/**
 * Очистка файлов чатов (режим без Redis: PERSISTENT_DATA_PATH/owner-chat/*.json).
 * Для Redis используйте POST /api/owner-chat/clear-all из мини-приложения владельца или redis-cli.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const maintDir = process.env.PERSISTENT_DATA_PATH || path.join(__dirname, '..');
const dir = path.join(maintDir, 'owner-chat');

if (!fs.existsSync(dir)) {
  console.log('Папка owner-chat не найдена:', dir);
  process.exit(0);
}

let n = 0;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  try {
    fs.unlinkSync(path.join(dir, f));
    n++;
  } catch (e) {
    console.error('Не удалось удалить', f, e?.message || e);
  }
}
console.log('Удалено файлов:', n, 'в', dir);
