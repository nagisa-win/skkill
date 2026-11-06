import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DshAdapter } from './dsh.js';

describe('DshAdapter', () => {
    const adapter = new DshAdapter();
    const originalDshHome = process.env.DSH_HOME;

    beforeEach(() => {
        delete process.env.DSH_HOME;
    });

    afterEach(() => {
        if (originalDshHome === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = originalDshHome;
    });

    it('uses $DSH_HOME/skills when DSH_HOME is set', async () => {
        process.env.DSH_HOME = '/tmp/fake-dsh';
        expect(await adapter.detectSkillsDir({})).toBe('/tmp/fake-dsh/skills');
    });

    it('falls back to ~/.dsh/skills without DSH_HOME', async () => {
        const expected = `${process.env.HOME}/.dsh/skills`;
        expect(await adapter.detectSkillsDir({})).toBe(expected);
    });

    it('skillsDirOverride wins over env and default', async () => {
        process.env.DSH_HOME = '/tmp/fake-dsh';
        expect(await adapter.detectSkillsDir({ agents: { dsh: { skillsDirOverride: '/my/skills' } } })).toBe(
            '/my/skills'
        );
    });

    it('expands ~ in skillsDirOverride', async () => {
        const expected = `${process.env.HOME}/.custom-dsh-skills`;
        expect(await adapter.detectSkillsDir({ agents: { dsh: { skillsDirOverride: '~/.custom-dsh-skills' } } })).toBe(
            expected
        );
    });
});
