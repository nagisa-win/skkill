import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock simple-git: simpleGit 本身就是 mock fn, 返回假的 git 实例
vi.mock('simple-git', () => ({
    simpleGit: vi.fn(),
}));

import { simpleGit } from 'simple-git';
import { getUserName, ensureOrigin } from './git.js';
import { SkitError } from '../utils/logger.js';

/** 构造一个假的 simple-git 实例 (链式方法均为 spy) */
function fakeInstance(overrides: Record<string, unknown> = {}) {
    return {
        raw: vi.fn(),
        getRemotes: vi.fn(),
        addRemote: vi.fn(),
        remote: vi.fn(),
        ...overrides,
    };
}

const mockedSimpleGit = vi.mocked(simpleGit);

describe('getUserName', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('返回 trim 后的 user.name', async () => {
        mockedSimpleGit.mockReturnValue(fakeInstance({ raw: vi.fn().mockResolvedValue('  zhangsan\n') }));
        await expect(getUserName()).resolves.toBe('zhangsan');
    });

    it('user.name 为空时抛 SkitError', async () => {
        mockedSimpleGit.mockReturnValue(fakeInstance({ raw: vi.fn().mockResolvedValue('   \n') }));
        await expect(getUserName()).rejects.toThrow(SkitError);
        await expect(getUserName()).rejects.toThrow(/user\.name 为空/);
    });
});

describe('ensureOrigin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const url = 'ssh://u@example.com:8235/skills/foo';

    it('origin 不存在 → addRemote, 返回 added', async () => {
        const addRemote = vi.fn().mockResolvedValue(undefined);
        mockedSimpleGit.mockReturnValue(
            fakeInstance({
                getRemotes: vi.fn().mockResolvedValue([]),
                addRemote,
            })
        );
        await expect(ensureOrigin('/x', url)).resolves.toBe('added');
        expect(addRemote).toHaveBeenCalledWith('origin', url);
    });

    it('origin 已存在且 url 相同 → unchanged, 不动 remote', async () => {
        const addRemote = vi.fn();
        const remote = vi.fn();
        mockedSimpleGit.mockReturnValue(
            fakeInstance({
                getRemotes: vi.fn().mockResolvedValue([
                    { name: 'origin', refs: { fetch: url, push: url } },
                ]),
                addRemote,
                remote,
            })
        );
        await expect(ensureOrigin('/x', url)).resolves.toBe('unchanged');
        expect(addRemote).not.toHaveBeenCalled();
        expect(remote).not.toHaveBeenCalled();
    });

    it('origin 已存在但 url 不同 → set-url 更新, 返回 updated', async () => {
        const remote = vi.fn().mockResolvedValue(undefined);
        mockedSimpleGit.mockReturnValue(
            fakeInstance({
                getRemotes: vi.fn().mockResolvedValue([
                    { name: 'origin', refs: { fetch: 'ssh://old@example.com:8235/skills/foo' } },
                ]),
                remote,
            })
        );
        await expect(ensureOrigin('/x', url)).resolves.toBe('updated');
        expect(remote).toHaveBeenCalledWith(['set-url', 'origin', url]);
    });
});
