import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { parseSource, resolveLocalPath } from './source-parser.js';

describe('parseSource', () => {
    describe('local', () => {
        it('recognizes absolute paths', () => {
            expect(parseSource('/tmp/skill')).toEqual({ kind: 'local', raw: '/tmp/skill', path: '/tmp/skill' });
        });
        it('recognizes ~ and expands home', () => {
            const r = parseSource('~/skills/foo');
            expect(r.kind).toBe('local');
            if (r.kind === 'local') expect(r.path).toBe(path.join(os.homedir(), 'skills/foo'));
        });
        it('recognizes ./ and ../ relative paths', () => {
            expect(parseSource('./foo').kind).toBe('local');
            expect(parseSource('../bar').kind).toBe('local');
        });
        it('expands bare ~ to homedir', () => {
            expect(parseSource('~')).toEqual({ kind: 'local', raw: '~', path: os.homedir() });
        });
    });

    describe('git-url', () => {
        it('recognizes SSH form git@host:owner/repo.git', () => {
            expect(parseSource('git@github.com:vercel-labs/skills.git')).toEqual({
                kind: 'git-url',
                raw: 'git@github.com:vercel-labs/skills.git',
                url: 'git@github.com:vercel-labs/skills.git',
            });
        });
        it('recognizes https URL', () => {
            expect(parseSource('https://github.com/foo/bar.git').kind).toBe('git-url');
        });
        it('recognizes git:// protocol', () => {
            expect(parseSource('git://github.com/foo/bar.git').kind).toBe('git-url');
        });
        it('recognizes file:// URL', () => {
            expect(parseSource('file:///tmp/skill').kind).toBe('git-url');
        });
        it('recognizes bare .git suffix without protocol', () => {
            expect(parseSource('example.com/foo.git').kind).toBe('git-url');
        });
    });

    describe('owner-repo', () => {
        it('parses simple owner/repo', () => {
            expect(parseSource('vercel-labs/skills')).toEqual({
                kind: 'owner-repo',
                raw: 'vercel-labs/skills',
                owner: 'vercel-labs',
                repo: 'skills',
            });
        });
        it('parses owner/repo with subpath', () => {
            expect(parseSource('vercel-labs/skills/frontend-design')).toEqual({
                kind: 'owner-repo',
                raw: 'vercel-labs/skills/frontend-design',
                owner: 'vercel-labs',
                repo: 'skills',
                subpath: 'frontend-design',
            });
        });
    });

    describe('registry-name', () => {
        it('recognizes simple kebab name', () => {
            expect(parseSource('my-skill')).toEqual({
                kind: 'registry-name',
                raw: 'my-skill',
                name: 'my-skill',
            });
        });
        it('recognizes scoped npm-like name as registry', () => {
            expect(parseSource('@steven-y/skkill').kind).toBe('registry-name');
        });
    });

    it('rejects empty ref', () => {
        expect(() => parseSource('')).toThrow(/empty ref/);
        expect(() => parseSource('   ')).toThrow(/empty ref/);
    });
});

describe('resolveLocalPath', () => {
    it('expands ~ and resolves to absolute', () => {
        const r = resolveLocalPath('~/foo');
        expect(path.isAbsolute(r)).toBe(true);
        expect(r).toContain('foo');
    });
});

// 边界 case 锁定 (by-design,改这些会破坏现有调用方)
describe('parseSource 边界行为锁定', () => {
    it('前后空白会被 trim', () => {
        const r = parseSource('  vercel-labs/skills  ');
        expect(r.kind).toBe('owner-repo');
        if (r.kind === 'owner-repo') {
            expect(r.owner).toBe('vercel-labs');
            expect(r.repo).toBe('skills');
        }
    });

    it('owner/repo 多层 subpath 全部归到 subpath 字段', () => {
        const r = parseSource('vercel-labs/skills/a/b/c');
        expect(r.kind).toBe('owner-repo');
        if (r.kind === 'owner-repo') {
            expect(r.owner).toBe('vercel-labs');
            expect(r.repo).toBe('skills');
            expect(r.subpath).toBe('a/b/c');
        }
    });

    it('带末尾斜杠的 owner/repo/ 走 registry 兜底 (regex 不匹配末尾 /)', () => {
        // OWNER_REPO_RE = /^([\w.-]+)\/([\w.-]+)(?:\/(.+))?$/
        // 'foo/bar/' 中末尾的 '/' 让 (?:\/(.+))? 这组失败 → 整体不 match
        // → 落 registry 兜底 (调用方需自行处理)
        const r = parseSource('foo/bar/');
        expect(r.kind).toBe('registry-name');
    });

    it('owner 允许包含点和短横线', () => {
        expect(parseSource('some.host.com/repo').kind).toBe('owner-repo');
        expect(parseSource('user.name/repo').kind).toBe('owner-repo');
    });

    it('git@ URL 末尾不带 .git 也走 git-url', () => {
        // GIT_URL_RE 以 git@ 前缀直接命中
        expect(parseSource('git@github.com:foo/bar').kind).toBe('git-url');
    });

    it('纯数字开头的 ref 走 registry', () => {
        expect(parseSource('123-skill').kind).toBe('registry-name');
    });

    it('包含空格的非法 ref 走兜底 registry (不抛错)', () => {
        // REGISTRY_NAME_RE 不匹配空格,落到兜底分支
        const r = parseSource('foo bar');
        expect(r.kind).toBe('registry-name');
        if (r.kind === 'registry-name') expect(r.name).toBe('foo bar');
    });
});