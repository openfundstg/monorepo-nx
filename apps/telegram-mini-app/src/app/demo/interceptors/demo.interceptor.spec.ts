import { TestBed } from '@angular/core/testing'
import {
  HttpClient,
  HttpErrorResponse,
  HttpStatusCode,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideZonelessChangeDetection, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR } from '@transacto/contracts'
import { environment } from '../../../environments/environment'
import { DemoAnswerKind } from '../enums/demo-answer-kind.enum'
import type { DemoAnswer } from '../interfaces/demo-answer.interface'
import { DemoModeService } from '../services/demo-mode.service'
import { demoInterceptor } from './demo.interceptor'

/**
 * The transport half: whatever the service decides, the screen must receive
 * it exactly as it would have received the server's answer — and a request
 * answered here must never also reach the network.
 */
describe('demoInterceptor', () => {
  const active = signal(true)
  const answer = vi.fn<(request: { method: string; path: string }) => DemoAnswer>()
  let http: HttpClient
  let backend: HttpTestingController

  beforeEach(() => {
    active.set(true)
    answer.mockReset()

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([demoInterceptor])),
        provideHttpClientTesting(),
        { provide: DemoModeService, useValue: { active, answer } }
      ]
    })

    http = TestBed.inject(HttpClient)
    backend = TestBed.inject(HttpTestingController)
  })

  afterEach(() => backend.verify())

  it('answers from the pack, and the request never leaves the phone', async () => {
    const body = { history: [] }
    answer.mockReturnValue({ kind: DemoAnswerKind.RESPOND, body, latencyMs: 0 })

    const received = await firstValueFrom(http.get(`${environment.apiUrl}/user/balance-history`))

    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/user/balance-history' })
    )
    expect(received).toEqual(body)
    // A copy, so a screen may change what it was given without touching the store.
    expect(received).not.toBe(body)
    backend.expectNone(`${environment.apiUrl}/user/balance-history`)
  })

  it('refuses with the error the server would have sent', async () => {
    answer.mockReturnValue({
      kind: DemoAnswerKind.REFUSE,
      status: HttpStatusCode.Forbidden,
      error: ERROR.TMA_DEMO.READ_ONLY,
      latencyMs: 0
    })

    const failure = await firstValueFrom(
      http.post(`${environment.apiUrl}/referral/transfer`, { amount: 100 })
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(HttpErrorResponse)
    expect((failure as HttpErrorResponse).status).toBe(HttpStatusCode.Forbidden)
    expect((failure as HttpErrorResponse).error).toEqual(ERROR.TMA_DEMO.READ_ONLY)
  })

  it('lets through what the demo sends to the server', () => {
    answer.mockReturnValue({ kind: DemoAnswerKind.NETWORK })

    http.post(`${environment.apiUrl}/auth`, {}).subscribe()

    backend.expectOne(`${environment.apiUrl}/auth`).flush({})
  })

  it('does nothing at all for an account that is not a demo', () => {
    active.set(false)

    http.get(`${environment.apiUrl}/user/profile`).subscribe()

    backend.expectOne(`${environment.apiUrl}/user/profile`).flush({})
    expect(answer).not.toHaveBeenCalled()
  })

  it('leaves alone anything that is not the API — the dictionaries, for one', () => {
    http.get('./assets/i18n/uk.json').subscribe()

    backend.expectOne('./assets/i18n/uk.json').flush({})
    expect(answer).not.toHaveBeenCalled()
  })
})
