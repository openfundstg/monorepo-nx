import type { DemoEndpoint } from '../enums/demo-endpoint.enum'
import type { DemoHttpMethod } from '../enums/demo-http-method.enum'

/** One endpoint the Mini App calls, and what a demo account does with it. */
export interface DemoRoute {
  readonly method: DemoHttpMethod
  /** The path after `environment.apiUrl`; `:name` marks a segment that varies. */
  readonly path: string
  readonly endpoint: DemoEndpoint
}

/** A request matched to its route, with the varying segments read out. */
export interface DemoRouteMatch {
  readonly endpoint: DemoEndpoint
  readonly params: Readonly<Record<string, string>>
}
