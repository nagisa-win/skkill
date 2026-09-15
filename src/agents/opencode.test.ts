import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenCodeAdapter } from './opencode.js';

describe('OpenCodeAdapter', () => {
    const adapter = new OpenCodeAdapter();
    const originalXdg = process.env.XDG_CONFIG_HOME;

    beforeEach(() => {
        delete process.env.XDG_CONFIG_HOME;
    });

    afterEach(() => {
        if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = originalXdg;
    });

    it('uses $XDG_CONFIG_HOME/opencode/skills when XDG_CONFIG_HOME is set', async () => {
        process.env.XDG_CONFIG_HOME = '/tmp/fake-xdg';
        expect(await adapter.detectSkillsDir({})).toBe('/tmp/fake-xdg/opencode/skills');
    });

    it('falls back to ~/.config/opencode/skills without XDG_CONFIG_HOME', async () => {
        const expected = `${process.env.HOME}/.config/opencode/skills`;
        expect(await adapter.detectSkillsDir({})).toBe(expected);
    });

    it('skillsDirOverride wins over env and default', async () => {
        process.env.XDG_CONFIG_HOME = '/tmp/fake-xdg';
        expect(await adapter.detectSkillsDir({ agents: { opencode: { skillsDirOverride: '/my/skills' } } })).toBe('/my/skills');
    });
});
