// 更新 README 致谢区头像墙
//
// 替代原 .github/workflows/contributors.yml (使用的 all-contributors-cli action 已废弃)。
// 包装 `npx all-contributors-cli generate`,无网络时不中断本地开发。
//
// 用法:
//   npx tsx scripts/contributors.ts [args...]
//   # 或 (package.json 暴露 npm script 后):
//   npm run contributors -- add <user> <contribution>
//   npm run contributors -- generate
//
// 首次使用: 在仓库 Settings → Actions → General → Workflow permissions
// 打开 "Read and write permissions",然后:
//   npx tsx scripts/contributors.ts generate

import { execa } from 'execa';

const args = process.argv.slice(2);
if (args.length === 0) {
    args.push('generate');
}

const cliArgs = ['all-contributors-cli', ...args];

try {
    await execa('npx', ['--yes', ...cliArgs], { stdio: 'inherit' });
} catch (err) {
    const e = err as Error & { stderr?: string };
    console.error('Contributors update failed:', e.message);
    if (e.stderr) console.error(e.stderr);
    process.exit(1);
}
