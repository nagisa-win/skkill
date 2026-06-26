import inquirer from 'inquirer';

// 多选交互 (默认选第一个);用户取消 (Ctrl+C) 时返回 null,让上层决定降级
export async function pickMany<T extends string | number>(
    message: string,
    options: T[],
    defaults: T[] = options.length > 0 ? [options[0]!] : []
): Promise<T[] | null> {
    if (options.length === 0) return [];
    try {
        const { selected } = await inquirer.prompt<{ selected: T[] }>([
            {
                type: 'checkbox',
                name: 'selected',
                message,
                choices: options.map(opt => ({ name: String(opt), value: opt })),
                default: defaults,
            },
        ]);
        return selected;
    } catch (err) {
        if (isUserCancel(err)) return null;
        throw err;
    }
}

// 单选交互;用户取消返回 null
export async function pickOne<T extends string>(message: string, options: T[]): Promise<T | null> {
    if (options.length === 0) return null;
    try {
        const { selected } = await inquirer.prompt<{ selected: T }>([
            {
                type: 'list',
                name: 'selected',
                message,
                choices: options,
            },
        ]);
        return selected;
    } catch (err) {
        if (isUserCancel(err)) return null;
        throw err;
    }
}

// 确认 (y/n);用户取消返回 null
export async function confirm(message: string, defaultValue = false): Promise<boolean | null> {
    try {
        const { ok } = await inquirer.prompt<{ ok: boolean }>([
            { type: 'confirm', name: 'ok', message, default: defaultValue },
        ]);
        return ok;
    } catch (err) {
        if (isUserCancel(err)) return null;
        throw err;
    }
}

function isUserCancel(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const msg = (err as { message?: unknown }).message;
    return typeof msg === 'string' && /canceled|cancelled|User force closed/i.test(msg);
}
