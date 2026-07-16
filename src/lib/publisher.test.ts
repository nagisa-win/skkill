import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock execa + config-resolver,避免测试触发真实 oneskill 调用和 yaml 加载
vi.mock('execa', () => ({
    execa: vi.fn(),
}));
vi.mock('./config-resolver.js', () => ({
    getConfigValue: vi.fn(),
}));vi.mock('./config.js', () => ({
    loadConfigSilent: vi.fn(async () => ({})),
}));
// mock ./git.js, 避免 linkIcode触发真实 simple-git 调用
vi.mock('./git.js', () => ({
    getUserName: vi.fn(),
    ensureOrigin: vi.fn(),
    init: vi.fn(),
}));

import { execa } from 'execa';
import { fetchOneskillTags, linkIcodeRemote } from './publisher.js';
import { getUserName, ensureOrigin, init as gitInit } from './git.js';
import { getConfigValue } from './config-resolver.js';
import { SkitError } from '../utils/logger.js';

const mockedExeca = vi.mocked(execa);

function mockOneskill(stdout: string, exitCode = 0, stderr = '') {
    mockedExeca.mockResolvedValueOnce({
        exitCode,
        stdout,
        stderr,
        all: stdout + stderr,
        command: 'oneskill',
        escapedCommand: 'oneskill',
        cwd: process.cwd(),
        duration: 0,
        failed: exitCode !== 0,
        killed: false,
        signal: undefined,
        signalDescription: '',
        shortMessage: '',
        originalMessage: '',
        stdio: [null, null, null],
        pipedFrom: [],
    } as never);
}

describe('fetchOneskillTags', () => {
    beforeEach(() => {
        mockedExeca.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('parses valid tag list', async () => {
        mockOneskill(JSON.stringify([{ tagId: 1, tagName: '调查研究' }, { tagId: 2, tagName: '开发编程' }]));
        const tags = await fetchOneskillTags();
        expect(tags).toEqual([
            { tagId: 1, tagName: '调查研究' },
            { tagId: 2, tagName: '开发编程' },
        ]);
    });

    it('filters out malformed entries', async () => {
        mockOneskill(
            JSON.stringify([
                { tagId: 1, tagName: 'a' },
                { tagId: '2', tagName: 'b' }, // tagId 不是 number,丢弃
                { tagId: 3 }, // 缺 tagName,丢弃
                null,
                'string-not-object',
            ])
        );
        const tags = await fetchOneskillTags();
        expect(tags).toEqual([{ tagId: 1, tagName: 'a' }]);
    });

    it('throws on empty list', async () => {
        mockOneskill('[]');
        await expect(fetchOneskillTags()).rejects.toThrow(SkitError);
    });

    it('throws on non-array response', async () => {
        mockOneskill('{"tagId":1}');
        await expect(fetchOneskillTags()).rejects.toThrow(/不是数组/);
    });

    it('throws on invalid JSON', async () => {
        mockOneskill('not json at all');
        await expect(fetchOneskillTags()).rejects.toThrow(SkitError);
    });
});

describe('linkIcodeRemote', () => {
    const mockedGetUserName = vi.mocked(getUserName);
    const mockedEnsureOrigin = vi.mocked(ensureOrigin);
    const mockedGitInit = vi.mocked(gitInit);
    const mockedGetConfigValue = vi.mocked(getConfigValue);

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('从 config 读 skillRepoUrl 模板, 替换 {user}/{skillName} 后调 init + ensureOrigin', async () => {
        mockedGetConfigValue.mockReturnValueOnce('ssh://{user}@example.com:8235/repo/{skillName}');
        mockedGetUserName.mockResolvedValue('zhangsan');
        mockedGitInit.mockResolvedValue(undefined);
        mockedEnsureOrigin.mockResolvedValue('added');

        const res = await linkIcodeRemote('/skills/foo', 'foo');

        expect(res.url).toBe('ssh://zhangsan@example.com:8235/repo/foo');
        expect(res.action).toBe('added');
        expect(mockedGitInit).toHaveBeenCalledWith('/skills/foo');
        expect(mockedEnsureOrigin).toHaveBeenCalledWith('/skills/foo', res.url);
    });

    it('模板里 skillName 占位出现多次时也全部替换', async () => {
        mockedGetConfigValue.mockReturnValueOnce('https://g.example.com/{skillName}/mirror/{skillName}.git');
        mockedGetUserName.mockResolvedValue('u');
        mockedGitInit.mockResolvedValue(undefined);
        mockedEnsureOrigin.mockResolvedValue('updated');

        const res = await linkIcodeRemote('/s/bar', 'bar');
        expect(res.url).toBe('https://g.example.com/bar/mirror/bar.git');
        expect(res.action).toBe('updated');
    });

    it('未配置 skillRepoUrl 时 throw 出清晰指引', async () => {
        mockedGetConfigValue.mockReturnValueOnce(undefined);
        await expect(linkIcodeRemote('/s/x', 'x')).rejects.toThrow(/publisher\.skillRepoUrl/);
    });

    it('getUserName 抛错时透传 (命令层负责降级)', async () => {
        mockedGetConfigValue.mockReturnValueOnce('ssh://{user}@x/x/{skillName}');
        mockedGetUserName.mockRejectedValue(new SkitError('E_INVALID_INPUT', 'user.name 为空'));
        await expect(linkIcodeRemote('/skills/x', 'x')).rejects.toThrow(/user\.name 为空/);
    });
});
