#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const coreDir = path.join(__dirname, 'core');
const searchPaths = [coreDir, __dirname, path.resolve(__dirname, '..')];

const FREYA_HOME = process.env.FREYA_HOME || path.join(os.homedir(), '.freya');
const PID_PATH = path.join(FREYA_HOME, 'freya.pid');

let i18n;
try {
  const i18nModulePath = path.join(coreDir, 'i18n', 'index.js');
  const zhModulePath = path.join(coreDir, 'i18n', 'locales', 'zh.js');
  const enModulePath = path.join(coreDir, 'i18n', 'locales', 'en.js');
  const { I18n } = await import(pathToFileURL(i18nModulePath).href);
  const zh = (await import(pathToFileURL(zhModulePath).href)).default;
  const en = (await import(pathToFileURL(enModulePath).href)).default;
  i18n = new I18n({ zh, en });
} catch {
  i18n = {
    t(key, defaultEn, params) {
      if (!params) return defaultEn;
      return defaultEn.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
    }
  };
}

let coreIndex;
try {
  coreIndex = require.resolve('./core', { paths: searchPaths });
  require.resolve('@eoasmxd/freya-sdk', { paths: searchPaths });
} catch {
  console.log(i18n.t('launcher.depMissing', 'ℹ️ Missing runtime dependencies. Installing now, please wait...'));
  try {
    const { execSync } = await import('node:child_process');
    execSync('npm install --omit=dev', { cwd: __dirname, stdio: 'inherit' });
    coreIndex = require.resolve('./core', { paths: searchPaths });
  } catch (installErr) {
    console.error(i18n.t('launcher.depInstallFail', '❌ Failed to install dependencies automatically. Please run manually in the root directory: npm install --omit=dev'));
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
        console.log(i18n.t('launcher.stopSuccess', '✨ Successfully sent stop signal to the background service process (PID: {pid}).', { pid }));
      } catch (err) {
        if (err.code === 'ESRCH') {
          console.log(i18n.t('launcher.stopNotFound', 'ℹ️ No running background service process detected (it may have been terminated).'));
        } else {
          console.error(i18n.t('launcher.stopFailed', '❌ Failed to stop background service: {message}', { message: err.message }));
        }
      }
    }
    await fs.rm(PID_PATH, { force: true });
  } catch {
    console.log(i18n.t('launcher.stopNoPid', 'ℹ️ No running background service PID record found.'));
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
        console.warn(i18n.t('launcher.runningWarn', '⚠️ Warning: Freya core service is already running (PID: {pid}). Duplicate start aborted.', { pid }));
        console.log(i18n.t('launcher.restartTip', '👉 To restart, please run "freya stop" first to terminate the existing service.\n'));
        process.exit(1);
      } catch (err) {
        if (err.code === 'ESRCH') {
          await fs.rm(PID_PATH, { force: true });
        } else if (err.code === 'EPERM') {
          console.warn(i18n.t('launcher.permWarn', '⚠️ Warning: Freya service is already running (PID: {pid}), but current permissions are insufficient.', { pid }));
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

function isForegroundMode(args) {
  return args.includes('--foreground') || process.env.FREYA_FOREGROUND === 'true';
}

await checkSingleInstance();

const cliEnabled = await getCliEnabled(process.argv);
const isForeground = isForegroundMode(process.argv);

let appRoot = __dirname;
try {
  const stat = await fs.stat(path.join(__dirname, 'plugins'));
  if (!stat.isDirectory()) {
    appRoot = path.resolve(__dirname, '..');
  }
} catch {
  appRoot = path.resolve(__dirname, '..');
}

if (!cliEnabled && !isForeground) {
  const child = fork(coreIndex, process.argv.slice(2), {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      FREYA_APP: process.env.FREYA_APP || appRoot,
      FREYA_LAUNCH: process.env.FREYA_LAUNCH || process.cwd()
    }
  });

  try {
    await fs.mkdir(path.dirname(PID_PATH), { recursive: true });
    await fs.writeFile(PID_PATH, String(child.pid), 'utf-8');
  } catch { }

  child.unref();
  console.log(i18n.t('launcher.bgStarted', '✨ Freya core service has been started in the background.'));
  console.log(i18n.t('launcher.bgStopTip', '👉 You can run "freya stop" to terminate this background service.\n'));
  process.exit(0);


} else {
  if (!cliEnabled) {
    console.log(i18n.t('launcher.fgStarted', '✨ Freya core service has been started successfully.\n'));
  }

  const child = fork(coreIndex, process.argv.slice(2), {
    stdio: 'inherit',
    env: {
      ...process.env,
      FREYA_APP: process.env.FREYA_APP || appRoot,
      FREYA_LAUNCH: process.env.FREYA_LAUNCH || process.cwd()
    }
  });

  const forwardSignal = (signal) => {
    if (child.pid) {
      try {
        process.kill(child.pid, signal);
      } catch { }
    }
  };
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
