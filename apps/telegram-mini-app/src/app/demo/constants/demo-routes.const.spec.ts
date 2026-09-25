/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { DEMO_ROUTES } from './demo-routes.const'
import { matchDemoRoute } from '../utils/demo-route.util'

/**
 * Every api service's source, pulled in by the bundler — these specs run in a
 * browser environment, where there is no filesystem to read.
 */
const SOURCES = import.meta.glob('../../**/*.api.service.ts', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** `base` as a service declares it: a field, or a getter, over `environment.apiUrl`. */
const BASE = /base(?:\(\): string \{\s*return|\s*=)\s*`\$\{environment\.apiUrl\}([^`]*)`/

/** Every `this.http.<method><…>(url` a service makes. */
const CALL = /this\.http\.(get|post|put|patch|delete)\s*(?:<[\s\S]*?>)?\(\s*(`[^`]*`|this\.base)/g

interface ApiCall {
  readonly method: string
  readonly path: string
}

/** The calls in one service, with every varying segment written `:param`. */
const callsIn = (source: string): readonly ApiCall[] => {
  const base = BASE.exec(source)?.[1] ?? ''

  return [...source.matchAll(CALL)].map(([, method, url]) => ({
    method: method.toUpperCase(),
    path:
      url === 'this.base'
        ? base
        : url
            .slice(1, -1)
            .replace('${this.base}', base)
            .replace('${environment.apiUrl}', '')
            .replace(/\$\{[^}]+\}/g, ':param')
  }))
}

const CALLS = Object.values(SOURCES).flatMap(callsIn)

/** A path with every parameter spelled alike, so a route and a call compare. */
const shapeOf = (path: string): string => path.replace(/:[^/]+/g, ':param')

/**
 * The demo refuses whatever it was not told about, which is safe and silent:
 * a screen added tomorrow would show a demo account an error in the middle of
 * a recording, and nothing would fail. So this fails instead — every endpoint
 * an api service calls must be in `DEMO_ROUTES`, which makes adding one a
 * decision about what a demo account sees there.
 */
describe('the demo route table', () => {
  it('finds the api services and their calls at all', () => {
    // Were this to read zero, both checks below would pass by vacuum.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(5)
    expect(CALLS.length).toBeGreaterThan(30)
  })

  it.each(CALLS.map((call) => [`${call.method} ${call.path}`]))(
    'says what a demo account does with %s',
    (label) => {
      const [method, path] = label.split(' ')

      expect(matchDemoRoute(DEMO_ROUTES, method, path)).not.toBeNull()
    }
  )

  it('lists nothing no service calls', () => {
    const stale = DEMO_ROUTES.filter(
      (route) =>
        !CALLS.some(
          (call) => call.method === route.method && shapeOf(call.path) === shapeOf(route.path)
        )
    ).map((route) => `${route.method} ${route.path}`)

    expect(stale).toEqual([])
  })

  it('lists each endpoint once', () => {
    const keys = DEMO_ROUTES.map((route) => `${route.method} ${shapeOf(route.path)}`)

    expect(new Set(keys).size).toBe(keys.length)
  })
})
