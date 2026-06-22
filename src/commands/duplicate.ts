import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, getInstallRoot } from '../lib/config.js';
import { readPackageJson, writePackageJson } from '../lib/package-json.js';
import { readSkillMd, writeSkillMd } from '../lib/manifest.js';
import { logger } from '../utils/logger.js';
import { SkitError } from '../utils/logger.js';
import * as git from '../lib/git.js';
import { resolveSource } from '../lib/installer.js';
import { pickDefaultBackend } from '../backends/index.js';

export async function duplicateCommand(src: string, newName: string, opts: { targetDir?: string } = {}): Promise<void> {
    const config = await loadConfig();
    const installRoot = getInstallRoot(config);
    const backend = await pickDefaultBackend();
    const source = await resolveSource(src, backend);

    // 复用 installer 的 fetch 流程
    const os = await import('node:os');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-dup-'));
    let skillPath: string;
    try {
        const fetched = await backend.fetch(source, tmpDir);
        skillPath = fetched.skillPath;
        // 改名:重写 SKILL.md frontmatter + package.json
        const { frontmatter, body } = await readSkillMd(skillPath);
        frontmatter.name = newName;
        await writeSkillMd(skillPath, frontmatter, body);
        const pkg = await readPackageJson(skillPath);
        if (pkg) {
            pkg.name = newName;
            pkg.skkill = {
                ...pkg.skkill,
                source: source.gitUrl ?? source.ref,
                installedAt: new Date().toISOString(),
            };
            await writePackageJson(skillPath, pkg);
        }
        // 移到 installRoot/<newName>
        const destDir = opts.targetDir ?? installRoot;
        const destPath = path.join(destDir, newName);
        if (await fs.stat(destPath).catch(() => null)) {
            throw new SkitError('E_ALREADY_INSTALLED', `目标已存在: ${destPath}`);
        }
        await fs.cp(skillPath, destPath, { recursive: true });
        // 初始化为独立 git 仓库
        if (!(await git.isRepo(destPath))) {
            await git.init(destPath);
            await git.commitAll(destPath, `forked from ${src}`);
        }
        logger.success(`Forked ${src} → ${newName} at ${destPath}`);
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}
