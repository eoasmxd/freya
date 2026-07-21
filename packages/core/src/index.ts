#!/usr/bin/env node
import { FreyaKernel } from './kernel.js';

const kernel = new FreyaKernel();
kernel.start().catch((err) => {
    console.error('内核运行遭遇致命异常:', err);
    process.exit(1);
});
