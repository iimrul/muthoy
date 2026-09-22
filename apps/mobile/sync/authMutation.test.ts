import { describe, expect, it, vi } from 'vitest';
import { withAuthMutation } from './authMutation';

describe('Supabase credential mutation serialization', () => {
  it('does not let a refresh/set-session overtake an awaited sign-out', async () => {
    let release!: () => void;
    const first = withAuthMutation(() => new Promise<string>((resolve) => {
      release = () => resolve('signed-out');
    }));
    const incoming = vi.fn(async () => 'new-session');
    const second = withAuthMutation(incoming);

    await Promise.resolve();
    expect(incoming).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toBe('signed-out');
    await expect(second).resolves.toBe('new-session');
    expect(incoming).toHaveBeenCalledOnce();
  });
});
