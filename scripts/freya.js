#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const coreDir = path.join(__dirname, 'core');
const searchPaths = [coreDir, __dirname, path.resolve(__dirname, '..')];

const FREYA_HOME = process.env.FREYA_HOME || path.join(os.homedir(), '.freya');
const PID_PATH = path.join(FREYA_HOME, 'freya.pid');

let coreIndex;
try {
  coreIndex = require.resolve('./core', { paths: searchPaths });
  require.resolve('@eoasmxd/freya-sdk', { paths: searchPaths });
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

async function handleStopCommand() {
  try {
    const pidStr = await fs.readFile(PID_PATH, 'utf-8');
    const pid = parseInt(pidStr.trim(), 10);
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`✨ 已成功向后台服务进程 (PID: ${pid}) 发送停止信号。`);
      } catch (err) {
        if (err.code === 'ESRCH') {
          console.log('ℹ️ 未检测到运行中的后台服务进程（可能已被手动关闭）。');
        } else {
          console.error(`❌ 停止后台服务失败: ${err.message}`);
        }
      }
    }
    await fs.rm(PID_PATH, { force: true });
  } catch {
    console.log('ℹ️ 未检测到运行中的后台服务 PID 记录。');
  }
  process.exit(0);
}

if (process.argv.includes('stop')) {
  await handleStopCommand();
}

async function checkSingleInstance() {
  try {
    const pidStr = await fs.readFile(PID_PATH, 'utf-8');
    const pid = parseInt(pidStr.trim(), 10);
    if (pid) {
      try {
        process.kill(pid, 0);
        console.warn(`⚠️ 警告: 检测到 Freya 核心服务已在运行 (PID: ${pid})，请勿重复启动。`);
        console.log('👉 如果需要重启，请先运行 "freya stop" 停止现有服务。\n');
        process.exit(1);
      } catch (err) {
        if (err.code === 'ESRCH') {
          await fs.rm(PID_PATH, { force: true });
        } else if (err.code === 'EPERM') {
          console.warn(`⚠️ 警告: 检测到 Freya 服务已在运行 (PID: ${pid})，但当前用户权限不足。`);
          process.exit(1);
        }
      }
    }
  } catch {
  }
}

async function getCliEnabled(args) {
  if (args.includes('--no-cli')) {
    return false;
  }
  const configPath = path.join(FREYA_HOME, 'config', 'freya.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    if (config && config.cli && config.cli.enabled === false) {
      return false;
    }
  } catch {
  }
  return true;
}

await checkSingleInstance();

const cliEnabled = await getCliEnabled(process.argv);

if (!cliEnabled) {
  const child = fork(coreIndex, process.argv.slice(2), {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      FREYA_APP_ROOT: __dirname
    }
  });

  try {
    await fs.mkdir(path.dirname(PID_PATH), { recursive: true });
    await fs.writeFile(PID_PATH, String(child.pid), 'utf-8');
  } catch { }

  child.unref();
  console.log('✨ Freya 核心服务已成功在后台静默启动运行。');
  console.log('👉 你可以通过运行 "freya stop" 命令来停止此后台服务。\n');
  process.exit(0);
} else {
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
}
