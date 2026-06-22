import chalk from 'chalk';
import ora, { type Ora } from 'ora';

export const logger = {
    info(msg: string): void {
        console.log(chalk.cyan('ℹ'), msg);
    },
    success(msg: string): void {
        console.log(chalk.green('✔'), msg);
    },
    warn(msg: string): void {
        console.log(chalk.yellow('⚠'), msg);
    },
    error(msg: string): void {
        console.error(chalk.red('✖'), msg);
    },
    step(msg: string): void {
        console.log(chalk.blue('→'), msg);
    },
    spinner(text: string): Ora {
        return ora(text);
    },
};

// SkitError:统一错误类型,带 code 字段便于上层判断
export type SkitErrorCode =
    | 'E_NOT_INSTALLED'
    | 'E_GIT_AUTH'
    | 'E_NOT_SYMLINK'
    | 'E_BACKEND_UNAVAILABLE'
    | 'E_INVALID_SKILL'
    | 'E_LLM_API_KEY_MISSING'
    | 'E_LLM_INVALID_OUTPUT'
    | 'E_ALREADY_INSTALLED'
    | 'E_AGENT_UNKNOWN'
    | 'E_CONFIG_INVALID'
    | 'E_INVALID_INPUT';

export class SkitError extends Error {
    readonly code: SkitErrorCode;
    constructor(code: SkitErrorCode, message: string) {
        super(message);
        this.name = 'SkitError';
        this.code = code;
    }
}
