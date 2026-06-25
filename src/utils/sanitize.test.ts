import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { sanitizeName, isPathSafe, assertPathSafe } from './sanitize.js';
import { SkitError } from './logger.js';

describe('sanitizeName', () => {
    it('lowercases and replaces unsafe chars', () => {
        expect(sanitizeName('Foo@Bar!Baz')).toBe('foo-bar-baz');
    });

    it('strips leading and trailing dots/dashes', () => {
        expect(sanitizeName('.hidden')).toBe('hidden');
        expect(sanitizeName('..')).toBe('unnamed-skill');
        expect(sanitizeName('-foo-')).toBe('foo');
    });

    it('falls back to unnamed-skill for empty input', () => {
        expect(sanitizeName('')).toBe('unnamed-skill');
        expect(sanitizeName('@@@')).toBe('unnamed-skill');
    });

    it('truncates to 255 chars', () => {
        const long = 'a'.repeat(300);
        expect(sanitizeName(long).length).toBe(255);
    });

    it('keeps existing safe chars', () => {
        expect(sanitizeName('my-skill_v1.0')).toBe('my-skill_v1.0');
    });
});

describe('isPathSafe', () => {
    it('returns true for direct child', () => {
        expect(isPathSafe('/base', '/base/foo')).toBe(true);
    });

    it('returns true for nested descendant', () => {
        expect(isPathSafe('/base', '/base/a/b/c')).toBe(true);
    });

    it('returns false for sibling escape', () => {
        expect(isPathSafe('/base', '/other/foo')).toBe(false);
    });

    it('returns false for ../ traversal', () => {
        expect(isPathSafe('/base', '/base/../etc/passwd')).toBe(false);
    });

    it('handles absolute paths consistently', () => {
        expect(isPathSafe('/base', '/base/foo')).toBe(true);
        expect(isPathSafe('/base', '/base/../escape')).toBe(false);
    });
});

describe('assertPathSafe', () => {
    it('throws SkitError(E_INVALID_INPUT) on escape', () => {
        expect(() => assertPathSafe('/base', '/base/../etc')).toThrow(SkitError);
        try {
            assertPathSafe('/base', '/other/foo');
        } catch (e) {
            expect((e as SkitError).code).toBe('E_INVALID_INPUT');
        }
    });

    it('does not throw on safe path', () => {
        expect(() => assertPathSafe(path.resolve('/base'), path.resolve('/base/foo'))).not.toThrow();
    });
});