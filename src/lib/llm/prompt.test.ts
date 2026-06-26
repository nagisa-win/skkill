import { describe, it, expect } from 'vitest';
import { parseBriefDetail } from './prompt.js';

describe('parseBriefDetail', () => {
    it('returns plain text as detailDoc and derives briefDesc from first heading', () => {
        const md = '# 技能标题\n\n## 功能简介\n这是一个技能。';
        const out = parseBriefDetail(md);
        expect(out.detailDoc).toContain('## 功能简介');
        expect(out.briefDesc).toBe('技能标题');
    });

    it('derives briefDesc from first paragraph when no heading', () => {
        const md = '这是一段简介文字。\n\n## 更多内容';
        const out = parseBriefDetail(md);
        expect(out.briefDesc.length).toBeGreaterThan(0);
        expect(out.briefDesc.length).toBeLessThanOrEqual(100);
    });

    it('truncates briefDesc to 100 chars', () => {
        const long = 'a'.repeat(120);
        const out = parseBriefDetail(long);
        expect(out.briefDesc.length).toBeLessThanOrEqual(100);
    });
});
