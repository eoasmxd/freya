#!/usr/bin/env node
import { FreyaKernel } from './kernel.js';

const kernel = new FreyaKernel();
kernel.start().catch((err) => {
    console.error('Fatal error during kernel execution:', err);
    process.exit(1);
});
