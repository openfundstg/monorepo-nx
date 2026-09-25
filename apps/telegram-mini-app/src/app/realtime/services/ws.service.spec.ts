import { TestBed } from '@angular/core/testing'
import { provideZonelessChangeDetection } from '@angular/core'
import { Store, provideStore } from '@ngrx/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthResponse } from '@transacto/contracts'
import { AUTH_FEATURE } from '../../auth/store/auth.state'
import { authReducer } from '../../auth/store/auth.reducer'
import { authActions } from '../../auth/store/auth.actions'
import { TmaService } from '../../auth/services/tma.service'
import { WsService } from './ws.service'

const { io } = vi.hoisted(() => ({ io: vi.fn() }))

vi.mock('socket.io-client', () => ({ io }))

/**
 * A demo account's figures are invented, and the socket carries real ones: the
 * promoter's own referral paying out would paint a real balance over the
 * invented one mid-recording. So a demo account gets no socket — and its
 * screens, which draw a live indicator, are told they are live.
 */
describe('WsService for a demo account', () => {
  let ws: WsService

  beforeEach(() => {
    io.mockReset()

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideStore({ [AUTH_FEATURE]: authReducer }),
        { provide: TmaService, useValue: { initData: () => 'a-signed-launch' } }
      ]
    })

    TestBed.inject(Store).dispatch(
      authActions.authenticateSuccess({
        session: { isNewUser: false, demo: {} } as unknown as AuthResponse
      })
    )
    ws = TestBed.inject(WsService)
  })

  it('opens no socket', () => {
    ws.connect()

    expect(io).not.toHaveBeenCalled()
  })

  it('reports itself connected, once, however many screens ask', () => {
    ws.connect()
    ws.connect()
    ws.connect()

    expect(ws.connected()).toBe(true)
    expect(ws.connectionEpoch()).toBe(1)
  })
})
