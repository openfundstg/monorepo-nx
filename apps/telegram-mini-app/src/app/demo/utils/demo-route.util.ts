import type { DemoRoute, DemoRouteMatch } from '../interfaces/demo-route.interface'

/** What marks a path segment that varies — `/sales/:id`. */
const PARAM_PREFIX = ':'

/** A route with its path already cut into segments. */
interface Candidate {
  readonly route: DemoRoute
  readonly pattern: readonly string[]
}

const segmentsOf = (path: string): readonly string[] => path.split('/').filter(Boolean)

const isParam = (segment: string): boolean => segment.startsWith(PARAM_PREFIX)

/**
 * The route a request is for, or `null` when it is for none of them.
 *
 * **A literal segment outranks a parameter.** `/sales/config` also fits
 * `/sales/:id`, and reading it as the sale called "config" would answer the
 * sale form with a missing order. So of the routes that fit, the one with the
 * fewest parameters wins.
 */
export const matchDemoRoute = (
  routes: readonly DemoRoute[],
  method: string,
  path: string
): DemoRouteMatch | null => {
  const actual = segmentsOf(path)

  const best = routes
    .filter((route) => route.method === method)
    .map((route): Candidate => ({ route, pattern: segmentsOf(route.path) }))
    .filter(
      ({ pattern }) =>
        pattern.length === actual.length &&
        pattern.every((segment, index) => isParam(segment) || segment === actual[index])
    )
    .reduce<Candidate | undefined>(
      (chosen, candidate) =>
        chosen === undefined || paramCount(candidate.pattern) < paramCount(chosen.pattern)
          ? candidate
          : chosen,
      undefined
    )

  if (best === undefined) return null

  return {
    endpoint: best.route.endpoint,
    params: Object.fromEntries(
      best.pattern.flatMap((segment, index) =>
        isParam(segment)
          ? [[segment.slice(PARAM_PREFIX.length), decodeURIComponent(actual[index])]]
          : []
      )
    )
  }
}

const paramCount = (pattern: readonly string[]): number => pattern.filter(isParam).length
