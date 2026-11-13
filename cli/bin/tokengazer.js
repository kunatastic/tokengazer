#!/usr/bin/env node
import { homedir } from 'node:os';
import { login, logout, push, summary } from '../src/cli.js';

const home = homedir();
const [cmd, ...args] = process.argv.slice(2);

try {
  if (!cmd) console.log(`\n${summary(home)}\n`);
  else if (cmd === 'login') await login({ home });
  else if (cmd === 'push') console.log(`✓ Pushed ${await push({ home })} daily rows`);
  else if (cmd === 'logout') await logout({ home, deleteData: args.includes('--delete') });
  else {
    console.log('Usage: tokengazer [login | push | logout [--delete]]');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`tokengazer: ${err.message}`);
  process.exitCode = 1;
}
