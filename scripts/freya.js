#!/usr/bin/env node
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const coreDir = path.join(__dirname, 'core');
const searchPaths = [coreDir, __dirname, path.resolve(__dirname, '..')];
let coreIndex;
try {
  coreIndex = require.resolve('./core', { paths: searchPaths });
  require.resolve('express', { paths: searchPaths });
} catch {
  console.log('ℹ️ 未检测到运行依赖，正在为您自动执行依赖安装，请稍候...');
  try {
    const { execSync } = await import('node:child_process');
    execSync('npm install --omit=dev', { cwd: __dirname, stdio: 'inherit' });
    coreIndex = require.resolve('./core', { paths: searchPaths });
  } catch (installErr) {
    console.error('❌ 自动安装依赖失败，请在程序根目录下手动执行：npm install --omit=dev');
    process.exit(1);
  }
}

const child = fork(coreIndex, process.argv.slice(2), {
  stdio: 'inherit',
  env: {
    ...process.env,
    FREYA_APP_ROOT: __dirname
  }
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
