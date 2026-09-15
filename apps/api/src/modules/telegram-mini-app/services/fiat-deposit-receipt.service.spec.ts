import { BadRequestException, ConflictException } from '@nestjs/common'
import { ERROR, TmaFiatDepositStatus, TmaFiatReceiptRejection } from '@transacto/contracts'
import { Types } from 'mongoose'
import { FiatDepositReceiptService } from './fiat-deposit-receipt.service'
import type { FiatDepositSettlementService } from './fiat-deposit-settlement.service'
import type { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import type { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'
import type { PanelReceiptFile } from 'src/modules/transacto/interfaces'
import {
  ReceiptTextSource,
  ReceiptVerificationOutcome,
  type ReceiptVerificationFacadeService
} from 'src/modules/receipt-verification'
import {
  fiatDepositRecord,
  TEST_AMOUNT_UAH,
  TEST_PAYOUT_ID,
  TEST_TELEGRAM_ID
} from 'src/modules/telegram-mini-app/testing'

const DEPOSIT_ID = new Types.ObjectId()

const pdf = (overrides: Partial<PanelReceiptFile> = {}): PanelReceiptFile => ({
  buffer: Buffer.from('%PDF-1.4'),
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  ...overrides
})

/** The bank's own signed receipt, which is what should reach the panel. */
const officialPdf = (): PanelReceiptFile => ({
  buffer: Buffer.from('%PDF-1.4 the bank document'),
  fileName: '297X351KC1T2BKMB.pdf',
  mimeType: 'application/pdf'
})

/** A verdict the state service would return for a receipt that matches. */
const verified = () => ({
  outcome: ReceiptVerificationOutcome.VERIFIED as const,
  source: ReceiptTextSource.FILE_NAME,
  receipt: {
    bank: 'MONO' as never,
    code: '297X-351K-C1T2-BKMB',
    amountUah: TEST_AMOUNT_UAH,
    paidAt: new Date(),
    currencyCode: 980,
    recipient: 'Ілля К., 440000******5551',
    documentUrl: 'https://api.monobank.ua/bank/receipt/whatever'
  }
})

/** The panel's real reply to a confirmed receipt, trimmed to what is read. */
const confirmedCheck = (totalAmount = 600) => ({
  status: 'ok',
  message: 'Чек успешно добавлен',
  checkData: { parsed_fields: { total_amount: totalAmount }, bank: 'ПУМБ' }
})

describe('FiatDepositReceiptService', () => {
  let panelPayouts: {
    uploadCheck: jest.Mock
    getCheckParseStatus: jest.Mock
    getActiveCheckParse: jest.Mock
    confirmCheck: jest.Mock
  }
  let db: {
    pushReceipt: jest.Mock
    markReceiptParsing: jest.Mock
    markReceiptAccepted: jest.Mock
    markReceiptRejected: jest.Mock
    findById: jest.Mock
  }
  /** The service looks the top-up up itself now; ownership is a shared rule. */
  let owned: ReturnType<typeof fiatDepositRecord>
  let announce: jest.Mock
  let review: jest.Mock
  let verification: {
    isConfigured: boolean
    verify: jest.Mock
    officialDocument: jest.Mock
  }
  let service: FiatDepositReceiptService

  const originalPoll = process.env.TMA_FIAT_PARSE_POLL_MS

  beforeEach(() => {
    // The interval is configuration so a test does not have to wait it out.
    process.env.TMA_FIAT_PARSE_POLL_MS = '0'

    owned = fiatDepositRecord({ _id: DEPOSIT_ID })

    panelPayouts = {
      uploadCheck: jest.fn().mockResolvedValue({ status: 'parsing', job_id: 2242 }),
      getCheckParseStatus: jest.fn().mockResolvedValue({ status: 'preview' }),
      getActiveCheckParse: jest.fn().mockResolvedValue({ status: 'idle' }),
      confirmCheck: jest.fn().mockResolvedValue(confirmedCheck())
    }
    db = {
      pushReceipt: jest.fn().mockResolvedValue(new Types.ObjectId()),
      markReceiptParsing: jest.fn().mockResolvedValue(undefined),
      markReceiptAccepted: jest
        .fn()
        .mockImplementation(async (_id, _receiptId, accepted) =>
          fiatDepositRecord({ status: accepted.status, coveredUah: accepted.amountUah })
        ),
      markReceiptRejected: jest.fn().mockImplementation(async () => fiatDepositRecord()),
      findById: jest.fn().mockImplementation(async () => owned)
    }
    announce = jest.fn()
    // A rejected receipt now ends the top-up in an operator's hands, so the
    // settlement service is asked for that as well as for the announcement.
    review = jest
      .fn()
      .mockImplementation(async () => fiatDepositRecord({ status: TmaFiatDepositStatus.REVIEW }))

    verification = {
      isConfigured: true,
      verify: jest.fn().mockResolvedValue(verified()),
      officialDocument: jest.fn().mockResolvedValue(officialPdf())
    }

    service = new FiatDepositReceiptService(
      db as unknown as TmaFiatDepositDbService,
      panelPayouts as unknown as TransactoPanelPayoutsApiService,
      { announce, review } as unknown as FiatDepositSettlementService,
      verification as unknown as ReceiptVerificationFacadeService
    )
  })

  afterEach(() => {
    if (originalPoll === undefined) delete process.env.TMA_FIAT_PARSE_POLL_MS
    else process.env.TMA_FIAT_PARSE_POLL_MS = originalPoll
  })

  describe('the happy path', () => {
    it('uploads, waits for recognition, and confirms', async () => {
      await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(panelPayouts.uploadCheck).toHaveBeenCalledWith(TEST_PAYOUT_ID, expect.anything())
      expect(panelPayouts.getCheckParseStatus).toHaveBeenCalledWith(TEST_PAYOUT_ID, 2242)
      expect(panelPayouts.confirmCheck).toHaveBeenCalledWith(TEST_PAYOUT_ID)
    })

    /**
     * Transacto's figure, not one read here: the payout settles against what
     * they recognised, and counting our own would let a top-up look covered
     * while they still consider it open.
     */
    it('counts the hryvnia Transacto recognised', async () => {
      panelPayouts.confirmCheck.mockResolvedValue(confirmedCheck(600))

      const deposit = await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(db.markReceiptAccepted).toHaveBeenCalledWith(
        DEPOSIT_ID.toString(),
        expect.anything(),
        expect.objectContaining({ amountUah: 60_000 })
      )
      expect(deposit.coveredUah).toBe(60_000)
    })

    /**
     * The rule the whole design hangs on: an accepted receipt moves coverage,
     * and settlement is Transacto's word — read by the reconciler, never
     * inferred here from arithmetic.
     */
    it('never completes a top-up, however well the receipt covers it', async () => {
      const deposit = await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(deposit.status).toBe(TmaFiatDepositStatus.PARTIALLY_PAID)
      expect(db.markReceiptAccepted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ status: TmaFiatDepositStatus.PARTIALLY_PAID })
      )
    })

    it('stores the job id, so a request that dies can be picked up', async () => {
      await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(db.markReceiptParsing).toHaveBeenCalledWith(
        DEPOSIT_ID.toString(),
        expect.anything(),
        2242
      )
    })

    it('confirms straight away when recognition came back with the upload', async () => {
      panelPayouts.uploadCheck.mockResolvedValue({ status: 'preview' })

      await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(panelPayouts.getCheckParseStatus).not.toHaveBeenCalled()
      expect(panelPayouts.confirmCheck).toHaveBeenCalled()
    })
  })

  describe('what it refuses before spending the user’s data', () => {
    it.each([
      ['a document', pdf({ fileName: 'receipt.docx', mimeType: '' })],
      ['a video', pdf({ fileName: 'clip.mp4', mimeType: 'video/mp4' })]
    ])('refuses %s', async (_case, file) => {
      await expect(service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), file)).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.RECEIPT_UNSUPPORTED_TYPE
      })
      expect(panelPayouts.uploadCheck).not.toHaveBeenCalled()
    })

    /** A phone reports `image/jpg`, or nothing at all, for the same screenshot. */
    it('accepts a screenshot whose type the phone would not name', async () => {
      await expect(
        service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf({ fileName: 'IMG_2043.jpg', mimeType: '' }))
      ).resolves.toBeDefined()
    })

    it('refuses a file past the size limit', async () => {
      const huge = pdf({ buffer: Buffer.alloc(11 * 1024 * 1024) })

      await expect(service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), huge)).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('refuses a top-up that is no longer payable', async () => {
      owned = fiatDepositRecord({ _id: DEPOSIT_ID, status: TmaFiatDepositStatus.EXPIRED })

      await expect(service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.NOT_PAYABLE
      })
    })
  })

  describe('one receipt at a time', () => {
    /**
     * Confirmation is addressed by payout with no job id, so the panel confirms
     * whatever it has parked. Two in flight would attach one file's money under
     * another file's name.
     */
    it('refuses a second upload while this system is waiting on one', async () => {
      owned = fiatDepositRecord({ _id: DEPOSIT_ID, receipts: [{ status: 'PARSING' }] as never })

      await expect(service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())).rejects.toBeInstanceOf(
        ConflictException
      )
    })

    /** Including one left parked by a request that died before confirming. */
    it('refuses when the panel is still holding a parse of its own', async () => {
      panelPayouts.getActiveCheckParse.mockResolvedValue({ status: 'parsing', job_id: 9 })

      await expect(service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.RECEIPT_IN_FLIGHT
      })
    })
  })

  /**
   * The deadline is the deadline. It used to be advisory — the payout outlived
   * it, so a late receipt still landed — and what that bought was receipts for
   * transfers made long after the rate was frozen.
   */
  describe('once the pay window has closed', () => {
    beforeEach(() => {
      owned = fiatDepositRecord({ payDeadlineAt: new Date(Date.now() - 1000) })
      db.findById.mockImplementation(async () => owned)
    })

    it('refuses the upload', async () => {
      await expect(
        service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())
      ).rejects.toMatchObject({ response: ERROR.FIAT_DEPOSIT.PAY_WINDOW_CLOSED })
    })

    /** Its own answer, because it is the one refusal with a way forward. */
    it('says so with its own code, not "no longer payable"', async () => {
      await expect(
        service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())
      ).rejects.not.toMatchObject({ response: ERROR.FIAT_DEPOSIT.NOT_PAYABLE })
    })

    it('spends nothing upstream on a receipt it will not take', async () => {
      await expect(
        service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())
      ).rejects.toBeInstanceOf(ConflictException)

      expect(panelPayouts.uploadCheck).not.toHaveBeenCalled()
      expect(db.pushReceipt).not.toHaveBeenCalled()
    })
  })

  describe('refusals from upstream', () => {
    it('records a rejection when the confirmation is refused', async () => {
      panelPayouts.confirmCheck.mockResolvedValue({ status: 'error', error_message: 'ні' })

      await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(db.markReceiptRejected).toHaveBeenCalledWith(
        DEPOSIT_ID.toString(),
        expect.anything(),
        TmaFiatReceiptRejection.NOT_ACCEPTED
      )
      expect(db.markReceiptAccepted).not.toHaveBeenCalled()
    })

    it('records a failed upload as a recognition failure', async () => {
      panelPayouts.uploadCheck.mockRejectedValue(new Error('ECONNRESET'))

      await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(db.markReceiptRejected).toHaveBeenCalledWith(
        DEPOSIT_ID.toString(),
        expect.anything(),
        TmaFiatReceiptRejection.PARSE_FAILED
      )
    })

    /** An acceptance we cannot read an amount off is not an acceptance. */
    it('refuses to count a receipt with no readable amount', async () => {
      panelPayouts.confirmCheck.mockResolvedValue({ status: 'ok', checkData: { bank: 'ПУМБ' } })

      await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(db.markReceiptAccepted).not.toHaveBeenCalled()
      expect(db.markReceiptRejected).toHaveBeenCalled()
    })

    /**
     * A refused receipt is the end of the top-up, not an invitation to send
     * another: what a user does when told "that one did not work" is transfer
     * again. The payout stays ours because a receipt Transacto would not attach
     * is not evidence that no money moved.
     */
    it('hands a rejected receipt to an operator instead of asking for another', async () => {
      panelPayouts.uploadCheck.mockResolvedValue(null)

      const deposit = await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(db.markReceiptRejected).toHaveBeenCalled()
      expect(review).toHaveBeenCalled()
      expect(deposit.status).toBe(TmaFiatDepositStatus.REVIEW)
    })

    /**
     * Recognition that outlives the request is left alone rather than rejected:
     * the job id is stored and the sweep finishes it, where a rejection would
     * throw away a receipt upstream may yet accept.
     */
    it('leaves a slow recognition for the sweep instead of rejecting it', async () => {
      // The clock is driven by the poll rather than by counting calls: the
      // service reads `Date.now()` for the deadline as well as for the wait,
      // and a fixed sequence of readings breaks the moment it reads one more.
      let now = Date.now()
      jest.spyOn(Date, 'now').mockImplementation(() => now)
      panelPayouts.getCheckParseStatus.mockImplementation(async () => {
        // One poll, and the patience for recognition is spent.
        now += 1_000_000
        return { status: 'parsing' }
      })

      await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(db.markReceiptRejected).not.toHaveBeenCalled()
      expect(db.markReceiptAccepted).not.toHaveBeenCalled()
      jest.restoreAllMocks()
    })
  })
})

