import { describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const prepared = { ownerAction: { action: 4 }, payload: '0x01', digest: `0x${'ab'.repeat(32)}` };
const api = vi.fn(async () => prepared);
const signAndSubmit = vi.fn(async () => ({ success: true, txHash: null }));
vi.mock('../lib/api.js', () => ({ api: (...a: unknown[]) => api(...(a as [])) }));
vi.mock('../lib/passkey.js', () => ({ assertDigest: vi.fn(), signAndSubmit: (...a: unknown[]) => signAndSubmit(...(a as [])) }));

const { Settings } = await import('./Settings.js');

describe('Settings: unlink WeChat (UNLINK_WECHAT, owner alone)', () => {
  it('prepares the owner action, signs it with the passkey and says when Base applied it', async () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'settings.unlink' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('WeChat unlinked on Base.'));
    expect(api).toHaveBeenCalledWith('POST', '/owner-actions/prepare', { kind: 4 });
    expect(signAndSubmit).toHaveBeenCalledWith(prepared);
    cleanup();
  });
});
