import path from 'node:path';
import { execa } from 'execa';
import fs from 'node:fs/promises';
import { loadConfig, saveConfig, initConfig } from '../lib/config.js';
import { listEffectiveConfig } from '../lib/config-resolver.js';
import { CONFIG_PATH, SKKILL_HOME } from '../constants.js';
import { logger } from '../utils/logger.js';
import { SkitError } from '../utils/logger.js';

export interface ConfigCommandOptions {
    action: 'init' | 'show' | 'path' | 'edit' | 'set' | 'unset';
    key?: string;
    value?: string;
}

export async function configCommand(opts: ConfigCommandOptions): Promise<void> {
    switch (opts.action) {
        case 'path':
            console.log(CONFIG_PATH);
            return;
        case 'init':
            await runInit();
            return;
        case 'show':
            await runShow();
            return;
        case 'edit':
            await runEdit();
            return;
        case 'set':
            await runSet(opts.key, opts.value);
            return;
        case 'unset':
            await runUnset(opts.key);
            return;
    }
}

async function runInit(): Promise<void> {
    const existed = await initConfig();
    if (existed) {
        logger.info(`已覆盖: ${CONFIG_PATH}`);
    } else {
        logger.success(`已生成: ${CONFIG_PATH}`);
    }
    console.log(`\n下一步: 编辑 ${CONFIG_PATH} 填入 onetool.apiBase 等内网配置,或用 skkill config set <key> <value>`);
    console.log(`查看当前有效值: skkill config show\n`);
}

async function runShow(): Promise<void> {
    const config = await loadConfig();
    const entries = listEffectiveConfig(config);
    const byGroup: Record<string, typeof entries> = {};
    for (const e of entries) {
        const group = e.key.split('.')[0] ?? '_';
        (byGroup[group] ??= []).push(e);
    }
    console.log(`\nConfig: ${CONFIG_PATH}\n`);
    for (const [group, list] of Object.entries(byGroup)) {
        console.log(`  [${group}]`);
        for (const e of list) {
            const source =
                e.source === 'unset' ? '  ' : e.source === 'env' ? '↑ ' : e.source === 'config' ? '◆ ' : '· ';
            const val = e.source === 'unset' ? '(unset)' : maskIfSecret(e.key, e.value ?? '');
            console.log(`    ${source}${e.key.padEnd(28)} = ${val}  ${e.source === 'env' ? `(${e.envName})` : ''}`);
        }
        console.log();
    }
    console.log('图例: ↑ env  ◆ config.yaml  · hardcoded default  (unset) 未配置');
}

// secret 类 key 在 show 中打码
const SECRET_KEYS = new Set(['llm.apiKey', 'backend.github.token']);
function maskIfSecret(key: string, value: string): string {
    if (SECRET_KEYS.has(key) && value.length > 8) {
        return value.slice(0, 4) + '***' + value.slice(-4);
    }
    return value || '(empty)';
}

async function runEdit(): Promise<void> {
    await fs.access(CONFIG_PATH).catch(() => {
        throw new SkitError('E_INVALID_SKILL', `配置文件不存在: ${CONFIG_PATH} (请先 skkill config init)`);
    });
    const editor = process.env.EDITOR ?? process.env.VISUAL;
    if (editor) {
        await execa(editor, [CONFIG_PATH], { stdio: 'inherit' });
    } else if (process.platform === 'darwin') {
        await execa('open', [CONFIG_PATH]);
    } else {
        throw new SkitError(
            'E_INVALID_INPUT',
            '未设置 $EDITOR 环境变量,也无法用系统默认编辑器打开;请手动编辑 ' + CONFIG_PATH
        );
    }
}

async function runSet(key: string | undefined, value: string | undefined): Promise<void> {
    if (!key || value === undefined) {
        throw new SkitError(
            'E_INVALID_INPUT',
            '用法: skkill config set <key> <value>  (key 形如 backend.onetool.apiBase)'
        );
    }
    const config = await loadConfig();
    setDeep(config, key, value);
    await saveConfig(config);
    logger.success(`${key} = ${maskIfSecret(key, value)} (已写入 ${CONFIG_PATH})`);
}

async function runUnset(key: string | undefined): Promise<void> {
    if (!key) {
        throw new SkitError('E_INVALID_INPUT', '用法: skkill config unset <key>');
    }
    const config = await loadConfig();
    unsetDeep(config, key);
    await saveConfig(config);
    logger.success(`${key} 已从 config.yaml 移除 (env 仍可能覆盖)`);
}

// 点分 key → 嵌套对象
function setDeep(obj: object, key: string, value: string): void {
    const parts = key.split('.');
    let cur = obj as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]!;
        const next = cur[p];
        if (typeof next !== 'object' || next === null) {
            cur[p] = {};
        }
        cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]!] = coerceValue(value);
}

// 数字 / 布尔 / null 自动转换
function coerceValue(s: string): unknown {
    if (s === 'null' || s === '~') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
}

function unsetDeep(obj: object, key: string): void {
    const parts = key.split('.');
    let cur = obj as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]!;
        const next = cur[p];
        if (typeof next !== 'object' || next === null) return;
        cur = next as Record<string, unknown>;
    }
    delete cur[parts[parts.length - 1]!];
}

export const __testing = {
    maskIfSecret,
    setDeep,
    unsetDeep,
    coerceValue,
    SKKILL_HOME: () => SKKILL_HOME,
    path,
};
