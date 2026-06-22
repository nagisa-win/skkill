import { describe, it, expect } from 'vitest';
import { buildConfigTemplate, CONFIG_FILE_NAME } from './config-template.js';
import { ConfigKey } from '../constants.js';

describe('buildConfigTemplate', () => {
    it('returns a non-empty string', () => {
        const tpl = buildConfigTemplate();
        expect(typeof tpl).toBe('string');
        expect(tpl.length).toBeGreaterThan(100);
    });

    it('declares version 1', () => {
        expect(buildConfigTemplate()).toMatch(/^version:\s*1\b/m);
    });

    it('includes a header comment explaining the file', () => {
        const tpl = buildConfigTemplate();
        expect(tpl).toContain('skkill 配置文件');
    });

    it('exports CONFIG_FILE_NAME = config.yaml', () => {
        expect(CONFIG_FILE_NAME).toBe('config.yaml');
    });
});

describe('config-template coverage of ConfigKey', () => {
    // 每个 ConfigKey 都应该至少在模板里有注释提示,否则主人会漏填
    it.each(Object.values(ConfigKey))('mentions %s (via commented example or section)', key => {
        const tpl = buildConfigTemplate();
        // 取点分末段 (例: backend.onetool.apiBase → apiBase)
        const parts = key.split('.');
        const last = parts[parts.length - 1]!;
        // 注释里通常写 # xxx: 或 # apiBase:,允许直接出现末段
        expect(tpl).toContain(last);
    });
});
