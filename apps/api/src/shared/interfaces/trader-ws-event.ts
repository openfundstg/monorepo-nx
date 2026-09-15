import { WsEventNames } from '@transacto/contracts'

export { WsEventNames }

/**
 * Internal envelope passed through EventEmitter2 on the `ws.emit` channel and
 * unwrapped by ExtensionWsEmitterService, which routes `data` to the trader's
 * socket room.
 *
 * Lives in `shared` rather than a feature module because repositories emit it
 * too, and a repository must never depend on a domain module.
 */
export class TraderWsEvent<T> {
  constructor(
    public readonly traderId: number,
    public readonly event: WsEventNames,
    public readonly data: T
  ) {}
}
