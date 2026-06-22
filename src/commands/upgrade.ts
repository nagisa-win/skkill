import { loadConfig } from '../lib/config.js';
import { upgradeSkill } from '../lib/installer.js';
import { logger } from '../utils/logger.js';

export async function upgradeCommand(name: string): Promise<void> {
    const config = await loadConfig();
    const spinner = logger.spinner(`Upgrading ${name}…`).start();
    const { from, to } = await upgradeSkill(name, config);
    spinner.succeed(`Upgraded ${name}: ${from} → ${to}`);
}
