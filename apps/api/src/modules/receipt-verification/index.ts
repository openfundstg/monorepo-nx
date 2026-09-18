export * from './receipt-verification.module'
export * from './enums'
export * from './interfaces'
// The two facades, and nothing under them. Which service holds the browser,
// which words a verifier uses for a bank, how a signed PDF is unwrapped — all
// of that is this module's business, and a consumer reaching past a facade for
// one of them is the coupling the facades exist to prevent.
export {
  ReceiptVerificationFacadeService,
  StatementVerificationFacadeService
} from './services'
