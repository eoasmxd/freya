import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function isVersionPublished(name, version) {
  try {
    const output = execSync(`npm view "${name}@${version}" version --json`, {
      stdio: ['pipe', 'pipe', 'pipe']
    }).toString().trim();
    const parsed = JSON.parse(output);
    return parsed === version;
  } catch {
    return false;
  }
}

function publishPackage(targetDir) {
  const resolvedDir = path.resolve(PROJECT_ROOT, targetDir);
  const pkgPath = path.join(resolvedDir, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    console.error(`❌ [Publish] package.json not found in ${targetDir}`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const fullName = `${pkg.name}@${pkg.version}`;

  console.log(`🔍 [Publish] Checking ${fullName} on NPM...`);
  if (isVersionPublished(pkg.name, pkg.version)) {
    console.log(`⏩ [Publish] ${fullName} is already published on NPM, skipping.`);
    return;
  }

  console.log(`🚀 [Publish] Publishing ${fullName} to NPM...`);
  try {
    execSync(`npm publish "${resolvedDir}" --access public`, {
      stdio: 'inherit'
    });
    console.log(`✨ [Publish] Successfully published ${fullName}`);
  } catch (err) {
    console.error(`❌ [Publish] Failed to publish ${fullName}`);
    process.exit(1);
  }
}

function main() {
  const cliArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const targetDirs = cliArgs.length > 0 ? cliArgs : ['./packages/sdk', './dist'];

  for (const dir of targetDirs) {
    publishPackage(dir);
  }
}

main();
