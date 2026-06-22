import { simpleGit } from 'simple-git';
import { SkitError } from '../utils/logger.js';

export async function clone(url: string, dest: string, opts: { shallow?: boolean } = {}): Promise<void> {
    try {
        const g = simpleGit();
        await g.clone(url, dest, opts.shallow !== false ? ['--depth', '1'] : []);
    } catch (err) {
        throw new SkitError('E_GIT_AUTH', `git clone 失败: ${(err as Error).message}`);
    }
}

export async function pull(cwd: string): Promise<void> {
    try {
        const g = simpleGit({ baseDir: cwd });
        await g.pull();
    } catch (err) {
        throw new SkitError('E_GIT_AUTH', `git pull 失败: ${(err as Error).message}`);
    }
}

export async function init(cwd: string): Promise<void> {
    const g = simpleGit({ baseDir: cwd });
    if (await g.checkIsRepo()) return;
    await g.init();
}

export async function commitAll(cwd: string, message: string): Promise<void> {
    const g = simpleGit({ baseDir: cwd });
    await g.add('.');
    await g.commit(message);
}

export async function push(cwd: string, remote: string, branch: string, force = false): Promise<void> {
    const g = simpleGit({ baseDir: cwd });
    await g.push(remote, branch, force ? ['--force'] : ['--set-upstream']);
}

export async function remoteAdd(cwd: string, name: string, url: string): Promise<void> {
    const g = simpleGit({ baseDir: cwd });
    await g.addRemote(name, url);
}

export async function defaultBranch(cwd: string): Promise<string> {
    const g = simpleGit({ baseDir: cwd });
    const branch = (await g.revparse(['--abbrev-ref', 'HEAD'])).trim();
    return branch || 'main';
}

export async function isRepo(cwd: string): Promise<boolean> {
    const g = simpleGit({ baseDir: cwd });
    return g.checkIsRepo();
}
