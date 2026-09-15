import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import type { ReceiptTextResponse } from 'src/modules/receipt-verification/interfaces'
import type { ReceiptFile } from 'src/shared/interfaces'
import environments from 'src/environments'

const EXTRACT_PATH = '/extract'

/**
 * Everything this process says to `apps/receipt-checker`, and nothing it decides.
 *
 * Transport only, by the layering rule. It does not know what a receipt code is
 * or what the text it carries back means — it puts bytes on a request and hands
 * back what came off the wire.
 *
 * **No proxy is attached here, and that is deliberate.** The sidecar is on the
 * compose network, so this hop never leaves the host, and since the browser left
 * the image nothing behind it reaches the internet at all. Reading a file is
 * local work; the calls that go out are made from this process, where the pool
 * is.
 */
@Injectable()
export class ReceiptCheckerApiService {
  private readonly logger = new Logger(ReceiptCheckerApiService.name)

  constructor(private readonly httpService: HttpService) {}

  /**
   * Where the sidecar lives.
   *
   * Read per call rather than captured in the constructor so that a container
   * started before its configuration was complete fails on the call it cannot
   * make, not at boot with a URL nobody can see.
   */
  private get baseUrl(): string {
    return environments.RECEIPT_CHECKER_URL || ''
  }

  /**
   * How long text extraction may take.
   *
   * Optical recognition of a phone screenshot is the slow case and runs in
   * seconds; a PDF's text layer is immediate.
   */
  private get extractTimeoutMs(): number {
    return Number(environments.RECEIPT_CHECKER_EXTRACT_TIMEOUT_MS || '60000')
  }

  /** Whether the sidecar has been configured at all. */
  get isConfigured(): boolean {
    return this.baseUrl !== ''
  }

  /** Reads whatever text a receipt file carries. */
  async extractText(file: ReceiptFile): Promise<ReceiptTextResponse> {
    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
      file.fileName
    )

    const response = await this.httpService.axiosRef.post<ReceiptTextResponse>(
      `${this.baseUrl}${EXTRACT_PATH}`,
      form,
      { timeout: this.extractTimeoutMs }
    )

    return response.data
  }
}
