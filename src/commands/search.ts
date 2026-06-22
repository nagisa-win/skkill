import { searchSkill } from '../lib/searcher.js';
import { logger } from '../utils/logger.js';
import type { BackendId } from '../types/backend.js';

export async function searchCommand(query: string, opts: { limit?: number; backend?: string } = {}): Promise<void> {
    const spinner = logger.spinner(`Searching "${query}"…`).start();
    const backend = (opts.backend as BackendId | undefined) ?? undefined;
    const results = await searchSkill(query, { limit: opts.limit, backend });
    spinner.stop();

    if (results.length === 0) {
        logger.info(`No results for "${query}"`);
        return;
    }

    const onetoolCount = results.filter(r => r.source === 'onetool').length;
    const githubCount = results.filter(r => r.source === 'github').length;
    const headerParts: string[] = [];
    if (onetoolCount) headerParts.push(`onetool(${onetoolCount})`);
    if (githubCount) headerParts.push(`github(${githubCount})`);
    console.log(`\nFound ${results.length} result(s) [${headerParts.join(' + ') || 'unknown'}]:\n`);
    for (const r of results) {
        const tag = r.source === 'onetool' ? '★ onetool' : r.source === 'github' ? '☆ github' : '';
        console.log(`  ${r.name}  ${tag}`);
        console.log(`    ${r.description}`);
        console.log(`    ${r.url}\n`);
    }
}
