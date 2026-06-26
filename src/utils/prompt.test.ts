import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('inquirer', () => ({
    default: {
        prompt: vi.fn(),
    },
}));

import inquirer from 'inquirer';
import { pickMany, pickOne, confirm } from './prompt.js';

const mockedPrompt = vi.mocked(inquirer.prompt);

describe('prompt utilities — cancel handling', () => {
    beforeEach(() => {
        mockedPrompt.mockReset();
    });

    it('pickMany returns null when user force-closes', async () => {
        const cancelErr = new Error('User force closed the prompt');
        mockedPrompt.mockRejectedValueOnce(cancelErr);
        const out = await pickMany('x', ['a', 'b']);
        expect(out).toBeNull();
    });

    it('pickMany throws on non-cancel error', async () => {
        mockedPrompt.mockRejectedValueOnce(new Error('TTY error'));
        await expect(pickMany('x', ['a'])).rejects.toThrow('TTY error');
    });

    it('pickMany supports numeric values', async () => {
        mockedPrompt.mockResolvedValueOnce({ selected: [2, 3] } as never);
        const out = await pickMany('x', [1, 2, 3]);
        expect(out).toEqual([2, 3]);
    });

    it('pickMany returns [] when options empty', async () => {
        const out = await pickMany('x', []);
        expect(out).toEqual([]);
        expect(mockedPrompt).not.toHaveBeenCalled();
    });

    it('pickOne returns null on cancel', async () => {
        mockedPrompt.mockRejectedValueOnce(new Error('Prompt was canceled'));
        const out = await pickOne('x', ['a']);
        expect(out).toBeNull();
    });

    it('confirm returns null on cancel', async () => {
        mockedPrompt.mockRejectedValueOnce(new Error('User force closed the prompt'));
        expect(await confirm('x')).toBeNull();
    });
});
