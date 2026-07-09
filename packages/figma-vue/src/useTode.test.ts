import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send = vi.fn();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  simulateUnexpectedClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

vi.mock('@tode-sdk/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tode-sdk/core')>();
  return {
    ...actual,
    tode: {
      isReady: true,
      getWebSocketConfig: () => ({ url: 'wss://example.test', params: { api_key: 'k' } }),
      updateFromConfig: vi.fn(),
      trackAction: vi.fn(),
      trackActionWithMetric: vi.fn(),
    },
  };
});

const { useTode } = await import('./useTode.js');

function mountWithTode() {
  const TestComponent = defineComponent({
    setup() {
      const result = useTode();
      return () => h('div');
    },
  });
  return mount(TestComponent);
}

describe('useTode WebSocket reconnection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('automatically reconnects after an unexpected WebSocket close', () => {
    mountWithTode();

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateOpen();
    FakeWebSocket.instances[0].simulateUnexpectedClose();

    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('stops reconnecting once the component unmounts', () => {
    const wrapper = mountWithTode();

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateUnexpectedClose();

    wrapper.unmount();

    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