/**
 * The check that happens before Transacto is told anything at all.
 *
 * All of these are about one property: **a receipt the state will not vouch for
 * never becomes an upload.** Asking a counterparty to catch a forged receipt for
 * us is the arrangement this replaced, and every test here fails loudly if a
 * refactor puts the upload back in front of the verification.
 */
describe('FiatDepositReceiptService — verification', () => {
  let panelPayouts: { uploadCheck: jest.Mock; getActiveCheckParse: jest.Mock; confirmCheck: jest.Mock; getCheckParseStatus: jest.Mock }
  let db: {
    pushReceipt: jest.Mock
    markReceiptParsing: jest.Mock
    markReceiptAccepted: jest.Mock
    markReceiptRejected: jest.Mock
    findById: jest.Mock
  }
  let verification: { isConfigured: boolean; verify: jest.Mock; officialDocument: jest.Mock }
  let service: FiatDepositReceiptService
  let record: ReturnType<typeof fiatDepositRecord>

  const originalRequired = process.env.RECEIPT_VERIFICATION_REQUIRED

  beforeEach(() => {
    process.env.TMA_FIAT_PARSE_POLL_MS = '0'
    delete process.env.RECEIPT_VERIFICATION_REQUIRED

    record = fiatDepositRecord({ _id: DEPOSIT_ID })
    panelPayouts = {
      uploadCheck: jest.fn().mockResolvedValue({ status: 'preview' }),
      getActiveCheckParse: jest.fn().mockResolvedValue({ status: 'idle' }),
      getCheckParseStatus: jest.fn().mockResolvedValue({ status: 'preview' }),
      confirmCheck: jest.fn().mockResolvedValue(confirmedCheck())
    }
    db = {
      pushReceipt: jest.fn().mockResolvedValue(new Types.ObjectId()),
      markReceiptParsing: jest.fn().mockResolvedValue(undefined),
      markReceiptAccepted: jest.fn().mockImplementation(async () => fiatDepositRecord()),
      markReceiptRejected: jest.fn().mockImplementation(async () => fiatDepositRecord()),
      findById: jest.fn().mockImplementation(async () => record)
    }
    verification = {
      isConfigured: true,
      verify: jest.fn().mockResolvedValue(verified()),
      officialDocument: jest.fn().mockResolvedValue(officialPdf())
    }

    service = new FiatDepositReceiptService(
      db as unknown as TmaFiatDepositDbService,
      panelPayouts as unknown as TransactoPanelPayoutsApiService,
      {
        announce: jest.fn(),
        review: jest
          .fn()
          .mockImplementation(async () =>
            fiatDepositRecord({ status: TmaFiatDepositStatus.REVIEW })
          )
      } as unknown as FiatDepositSettlementService,
      verification as unknown as ReceiptVerificationFacadeService
    )
  })

  afterEach(() => {
    if (originalRequired === undefined) delete process.env.RECEIPT_VERIFICATION_REQUIRED
    else process.env.RECEIPT_VERIFICATION_REQUIRED = originalRequired
  })

  /**
   * The heart of it. The user's file is evidence that somebody holds a receipt;
   * a screenshot is whatever an image editor made it. What settles a payout is
   * the document the *bank* publishes for a code the state has vouched for.
   */
  it("sends the bank's own document, not the file the user uploaded", async () => {
    await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf({ fileName: 'photo.png' }))

    expect(panelPayouts.uploadCheck).toHaveBeenCalledWith(
      TEST_PAYOUT_ID,
      expect.objectContaining({ fileName: '297X351KC1T2BKMB.pdf' })
    )
  })

  /**
   * A verified code whose document cannot be fetched is still a proven payment.
   * The bank being unreachable is not evidence against the person who paid.
   */
  it("falls back to the user's file when the bank document cannot be fetched", async () => {
    verification.officialDocument.mockResolvedValue(null)

    await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf({ fileName: 'mine.pdf' }))

    expect(panelPayouts.uploadCheck).toHaveBeenCalledWith(
      TEST_PAYOUT_ID,
      expect.objectContaining({ fileName: 'mine.pdf' })
    )
  })

  it('asks about the outstanding amount, not the payout total', async () => {
    record = fiatDepositRecord({ _id: DEPOSIT_ID, coveredUah: 20_000 })

    await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

    expect(verification.verify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amountUah: TEST_AMOUNT_UAH - 20_000 }),
      // The correlation label. One receipt's progress crosses four services, and
      // every line about it carries the top-up's id so a busy log stays followable.
      expect.stringContaining(DEPOSIT_ID.toString())
    )
  })

  /**
   * The window opens at the reservation with no grace before it: a transfer
   * dated earlier is an older payment being presented for a payout that did not
   * exist when it was made.
   */
  it('opens the window at the reservation and closes it at the deadline', async () => {
    await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

    expect(verification.verify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        paidNotBefore: record.createdAt,
        paidNotAfter: record.payDeadlineAt,
        recipientCard: record.recipientCard
      }),
      expect.stringContaining(DEPOSIT_ID.toString())
    )
  })

  it.each([
    [ReceiptVerificationOutcome.NOT_REGISTERED, TmaFiatReceiptRejection.UNVERIFIED],
    [ReceiptVerificationOutcome.MISMATCHED, TmaFiatReceiptRejection.MISMATCHED],
    [ReceiptVerificationOutcome.UNAVAILABLE, TmaFiatReceiptRejection.VERIFIER_UNAVAILABLE]
  ])('records %s as %s and sends nothing upstream', async (outcome, rejection) => {
    verification.verify.mockResolvedValue({ outcome, reasons: [], reason: 'because' })

    await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

    expect(panelPayouts.uploadCheck).not.toHaveBeenCalled()
    expect(db.markReceiptRejected).toHaveBeenCalledWith(
      DEPOSIT_ID.toString(),
      expect.anything(),
      rejection
    )
  })

  /**
   * The one verification failure that is the user's to fix, and the reason it is
   * refused *before* a receipt row exists: a file no code can be read out of has
   * not been judged, and recording a refusal would close a top-up whose payout
   * is still perfectly payable.
   */
  it('refuses an unreadable file without spending the top-up', async () => {
    verification.verify.mockResolvedValue({
      outcome: ReceiptVerificationOutcome.CODE_NOT_FOUND
    })

    await expect(
      service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())
    ).rejects.toMatchObject({ response: ERROR.FIAT_DEPOSIT.RECEIPT_CODE_UNREADABLE })

    expect(db.pushReceipt).not.toHaveBeenCalled()
    expect(db.markReceiptRejected).not.toHaveBeenCalled()
    expect(panelPayouts.uploadCheck).not.toHaveBeenCalled()
  })

  /**
   * Fails closed, exactly as the proxy pool does. A check on somebody's money
   * that quietly stops running when its configuration is absent is worse than
   * one that was never claimed.
   */
  it('refuses every receipt when verification is required and unconfigured', async () => {
    process.env.RECEIPT_VERIFICATION_REQUIRED = 'true'
    verification.isConfigured = false

    await expect(
      service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())
    ).rejects.toMatchObject({ response: ERROR.FIAT_DEPOSIT.RECEIPT_VERIFIER_UNAVAILABLE })

    expect(panelPayouts.uploadCheck).not.toHaveBeenCalled()
  })

  /**
   * A user who saves a receipt out of their banking app and uploads it is
   * uploading a PKCS#7 container, not a PDF — `api.monobank.ua` answers
   * `Content-Type: application/pdf` and sends the signed envelope. Both readers
   * of those bytes, the text extractor and Transacto's recognition, see an
   * unreadable file rather than a receipt.
   */
  /**
   * **The envelope is what gets verified, and it used to be thrown away here.**
   * Monobank's check is of the qualified signature over the uploaded bytes, so
   * unwrapping before verification would hand the verifier a document it must
   * refuse — and every genuine receipt would fail. The facade unwraps for
   * reading and keeps the original for the signature; this asserts that the
   * original is what reaches it.
   */
  it('sends the signed container to verification exactly as it arrived', async () => {
    const document = Buffer.from('%PDF-1.4 the document inside\n%%EOF\n')
    const container = Buffer.concat([
      Buffer.from([0x30, 0x81, document.length + 2, 0x04, document.length]),
      document
    ])

    await service.submit(
      TEST_TELEGRAM_ID,
      DEPOSIT_ID.toString(),
      pdf({ buffer: container, fileName: 'signed.pdf' })
    )

    expect(verification.verify).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: container }),
      expect.anything(),
      expect.stringContaining(DEPOSIT_ID.toString())
    )
  })

  /**
   * The one weakened path, and the reason it exists.
   *
   * A PrivatBank transfer that stayed inside PrivatBank names the recipient's
   * IBAN instead of a card, and Transacto leaves `recipient_name` empty on its
   * payouts — so there is nothing on either side to compare. Three checks pass
   * (authentic, right sum, right window) and the fourth cannot run, so the
   * receipt goes upstream and Transacto's own recognition judges the recipient.
   */
  describe('when only the recipient could not be checked', () => {
    beforeEach(() => {
      verification.verify.mockResolvedValue({
        ...verified(),
        outcome: ReceiptVerificationOutcome.VERIFIED_EXCEPT_RECIPIENT
      })
    })

    it("sends the bank's own document upstream rather than refusing", async () => {
      await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(panelPayouts.uploadCheck).toHaveBeenCalledWith(
        TEST_PAYOUT_ID,
        expect.objectContaining({ fileName: '297X351KC1T2BKMB.pdf' })
      )
      expect(db.markReceiptRejected).not.toHaveBeenCalled()
    })

    /**
     * It is a weaker claim about somebody's money than the row beside it, and
     * an operator reconciling a disputed top-up has to be able to tell which of
     * the two this was rather than inferring it from the bank.
     */
    it('records that the recipient was never compared', async () => {
      await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

      expect(db.pushReceipt).toHaveBeenCalledWith(
        DEPOSIT_ID.toString(),
        expect.objectContaining({ recipientChecked: false })
      )
    })
  })

  /** A fully verified receipt records the stronger claim. */
  it('records that the recipient was compared when it was', async () => {
    await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf())

    expect(db.pushReceipt).toHaveBeenCalledWith(
      DEPOSIT_ID.toString(),
      expect.objectContaining({ recipientChecked: true })
    )
  })

  /** …and lets a workspace without the sidecar keep working, loudly. */
  it('sends the receipt unverified when no verifier is configured and none is required', async () => {
    verification.isConfigured = false

    await service.submit(TEST_TELEGRAM_ID, DEPOSIT_ID.toString(), pdf({ fileName: 'mine.pdf' }))

    expect(verification.verify).not.toHaveBeenCalled()
    expect(panelPayouts.uploadCheck).toHaveBeenCalledWith(
      TEST_PAYOUT_ID,
      expect.objectContaining({ fileName: 'mine.pdf' })
    )
  })
})
