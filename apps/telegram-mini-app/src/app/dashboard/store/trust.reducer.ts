import { createReducer, on } from '@ngrx/store'
import { trustActions } from './trust.actions'
import { initialTrustState } from './trust.state'

export const trustReducer = createReducer(
  initialTrustState,
  on(trustActions.loadLadderSuccess, (state, { levels }) => ({ ...state, levels, loaded: true })),
  on(trustActions.loadLadderFailure, (state) => ({ ...state, loaded: true }))
)
