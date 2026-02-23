#!/usr/bin/env node
'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const USERS_FILE = path.join(__dirname, '../src/data/users.json');

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

async function main() {
  console.log('OpenClaw — Create User\n');

  const username = (await ask('Username: ')).trim();
  if (!username) { console.error('Username cannot be empty.'); process.exit(1); }

  // Hide password input if possible
  const password = await new Promise((resolve) => {
    process.stdout.write('Password: ');
    const stdin = process.stdin;
    let pw = '';
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n') {
        process.stdout.write('\n');
        stdin.removeListener('data', onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw || false);
        stdin.pause();
        resolve(pw);
      } else if (ch === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (ch === '\u007f') {
        if (pw.length > 0) { pw = pw.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        pw += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });

  if (!password) { console.error('Password cannot be empty.'); process.exit(1); }

  const roleInput = (await ask('Role (admin/user) [user]: ')).trim().toLowerCase();
  const role = roleInput === 'admin' ? 'admin' : 'user';
  rl.close();

  const users = loadUsers();

  if (users.find((u) => u.username === username)) {
    console.error(`\nUser "${username}" already exists.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  users.push({ username, passwordHash, role, createdAt: new Date().toISOString() });
  saveUsers(users);

  console.log(`\nUser "${username}" created with role "${role}".`);
}

main().catch((err) => { console.error(err); process.exit(1); });
