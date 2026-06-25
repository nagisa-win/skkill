import path from 'node:path';
import { SkitError } from './logger.js';

// 把任意字符串归一为文件系统安全的目录/文件名
// 规则(toLowerCase → 非安全字符替 `-` → 去首尾 . 和 - → 255 截断 → 空字符串兜底)
export function sanitizeName(name: string): string {
    const lower = name.toLowerCase();
    const replaced = lower.replace(/[^a-z0-9._-]+/g, '-');
    const trimmed = replaced.replace(/^[.-]+|[.-]+$/g, '');
    const cut = trimmed.slice(0, 255);
    return cut.length > 0 ? cut : 'unnamed-skill';
}

// 判断 target 解析后是否落在 base 之下(防路径穿越)
export function isPathSafe(base: string, target: string): boolean {
    const resolvedBase = path.resolve(base);
    const resolvedTarget = path.resolve(target);
    const rel = path.relative(resolvedBase, resolvedTarget);
    return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

// 不安全时抛 E_INVALID_INPUT,带具体越界路径便于排查
export function assertPathSafe(base: string, target: string): void {
    if (!isPathSafe(base, target)) {
        throw new SkitError(
            'E_INVALID_INPUT',
            `路径不安全: target "${target}" 解析后超出 base "${base}" 边界`
        );
    }
}