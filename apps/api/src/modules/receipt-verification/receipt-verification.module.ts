import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import {
  RECEIPT_CODE_STRATEGIES,
  RECEIPT_VERIFICATION_PROVIDERS
} from 'src/modules/receipt-verification/receipt-verification.tokens'
import {
  MonobankCaApiService,
  MonobankReceiptStrategy,
  MonobankSignatureAdapterService,
  PrivatbankAdapterService,
  PrivatbankDocumentApiService,
  PrivatbankReceiptStrategy,
  ReceiptCheckerApiService,
  ReceiptVerificationFacadeService
} from 'src/modules/receipt-verification/services'

/**
 * Proving that a receipt is a real payment, and that it is this payout's.
 *
 * **This is the list, and it is the whole of the wiring.** Two banks and two
 * verifiers, and the pairing is decided here rather than anywhere below: the
 * facade iterates what it is handed and knows no bank and no service by name.
 *
 * The two paths look nothing alike, which is the argument for the port rather
 * than against it. Monobank is verified by **monobank's own certification
 * service**, which checks the qualified signature on the file the user
 * uploaded and says nothing whatever about the payment. PrivatBank is verified
 * through **PrivatBank**, which says only that the code exists and leaves its
 * adapter to download the receipt. One proves a document, the other proves a
 * code; neither fact has ever had to reach the facade.
 *
 * **`check.gov.ua` used to be here and is gone.** It was the only thing that
 * needed a browser — its endpoint refuses any request without a reCAPTCHA token
 * minted by its own page — and the browser left the sidecar's image with it.
 * What replaced it is a stronger claim rather than a cheaper one: a lookup
 * confirms that a code names a payment, while a signature check refuses a
 * document altered by a single bit.
 *
 * Providers are asked in order and the first that supports the bank answers, so
 * moving PrivatBank onto some future verifier is a line in the array below.
 *
 * Only the facade is exported. Everything under it — which service holds the
 * browser, which words a verifier uses for a bank, how a signed PDF is unwrapped
 * — is this module's business, and a consumer reaching past the facade for one
 * of them is the coupling the facade exists to prevent.
 */
@Module({
  imports: [HttpModule],
  providers: [
    ReceiptVerificationFacadeService,
    ReceiptCheckerApiService,
    MonobankCaApiService,
    MonobankSignatureAdapterService,
    PrivatbankAdapterService,
    PrivatbankDocumentApiService,
    MonobankReceiptStrategy,
    PrivatbankReceiptStrategy,
    {
      provide: RECEIPT_CODE_STRATEGIES,
      // One per bank whose receipts this product can read. A bank absent here
      // is a bank whose codes are never recognised, whatever any verifier would
      // have said about them. Order does not encode priority: each pattern is
      // strict enough that no code matches two of them.
      useFactory: (monobank: MonobankReceiptStrategy, privatbank: PrivatbankReceiptStrategy) => [
        monobank,
        privatbank
      ],
      inject: [MonobankReceiptStrategy, PrivatbankReceiptStrategy]
    },
    {
      provide: RECEIPT_VERIFICATION_PROVIDERS,
      // Order *does* matter here: the first provider that supports a bank
      // answers for it, and there is no falling through to a second. Today no
      // two overlap — each claims exactly one bank — so the order is a
      // formality; it stops being one the moment a bank has two verifiers, and
      // that is the day to decide deliberately which of them speaks first.
      useFactory: (
        monobank: MonobankSignatureAdapterService,
        privatbank: PrivatbankAdapterService
      ) => [monobank, privatbank],
      inject: [MonobankSignatureAdapterService, PrivatbankAdapterService]
    }
  ],
  exports: [ReceiptVerificationFacadeService]
})
export class ReceiptVerificationModule {}
