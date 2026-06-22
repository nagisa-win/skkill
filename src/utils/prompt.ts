import inquirer from 'inquirer';

// 多选交互 (默认选第一个)
export async function pickMany<T extends string>(
    message: string,
    options: T[],
    defaults: T[] = [options[0]!]
): Promise<T[]> {
    if (options.length === 0) return [];
    const { selected } = await inquirer.prompt<{ selected: T[] }>([
        {
            type: 'checkbox',
            name: 'selected',
            message,
            choices: options.map(opt => ({ name: opt, value: opt })),
            default: defaults,
        },
    ]);
    return selected;
}

// 单选交互
export async function pickOne<T extends string>(message: string, options: T[]): Promise<T> {
    const { selected } = await inquirer.prompt<{ selected: T }>([
        {
            type: 'list',
            name: 'selected',
            message,
            choices: options,
        },
    ]);
    return selected;
}

// 确认 (y/n)
export async function confirm(message: string, defaultValue = false): Promise<boolean> {
    const { ok } = await inquirer.prompt<{ ok: boolean }>([
        { type: 'confirm', name: 'ok', message, default: defaultValue },
    ]);
    return ok;
}
