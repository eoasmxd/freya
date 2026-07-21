import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * 递归拷贝通用目录与文件
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
 * 递归镜像拷贝包目录（包含 dist/ schema.json package.json 等编译输出，自动排除 src 与 node_modules，保证运行程序纯洁）
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
  const distDir = path.join(PROJECT_ROOT, 'dist');

  console.log('🧹 正在清理根目录 dist...');
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  console.log('📦 正在归档 Core 编译产物...');
  const coreSrcDir = path.join(PROJECT_ROOT, 'packages', 'core');
  const coreDestDir = path.join(distDir, 'core');
  await copyPackageDir(coreSrcDir, coreDestDir, ['config']);

  console.log('📦 正在归档 Core 物理 config 默认模板...');
  const configSrc = path.join(PROJECT_ROOT, 'packages', 'core', 'config');
  const configDest = path.join(distDir, 'config');
  await copyDir(configSrc, configDest);

  console.log('📦 正在归档 SDK 编译产物...');
  const sdkSrcDir = path.join(PROJECT_ROOT, 'packages', 'sdk');
  const sdkDestDir = path.join(distDir, 'sdk');
  await copyPackageDir(sdkSrcDir, sdkDestDir);

  const rawCorePkg = await fs.readFile(path.join(coreDestDir, 'package.json'), 'utf-8');
  const corePkg = JSON.parse(rawCorePkg);
  if (corePkg.dependencies && corePkg.dependencies['@eoasmxd/freya-sdk']) {
    corePkg.dependencies['@eoasmxd/freya-sdk'] = 'file:../sdk';
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
    console.warn('警告: 无法扫描 plugins 目录:', err.message);
  }

  for (const plugin of pluginNames) {
    console.log(`📦 正在归档插件 ${plugin}...`);
    const pluginSrcDir = path.join(pluginsDir, plugin);
    const pluginDestDir = path.join(distDir, 'plugins', plugin);

    await copyPackageDir(pluginSrcDir, pluginDestDir);

    const pluginPkgDest = path.join(pluginDestDir, 'package.json');
    try {
      const rawPkg = await fs.readFile(pluginPkgDest, 'utf-8');
      const pkg = JSON.parse(rawPkg);
      if (pkg.dependencies && pkg.dependencies['@eoasmxd/freya-sdk']) {
        pkg.dependencies['@eoasmxd/freya-sdk'] = 'file:../../sdk';
      }
      if (pkg.devDependencies && pkg.devDependencies['@eoasmxd/freya-sdk']) {
        pkg.devDependencies['@eoasmxd/freya-sdk'] = 'file:../../sdk';
      }
      await fs.writeFile(pluginPkgDest, JSON.stringify(pkg, null, 2));
    } catch {
    }
  }

  console.log('📦 正在归档独立全量源代码区到 dist/src...');
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
    console.warn('警告: 归档全量源代码区出现异常:', err.message);
  }

  console.log('📦 正在归档前端 UI 静态资源...');
  const uiSrc = path.join(PROJECT_ROOT, 'packages', 'ui', 'dist');
  const uiDest = path.join(distDir, 'ui');
  try {
    await copyDir(uiSrc, uiDest);
  } catch (err) {
    console.warn('警告: 前端 UI 静态资源归档失败，请先运行 pnpm build 确保编译成功。', err.message);
  }

  console.log('📝 正在拷贝发布版外部引导器 freya.js...');
  await fs.copyFile(
    path.join(PROJECT_ROOT, 'scripts', 'freya.js'),
    path.join(distDir, 'freya.js')
  );

  console.log('📦 正在归档内置 Skills 默认技能卡...');
  const skillsSrc = path.join(PROJECT_ROOT, 'skills');
  const skillsDest = path.join(distDir, 'skills');
  await copyDir(skillsSrc, skillsDest);

  console.log('📦 正在归档文档物理目录 (doc)...');
  const docSrc = path.join(PROJECT_ROOT, 'doc');
  const docDest = path.join(distDir, 'doc');
  try {
    await fs.access(docSrc);
    await copyDir(docSrc, docDest);
  } catch {
    await fs.mkdir(docDest, { recursive: true });
  }
  console.log('📝 正在拷贝物理开源协议 LICENSE 文件...');
  try {
    await fs.copyFile(
      path.join(PROJECT_ROOT, 'LICENSE'),
      path.join(distDir, 'LICENSE')
    );
  } catch (err) {
    console.warn('警告: LICENSE 文件拷贝失败:', err.message);
  }

  console.log('📝 正在拷贝物理 README.md 说明文档...');
  try {
    await fs.copyFile(
      path.join(PROJECT_ROOT, 'README.md'),
      path.join(distDir, 'README.md')
    );
  } catch (err) {
    console.warn('警告: README.md 文件拷贝失败:', err.message);
  }

  console.log('📝 正在收集并合并全量发布版依赖...');
  const finalDeps = {
    "@eoasmxd/freya-sdk": "file:./sdk"
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

  console.log('📝 正在生成发布版 package.json...');
  const rootPkgRaw = await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf-8');
  const rootPkg = JSON.parse(rootPkgRaw);
  const rootVersion = rootPkg.version || '0.1.0';

  const distPkgContent = {
    "name": "@eoasmxd/freya",
    "version": rootVersion,
    "license": "MIT",
    "type": "module",
    "description": rootPkg.description || "Freya - 微内核智能体系统",
    "keywords": rootPkg.keywords || [],
    "publishConfig": {
      "access": "public"
    },
    "bin": {
      "freya": "./freya.js"
    },
    "files": [
      "LICENSE",
      "README.md",
      "freya.js",
      "core",
      "sdk",
      "plugins",
      "config",
      "skills",
      "ui",
      "doc",
      "src"
    ],
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

  console.log('✨ Freya 全量发布版打包归档成功！');
}

main().catch(err => {
  console.error('❌ 打包归档失败:', err);
  process.exit(1);
});
