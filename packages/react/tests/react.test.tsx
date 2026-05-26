import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';

// Mock the underlying widget so we can assert on the imperative calls the
// React bindings make, without booting the real DOM widget.
vi.mock('@pocketping/widget', () => ({
  init: vi.fn(),
  destroy: vi.fn(),
  identify: vi.fn(() => Promise.resolve()),
  reset: vi.fn(() => Promise.resolve()),
  open: vi.fn(),
  close: vi.fn(),
  toggle: vi.fn(),
  trigger: vi.fn(),
  sendMessage: vi.fn(() => Promise.resolve()),
  getIdentity: vi.fn(() => null),
  onEvent: vi.fn(() => () => {}),
  offEvent: vi.fn(),
}));

import { init, destroy, identify, reset } from '@pocketping/widget';
import { PocketPingProvider, usePocketPing } from '../src';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PocketPingProvider', () => {
  it('boots the widget once on mount with the given config', () => {
    render(<PocketPingProvider projectId="proj_test" operatorName="Acme" />);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj_test', operatorName: 'Acme' }),
    );
    // Anonymous mount: init() already started the session, so we must neither
    // identify nor reset (resetting would churn the fresh connection).
    expect(identify).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('re-identifies when user fields change for the same id', () => {
    const { rerender } = render(
      <PocketPingProvider projectId="proj_test" user={{ id: 'u_1', name: 'Ada' }} />,
    );
    expect(identify).toHaveBeenCalledTimes(1);

    // Same id, changed profile field → must re-identify (P2).
    rerender(
      <PocketPingProvider projectId="proj_test" user={{ id: 'u_1', name: 'Ada Lovelace' }} />,
    );
    expect(identify).toHaveBeenCalledTimes(2);
    expect(identify).toHaveBeenLastCalledWith({ id: 'u_1', name: 'Ada Lovelace' });
  });

  it('renders its children', () => {
    render(
      <PocketPingProvider projectId="proj_test">
        <span>hello</span>
      </PocketPingProvider>,
    );
    expect(screen.getByText('hello')).toBeDefined();
  });

  it('identifies the user when one is provided', () => {
    const user = { id: 'u_1', email: 'a@b.co', name: 'Ada' };
    render(<PocketPingProvider projectId="proj_test" user={user} />);
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith(user);
    expect(reset).not.toHaveBeenCalled();
  });

  it('re-identifies when the user id changes and resets on logout', () => {
    const { rerender } = render(
      <PocketPingProvider projectId="proj_test" user={{ id: 'u_1', email: 'a@b.co' }} />,
    );
    expect(identify).toHaveBeenCalledTimes(1);

    rerender(
      <PocketPingProvider projectId="proj_test" user={{ id: 'u_2', email: 'c@d.co' }} />,
    );
    expect(identify).toHaveBeenCalledTimes(2);

    // Logout → user becomes null → fresh anonymous session.
    rerender(<PocketPingProvider projectId="proj_test" user={null} />);
    expect(reset).toHaveBeenCalledWith({ newSession: true });
  });

  it('tears the widget down on unmount', () => {
    const { unmount } = render(<PocketPingProvider projectId="proj_test" />);
    expect(destroy).not.toHaveBeenCalled();
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('usePocketPing', () => {
  it('exposes the imperative controls', () => {
    const { result } = renderHook(() => usePocketPing());
    expect(typeof result.current.open).toBe('function');
    expect(typeof result.current.close).toBe('function');
    expect(typeof result.current.toggle).toBe('function');
    expect(typeof result.current.trigger).toBe('function');
  });

  it('returns a referentially stable object across renders', () => {
    const { result, rerender } = renderHook(() => usePocketPing());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
