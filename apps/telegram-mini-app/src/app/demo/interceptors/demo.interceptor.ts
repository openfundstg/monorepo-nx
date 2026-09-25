import {
  HttpErrorResponse,
  HttpResponse,
  HttpStatusCode,
  type HttpInterceptorFn
} from '@angular/common/http'
import { inject } from '@angular/core'
import { map, mergeMap, throwError, timer } from 'rxjs'
import { environment } from '../../../environments/environment'
import { DemoAnswerKind } from '../enums/demo-answer-kind.enum'
import { DemoModeService } from '../services/demo-mode.service'

/**
 * Answers a demo account's API requests on the device.
 *
 * Last in the chain, so a request answered here has still been through the
 * other two: it carries its credential like any other, and it raises the
 * loading overlay like any other if it takes long enough to deserve one.
 *
 * For everybody who is not a demo account this does nothing at all — the pack
 * is absent, and every request goes on as it always has.
 */
export const demoInterceptor: HttpInterceptorFn = (req, next) => {
  const demo = inject(DemoModeService)
  if (!demo.active() || !req.url.startsWith(environment.apiUrl)) return next(req)

  const answer = demo.answer({
    method: req.method,
    path: req.url.slice(environment.apiUrl.length),
    body: req.body
  })

  switch (answer.kind) {
    case DemoAnswerKind.NETWORK:
      return next(req)
    case DemoAnswerKind.RESPOND:
      return timer(answer.latencyMs).pipe(
        map(
          () =>
            new HttpResponse({
              status: HttpStatusCode.Ok,
              url: req.url,
              body: detached(answer.body)
            })
        )
      )
    case DemoAnswerKind.REFUSE:
      return timer(answer.latencyMs).pipe(
        mergeMap(() =>
          throwError(
            () =>
              new HttpErrorResponse({ status: answer.status, url: req.url, error: answer.error })
          )
        )
      )
  }
}

/**
 * A copy the screen may do anything with.
 *
 * The pack sits in the store, which freezes what it holds, and a screen that
 * edits the body it was handed — as it may with one from the network — would
 * throw on a frozen one. Everything in the pack is JSON already.
 */
const detached = (body: unknown): unknown =>
  body === undefined ? null : (JSON.parse(JSON.stringify(body)) as unknown)
