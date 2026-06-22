import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { readPackageJson } from '../lib/package-json.js';
import { readSkillMd } from '../lib/manifest.js';
import { AVAILABLE_AGENTS } from '../agents/index.js';
import { logger } from '../utils/logger.js';

interface SkillRow {
    name: string;
    version: string;
    description: string;
    source: string;
    installedAt: string;
    upgradedAt: string;
    applied: { id: string; linkedAt: string }[];
}

export async function listCommand(opts: { json?: boolean } = {}): Promise<void> {
    const config = await loadConfig();
    const installRoot = getInstallRoot(config);
    const adapters = [...AVAILABLE_AGENTS];

    let entries: string[];
    try {
        entries = await fs.readdir(installRoot);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            logger.info(`installRoot 不存在: ${installRoot},请先 skkill install`);
            return;
        }
        throw err;
    }

    const rows: SkillRow[] = [];
    for (const name of entries) {
        const skillPath = path.join(installRoot, name);
        const stat = await fs.stat(skillPath).catch(() => null);
        if (!stat?.isDirectory()) continue;
        const pkg = await readPackageJson(skillPath);
        const { frontmatter } = await readSkillMd(skillPath);
        const skkillMeta = pkg?.skkill ?? {};
        const applied: { id: string; linkedAt: string }[] = [];
        for (const a of adapters) {
            const linkPath = path.join(a.defaultSkillsDir(), name);
            const lst = await fs.lstat(linkPath).catch(() => null);
            if (lst?.isSymbolicLink()) {
                applied.push({ id: a.id, linkedAt: lst.mtime.toISOString() });
            }
        }
        rows.push({
            name,
            version: pkg?.version ?? '?',
            description: frontmatter.description ?? pkg?.description ?? '',
            source: skkillMeta.source ?? '',
            installedAt: skkillMeta.installedAt ?? stat.mtime.toISOString(),
            upgradedAt: skkillMeta.upgradedAt ?? '',
            applied,
        });
    }

    if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
    }

    printTable(installRoot, rows);
}

function printTable(installRoot: string, rows: SkillRow[]): void {
    console.log();
    console.log(chalk.bold(`Installed skills`) + chalk.dim(`  (${installRoot}, ${rows.length} 个)`));
    console.log();

    if (rows.length === 0) {
        console.log(chalk.dim('  (无) — 用 skkill install <name> 添加'));
        console.log();
        return;
    }

    // 列宽自适应: 取所有行的最大值,但不超过上限
    const NAME_W = Math.min(Math.max(8, ...rows.map(r => visibleLen(r.name))), 28);
    const VER_W = Math.min(Math.max(5, ...rows.map(r => visibleLen(r.version))), 12);

    // 头
    const header =
        chalk.dim('  ') +
        pad('NAME', NAME_W, 'left') +
        '  ' +
        pad('VERSION', VER_W, 'left') +
        '  ' +
        pad('LINKED', 28, 'left') +
        '  ' +
        'UPDATED';
    console.log(header);
    console.log(chalk.dim('  ' + '─'.repeat(visibleLen(stripAnsi(header)) - 2)));

    // 行
    for (const r of rows) {
        const linked = formatLinked(r.applied);
        const updated = formatUpdated(r);
        const nameCol = chalk.cyan(pad(r.name, NAME_W, 'left'));
        const verCol = chalk.dim(pad(r.version, VER_W, 'left'));
        const linkedCol = pad(linked, 28, 'left');
        const updatedCol = updated;
        console.log(`  ${nameCol}  ${verCol}  ${linkedCol}  ${updatedCol}`);
    }

    // 描述行 (缩进,灰色)
    console.log();
    for (const r of rows) {
        const desc = r.description.replace(/\s+/g, ' ').trim();
        const truncated = desc.length > 90 ? desc.slice(0, 87) + '…' : desc;
        console.log(chalk.dim(`  ${r.name}: `) + truncated);
    }

    // source 行 (极小字体感,纯灰)
    if (rows.some(r => r.source)) {
        console.log();
        for (const r of rows) {
            if (!r.source) continue;
            console.log(chalk.dim(`  ${chalk.dim('source')} ${r.source}`));
        }
    }

    // 脚注
    console.log();
    console.log(
        chalk.dim(`  图例: `) + chalk.green('●') + chalk.dim(' 已链接  ') + chalk.gray('○') + chalk.dim(' 未链接')
    );
    console.log();
}

function formatLinked(applied: { id: string; linkedAt: string }[]): string {
    if (applied.length === 0) {
        return chalk.gray('○ (none)');
    }
    // 多个 agent 时, 取最近一次链接时间
    const latest = applied
        .map(a => a.linkedAt)
        .sort()
        .reverse()[0]!;
    const ids = applied.map(a => a.id).join(',');
    return chalk.green('● ') + chalk.cyan(ids) + chalk.dim(' @' + formatRelative(latest));
}

function formatUpdated(r: SkillRow): string {
    // 优先级: upgradedAt > installedAt
    const ts = r.upgradedAt || r.installedAt;
    if (!ts) return chalk.dim('—');
    return formatRelative(ts);
}

function formatRelative(iso: string): string {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return iso;
    const now = Date.now();
    const diff = Math.max(0, now - t);
    const min = 60_000;
    const hr = 60 * min;
    const day = 24 * hr;
    if (diff < min) return 'just now';
    if (diff < hr) return `${Math.floor(diff / min)}m ago`;
    if (diff < day) return `${Math.floor(diff / hr)}h ago`;
    if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
    // 超过 30 天显示具体日期
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pad(s: string, width: number, dir: 'left' | 'right'): string {
    const len = visibleLen(s);
    if (len >= width) return s;
    const fill = ' '.repeat(width - len);
    return dir === 'left' ? s + fill : fill + s;
}

function visibleLen(s: string): number {
    // chalk 输出含 ANSI, 但我们 pad 时用的就是 plain 字符串,这里只在统计纯文本宽度
    return s.length;
}

function stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, '');
}
