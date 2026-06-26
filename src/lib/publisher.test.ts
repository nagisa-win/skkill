import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock execa + config-resolver,避免测试触发真实 oneskill 调用和 yaml 加载
vi.mock('execa', () => ({
    execa: vi.fn(),
}));
vi.mock('./config-resolver.js', () => ({
    getConfigValue: vi.fn(() => undefined),
}));
vi.mock('./config.js', () => ({
    loadConfigSilent: vi.fn(async () => ({})),
}));

import { execa } from 'execa';
import { fetchOneskillTags } from './publisher.js';
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
