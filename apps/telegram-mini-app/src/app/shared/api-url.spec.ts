/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { environment } from '../../environments/environment'

/**
 * Every api service builds its URL the same way, and one did not.
 *
 * `environment.apiUrl` already ends in `/api/tma`, so a service appends only its
 * own resource. Repeating the prefix produces `/api/tma/tma/…`, which compiles,
 * type-checks, passes every other test and answers `404` at runtime — the sort
 * of mistake that stays invisible until somebody opens the screen.
 *
 * A structural test rather than a review habit, for the reason `i18n.spec.ts` is
 * one: the rule is mechanical, and there is no reason a person should be the
 * thing enforcing it.
 *
 * The sources are pulled in by the bundler rather than read off disk — these
 * specs run in a browser environment, where there is no filesystem to read.
 */
const SOURCES = import.meta.glob('../**/*.api.service.ts', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** What a service must never write after the base URL. */
const DOUBLED_PREFIX = /apiUrl\}\/tma\//

describe('api services', () => {
  const paths = Object.keys(SOURCES)

  it('there are some to check', () => {
    expect(paths.length).toBeGreaterThan(3)
  })

  it('the base URL already carries the prefix', () => {
    expect(environment.apiUrl).toMatch(/\/tma$/)
  })

  it.each(paths)('%s does not repeat it', (path) => {
    expect(SOURCES[path]).not.toMatch(DOUBLED_PREFIX)
  })
})
