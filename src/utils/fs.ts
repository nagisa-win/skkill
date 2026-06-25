import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// 原子写入:先写 tmp,再 rename
// tmp 名含 pid + 时间戳 + randomUUID,避免同进程并发写时撞名导致 rename ENOENT
export async function atomicWrite(targetPath: string, content: string): Promise<void> {
    const dir = path.dirname(targetPath);
    const tmp = path.join(
        dir,
        `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`
    );
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, targetPath);
}

// 递归拷贝目录
export async function copyDir(src: string, dest: string): Promise<void> {
    await fs.cp(src, dest, { recursive: true });
}

// 安全删除:如果路径不存在不抛错
export async function safeRemove(p: string): Promise<void> {
    try {
        await fs.rm(p, { recursive: true, force: true });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
}

// 读取文件为字符串,不存在返回 null
export async function readFileOrNull(p: string): Promise<string | null> {
    try {
        return await fs.readFile(p, 'utf-8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
    }
}
