import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

// 展开路径中的 ~ 为用户主目录
export function expandHome(p: string): string {
    if (p === '~') return os.homedir();
    if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
    return p;
}

// 确保目录存在,递归创建
export async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}

// 路径是否存在(文件或目录或软链接均可)
export async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

// 判断 path 是否指向 target 的软链接
export async function isSymlinkTo(symlinkPath: string, target: string): Promise<boolean> {
    try {
        const stats = await fs.lstat(symlinkPath);
        if (!stats.isSymbolicLink()) return false;
        const resolvedTarget = await fs.readlink(symlinkPath);
        const absTarget = path.isAbsolute(resolvedTarget)
            ? resolvedTarget
            : path.resolve(path.dirname(symlinkPath), resolvedTarget);
        return absTarget === target;
    } catch {
        return false;
    }
}
