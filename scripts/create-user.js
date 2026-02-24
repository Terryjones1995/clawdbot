#!/usr/bin/env node
'use strict';

require('dotenv').config();
const bcrypt   = require('bcryptjs');
const readline = require('readline');
const db       = require('../src/db');

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

async function main() {
  console.log('OpenClaw — Create User\n');

  const username = (await ask('Username: ')).trim();
  if (!username) { console.error('Username cannot be empty.'); process.exit(1); }

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

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    await db.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, $3)`,
      [username, passwordHash, role]
    );
    console.log(`\nUser "${username}" created with role "${role}".`);
  } catch (err) {
    if (err.code === '23505') {
      console.error(`\nUser "${username}" already exists.`);
    } else {
      console.error('\nFailed to create user:', err.message);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
