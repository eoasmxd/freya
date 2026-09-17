import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import fs from 'node:fs';

const customHome = process.env.FREYA_HOME;
const customApp = process.env.FREYA_APP;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveAppRoot(): string {
  let current = __dirname;
  let coreDir = current;

  while (current) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = fs.readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(raw);
        if (pkg.name === '@eoasmxd/freya-core') {
          coreDir = current;
        }
        if (pkg.name === '@eoasmxd/freya' || fs.existsSync(path.join(current, 'plugins'))) {
          return current;
        }
      } catch {}
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return coreDir;
}

/** 运行态持久化主目录（数据与配置存放区） */
export const FREYA_HOME = customHome
  ? path.resolve(customHome)
  : path.join(os.homedir(), '.freya');

/** 程序代码物理安装根目录（只读代码与包内默认资源区） */
export const FREYA_APP = customApp
  ? path.resolve(customApp)
  : resolveAppRoot();

/** 宿主工程/工作区根目录（业务工程代码与定制资源区） */
export const FREYA_WORKSPACE = process.env.FREYA_WORKSPACE
  ? path.resolve(process.env.FREYA_WORKSPACE)
  : process.cwd();
