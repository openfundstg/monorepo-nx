import type { ApiError } from '@transacto/contracts'
import type { DemoAnswerKind } from '../enums/demo-answer-kind.enum'

/** Send it to the server. */
export interface DemoNetworkAnswer {
  readonly kind: DemoAnswerKind.NETWORK
}

/** Answer it here, after `latencyMs`, with `body`. */
export interface DemoRespondAnswer {
  readonly kind: DemoAnswerKind.RESPOND
  readonly body: unknown
  readonly latencyMs: number
}

/** Answer it here, after `latencyMs`, with the error the server would have sent. */
export interface DemoRefuseAnswer {
  readonly kind: DemoAnswerKind.REFUSE
  readonly status: number
  readonly error: ApiError
  readonly latencyMs: number
}

export type DemoAnswer = DemoNetworkAnswer | DemoRespondAnswer | DemoRefuseAnswer

/** What `DemoModeService` is asked about one request. */
export interface DemoRequest {
  readonly method: string
  /** The path after `environment.apiUrl`. */
  readonly path: string
  readonly body: unknown
}
