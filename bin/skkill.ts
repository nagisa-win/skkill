#!/usr/bin/env node
// 生产入口:编译后 dist/bin/skkill.js 由 dist/cli.js 接管
await import('../cli.js');
