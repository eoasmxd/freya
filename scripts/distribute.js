import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * 递归拷贝通用目录与文件
 * Recursively copy directories and files
 */
async function copyDir(srcDir, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * 递归镜像拷贝包目录（自动排除源码与开发缓存）
 * Recursively mirror copy package directory, excluding src and development caches
 */
async function copyPackageDir(srcDir, destDir, excludeNames = []) {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  const ignores = new Set(['src', 'node_modules', 'tsconfig.json', '.tsbuildinfo', ...excludeNames]);

  for (const entry of entries) {
    if (ignores.has(entry.name)) {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  const isRelease = process.argv.includes('--release');
  const distDir = path.join(PROJECT_ROOT, 'dist');

  console.log('📝 Reading version information...');
  const rootPkgRaw = await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf-8');
  const rootPkg = JSON.parse(rootPkgRaw);
  const rootVersion = rootPkg.version || '0.1.0';

  if (isRelease) {
    console.log(`📝 Release mode: Syncing SDK package version to ${rootVersion}...`);
    const sdkPkgPath = path.join(PROJECT_ROOT, 'packages', 'sdk', 'package.json');
    const rawSdkPkg = await fs.readFile(sdkPkgPath, 'utf-8');
    const sdkPkg = JSON.parse(rawSdkPkg);
    sdkPkg.version = rootVersion;
    await fs.writeFile(sdkPkgPath, JSON.stringify(sdkPkg, null, 2) + '\n', 'utf-8');
  }

  console.log('🧹 Cleaning root dist directory...');
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  console.log('📦 Archiving core build artifacts...');
  const coreSrcDir = path.join(PROJECT_ROOT, 'packages', 'core');
  const coreDestDir = path.join(distDir, 'core');
  await copyPackageDir(coreSrcDir, coreDestDir, ['config']);

  console.log('📦 Archiving core configuration default templates...');
  const configSrc = path.join(PROJECT_ROOT, 'packages', 'core', 'config');
  const configDest = path.join(distDir, 'config');
  await copyDir(configSrc, configDest);

  if (!isRelease) {
    console.log('📦 Archiving SDK build artifacts...');
    const sdkSrcDir = path.join(PROJECT_ROOT, 'packages', 'sdk');
    const sdkDestDir = path.join(distDir, 'sdk');
    await copyPackageDir(sdkSrcDir, sdkDestDir);
  }

  const rawCorePkg = await fs.readFile(path.join(coreDestDir, 'package.json'), 'utf-8');
  const corePkg = JSON.parse(rawCorePkg);
  if (corePkg.dependencies && corePkg.dependencies['@eoasmxd/freya-sdk']) {
    corePkg.dependencies['@eoasmxd/freya-sdk'] = isRelease ? `^${rootVersion}` : 'file:../sdk';
  }
  await fs.writeFile(path.join(coreDestDir, 'package.json'), JSON.stringify(corePkg, null, 2));

  const pluginsDir = path.join(PROJECT_ROOT, 'plugins');
  let pluginNames = [];
  try {
    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    pluginNames = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    console.warn('Warning: Failed to scan plugins directory:', err.message);
  }

  for (const plugin of pluginNames) {
    console.log(`📦 Archiving plugin ${plugin}...`);
    const pluginSrcDir = path.join(pluginsDir, plugin);
    const pluginDestDir = path.join(distDir, 'plugins', plugin);

    await copyPackageDir(pluginSrcDir, pluginDestDir);

    const pluginPkgDest = path.join(pluginDestDir, 'package.json');
    try {
      const rawPkg = await fs.readFile(pluginPkgDest, 'utf-8');
      const pkg = JSON.parse(rawPkg);
      if (pkg.dependencies && pkg.dependencies['@eoasmxd/freya-sdk']) {
        pkg.dependencies['@eoasmxd/freya-sdk'] = isRelease ? `^${rootVersion}` : 'file:../../sdk';
      }
      if (pkg.devDependencies && pkg.devDependencies['@eoasmxd/freya-sdk']) {
        pkg.devDependencies['@eoasmxd/freya-sdk'] = isRelease ? `^${rootVersion}` : 'file:../../sdk';
      }
      await fs.writeFile(pluginPkgDest, JSON.stringify(pkg, null, 2));
    } catch {
    }
  }

  console.log('📦 Archiving full source code to dist/src...');
  const distSrcDir = path.join(distDir, 'src');
  try {
    const coreCodeSrc = path.join(PROJECT_ROOT, 'packages', 'core', 'src');
    await copyDir(coreCodeSrc, path.join(distSrcDir, 'packages', 'core', 'src'));

    const sdkCodeSrc = path.join(PROJECT_ROOT, 'packages', 'sdk', 'src');
    await copyDir(sdkCodeSrc, path.join(distSrcDir, 'packages', 'sdk', 'src'));

    const uiCodeSrc = path.join(PROJECT_ROOT, 'packages', 'ui', 'src');
    try {
      await fs.access(uiCodeSrc);
      await copyDir(uiCodeSrc, path.join(distSrcDir, 'packages', 'ui', 'src'));
    } catch { }

    for (const plugin of pluginNames) {
      const pluginCodeSrc = path.join(pluginsDir, plugin, 'src');
      try {
        await fs.access(pluginCodeSrc);
        await copyDir(pluginCodeSrc, path.join(distSrcDir, 'plugins', plugin, 'src'));
      } catch { }
    }
  } catch (err) {
    console.warn('Warning: Exception while archiving source code:', err.message);
  }

  console.log('📦 Archiving frontend UI static assets...');
  const uiSrc = path.join(PROJECT_ROOT, 'packages', 'ui', 'dist');
  const uiDest = path.join(distDir, 'ui');
  try {
    await copyDir(uiSrc, uiDest);
  } catch (err) {
    console.warn('Warning: Frontend UI build artifacts not found, ensure pnpm build completed successfully.', err.message);
  }

  console.log('📝 Copying launcher entry script freya.js...');
  await fs.copyFile(
    path.join(PROJECT_ROOT, 'scripts', 'freya.js'),
    path.join(distDir, 'freya.js')
  );

  console.log('📦 Archiving built-in skills cards...');
  const skillsSrc = path.join(PROJECT_ROOT, 'skills');
  const skillsDest = path.join(distDir, 'skills');
  await copyDir(skillsSrc, skillsDest);

  console.log('📦 Archiving documentation directory (doc)...');
  const docSrc = path.join(PROJECT_ROOT, 'doc');
  const docDest = path.join(distDir, 'doc');
  try {
    await fs.access(docSrc);
    await copyDir(docSrc, docDest);
  } catch {
    await fs.mkdir(docDest, { recursive: true });
  }
  console.log('📝 Copying root documentation and license files...');
  const rootDocs = [
    'LICENSE',
    'README.md',
    'README.zh.md',
    'SECURITY.md',
    'SECURITY.zh.md',
    'THIRD_PARTY_NOTICES.md'
  ];
  for (const docFile of rootDocs) {
    try {
      await fs.copyFile(
        path.join(PROJECT_ROOT, docFile),
        path.join(distDir, docFile)
      );
    } catch {
      // 忽略可选文档不存在的异常
    }
  }

  console.log('📝 Collecting and merging distribution dependencies...');
  const finalDeps = {
    "@eoasmxd/freya-sdk": isRelease ? `^${rootVersion}` : "file:./sdk"
  };

  if (corePkg.dependencies) {
    for (const [name, val] of Object.entries(corePkg.dependencies)) {
      if (name !== '@eoasmxd/freya-sdk') finalDeps[name] = val;
    }
  }

  for (const plugin of pluginNames) {
    const pluginSrcDir = path.join(pluginsDir, plugin);
    try {
      const rawPkg = await fs.readFile(path.join(pluginSrcDir, 'package.json'), 'utf-8');
      const pkg = JSON.parse(rawPkg);
      if (pkg.dependencies) {
        for (const [name, val] of Object.entries(pkg.dependencies)) {
          if (name !== '@eoasmxd/freya-sdk') finalDeps[name] = val;
        }
      }
    } catch {
    }
  }

  console.log('📝 Generating distribution package.json...');
  const filesToInclude = [
    "LICENSE",
    "README.md",
    "README.zh.md",
    "SECURITY.md",
    "SECURITY.zh.md",
    "THIRD_PARTY_NOTICES.md",
    "freya.js",
    "core",
    "plugins",
    "config",
    "skills",
    "ui",
    "doc",
    "src"
  ];
  if (!isRelease) {
    filesToInclude.push("sdk");
  }

  const distPkgContent = {
    "name": "@eoasmxd/freya",
    "version": rootVersion,
    "license": "MIT",
    "type": "module",
    "description": rootPkg.description || "Freya - Lightweight Microkernel AI Agent System",
    "keywords": rootPkg.keywords || [],
    "repository": rootPkg.repository || {
      "type": "git",
      "url": "git+https://github.com/eoasmxd/freya.git"
    },
    "publishConfig": {
      "access": "public"
    },
    "bin": {
      "freya": "./freya.js"
    },
    "files": filesToInclude,
    "dependencies": finalDeps,

    "scripts": {
      "start": "node freya.js",
      "freya": "node freya.js"
    }
  };
  await fs.writeFile(
    path.join(distDir, 'package.json'),
    JSON.stringify(distPkgContent, null, 2) + '\n',
    'utf-8'
  );

  console.log('✨ Freya full distribution package assembled successfully!');
}

main().catch(err => {
  console.error('❌ Distribution assembly failed:', err);
  process.exit(1);
});
