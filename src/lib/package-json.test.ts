import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writePackageJson, readPackageJson, syncVersionFromMeta } from './package-json.js';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skkill-pkg-test-'));
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('syncVersionFromMeta', () => {
    it('syncs package.json version from .skill-meta.json', async () => {
        await writePackageJson(tmpDir, { name: 'foo', version: '0.1.0', description: '' });
        await fs.writeFile(
            path.join(tmpDir, '.skill-meta.json'),
            JSON.stringify({ version: '2.10.0' })
        );
        const synced = await syncVersionFromMeta(tmpDir);
        expect(synced).toBe('2.10.0');
        expect((await readPackageJson(tmpDir))?.version).toBe('2.10.0');
    });

    it('strips leading v from meta version', async () => {
        await writePackageJson(tmpDir, { name: 'foo', version: '0.1.0', description: '' });
        await fs.writeFile(path.join(tmpDir, '.skill-meta.json'), JSON.stringify({ version: 'v1.2.3' }));
        const synced = await syncVersionFromMeta(tmpDir);
        expect(synced).toBe('1.2.3');
        expect((await readPackageJson(tmpDir))?.version).toBe('1.2.3');
    });

    it('returns null and leaves pkg untouched when meta missing', async () => {
        await writePackageJson(tmpDir, { name: 'foo', version: '0.1.0', description: '' });
        const synced = await syncVersionFromMeta(tmpDir);
        expect(synced).toBeNull();
        expect((await readPackageJson(tmpDir))?.version).toBe('0.1.0');
    });

    it('returns null when meta has no version field', async () => {
        await writePackageJson(tmpDir, { name: 'foo', version: '0.1.0', description: '' });
        await fs.writeFile(path.join(tmpDir, '.skill-meta.json'), JSON.stringify({ skill_id: 1 }));
        const synced = await syncVersionFromMeta(tmpDir);
        expect(synced).toBeNull();
        expect((await readPackageJson(tmpDir))?.version).toBe('0.1.0');
    });

    it('rejects non-semver version string', async () => {
        await writePackageJson(tmpDir, { name: 'foo', version: '0.1.0', description: '' });
        await fs.writeFile(path.join(tmpDir, '.skill-meta.json'), JSON.stringify({ version: 'latest' }));
        const synced = await syncVersionFromMeta(tmpDir);
        expect(synced).toBeNull();
        expect((await readPackageJson(tmpDir))?.version).toBe('0.1.0');
    });

    it('is a no-op when package.json version already matches', async () => {
        await writePackageJson(tmpDir, { name: 'foo', version: '2.10.0', description: '' });
        await fs.writeFile(path.join(tmpDir, '.skill-meta.json'), JSON.stringify({ version: '2.10.0' }));
        const synced = await syncVersionFromMeta(tmpDir);
        expect(synced).toBe('2.10.0');
        expect((await readPackageJson(tmpDir))?.version).toBe('2.10.0');
    });

    it('does not throw when package.json missing', async () => {
        await fs.writeFile(path.join(tmpDir, '.skill-meta.json'), JSON.stringify({ version: '2.10.0' }));
        await expect(syncVersionFromMeta(tmpDir)).resolves.toBeNull();
    });

    it('does not throw when .skill-meta.json is malformed', async () => {
        await writePackageJson(tmpDir, { name: 'foo', version: '0.1.0', description: '' });
        await fs.writeFile(path.join(tmpDir, '.skill-meta.json'), '{ not json');
        await expect(syncVersionFromMeta(tmpDir)).resolves.toBeNull();
        expect((await readPackageJson(tmpDir))?.version).toBe('0.1.0');
    });
});
