import { execa } from 'execa';
import fs from 'node:fs/promises';
import { loadConfig } from '../lib/config.js';
import { SKKILL_HOME, CONFIG_PATH, DEFAULT_INSTALL_ROOT } from '../constants.js';
import { listEffectiveConfig } from '../lib/config-resolver.js';
import { pathExists } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { BACKENDS } from '../backends/index.js';

interface CheckResult {
    name: string;
    ok: boolean;
    detail?: string;
}

export async function doctorCommand(): Promise<void> {
    const checks: CheckResult[] = [];

    // node 版本
    checks.push({
        name: 'Node.js',
        ok: Number(process.versions.node.split('.')[0]) >= 20,
        detail: process.versions.node,
    });

    // git
    try {
        const { stdout } = await execa('git', ['--version']);
        checks.push({ name: 'git', ok: true, detail: stdout.trim() });
    } catch {
        checks.push({ name: 'git', ok: false, detail: 'not found in PATH' });
    }

    // npm
    try {
        const { stdout } = await execa('npm', ['--version']);
        checks.push({ name: 'npm', ok: true, detail: stdout.trim() });
    } catch {
        checks.push({ name: 'npm', ok: false, detail: 'not found in PATH' });
    }

    // 加载 config (首次运行自动生成模板)
    const config = await loadConfig();

    // onetool: 按 config 走,未配置时友好降级 (不报红)
    const onetoolApiBase = listEffectiveConfig(config).find(e => e.key === 'backend.onetool.apiBase')?.value;
    if (onetoolApiBase) {
        const onetoolStatus = await BACKENDS.onetool.available();
        checks.push({
            name: 'onetool',
            ok: onetoolStatus.ok,
            detail: onetoolStatus.ok ? onetoolApiBase : `unreachable: ${onetoolStatus.reason}`,
        });
    } else {
        checks.push({
            name: 'onetool',
            ok: true,
            detail: 'not configured (search fallback to github, install falls back to git)',
        });
    }

    // skkill home
    const homeExists = await pathExists(SKKILL_HOME);
    checks.push({ name: '~/.skkill/', ok: homeExists, detail: SKKILL_HOME });

    // config
    const configExists = await pathExists(CONFIG_PATH);
    checks.push({
        name: 'config.yaml',
        ok: true,
        detail: configExists ? CONFIG_PATH : 'not found (using defaults)',
    });

    // installRoot
    const installRoot = config.installRoot ?? DEFAULT_INSTALL_ROOT;
    const installExists = await pathExists(installRoot);
    checks.push({
        name: 'installRoot',
        ok: true,
        detail: `${installRoot}${installExists ? '' : ' (not yet created)'}`,
    });

    // LLM provider + key 状态
    const llmEntries = listEffectiveConfig(config).filter(e => e.key.startsWith('llm.'));
    const llmProvider = llmEntries.find(e => e.key === 'llm.provider')?.value ?? 'anthropic';
    const llmKey = llmEntries.find(e => e.key === 'llm.apiKey')?.value;
    checks.push({
        name: 'LLM',
        ok: true,
        detail: llmKey
            ? `${llmProvider} (key set, create/publish-brief 可用)`
            : `${llmProvider} (no key, create/publish-brief 不可用,其它命令不受影响)`,
    });

    // oneskill (publisher)
    let oneskillStatus = 'not detected (publish 不可用)';
    const oneskillOk = true;
    try {
        const { stdout } = await execa('oneskill', ['--version'], { reject: false });
        if (stdout.trim()) {
            oneskillStatus = `${stdout.trim()} (publish 可用)`;
        }
    } catch {
        // 未装不报红,只是提示
    }
    checks.push({ name: 'oneskill', ok: oneskillOk, detail: oneskillStatus });

    // 打印
    console.log('\nskkill doctor:\n');
    for (const c of checks) {
        const icon = c.ok ? '✔' : '✖';
        console.log(`  ${icon} ${c.name.padEnd(16)} ${c.detail ?? ''}`);
    }
    console.log();

    // HOME 写权限
    try {
        await fs.access(SKKILL_HOME, fs.constants.W_OK);
    } catch {
        logger.warn(`当前用户对 ${SKKILL_HOME} 无写权限,部分命令可能失败`);
    }
}
