import { createReducer, on } from '@ngrx/store'
import { ratesActions } from './rates.actions'
import { initialRatesState } from './rates.state'

export const ratesReducer = createReducer(
  initialRatesState,
  on(ratesActions.loadSuccess, (state, { rates }) => ({
    ...state,
    buy: rates.buy,
    sell: rates.sell
  }))
)
