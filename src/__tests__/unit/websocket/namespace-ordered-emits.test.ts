import { NamespaceBaseService } from '../../../services/websocket/namespace-base.service';

describe('NamespaceBaseService — ordered emits', () => {
  it('emits to room in order when WS_ORDERED_EMITS is enabled', async () => {
    process.env.WS_ORDERED_EMITS = '1';
    const events: Array<{ event: string; data: any }> = [];

    const fakeNamespace: any = {
      adapter: { rooms: new Map<string, Set<string>>() },
      use: (_fn: any) => {},
      on: (_name: string, _fn: any) => {},
      to: (_room: string) => ({
        emit: (event: string, data: any) => events.push({ event, data })
      })
    };

    class TestService extends NamespaceBaseService {
      protected getNamespaceName(): string { return '/test'; }
      protected onConnection(): void {}
      protected onDisconnection(): void {}
      protected onUserFullyDisconnected(): void {}
      protected onError(): void {}
      public emit(room: string, ev: string, data: any) { return (this as any).emitToRoom(room, ev, data); }
    }

    const svc = new TestService(fakeNamespace);
    // Rapid-fire emits
    svc.emit('room:1', 'e1', { i: 1 });
    svc.emit('room:1', 'e2', { i: 2 });
    svc.emit('room:1', 'e3', { i: 3 });

    await new Promise((r) => setTimeout(r, 10));

    expect(events.map(e => e.event)).toEqual(['e1', 'e2', 'e3']);
  });
});

