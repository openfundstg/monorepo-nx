import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common'
import { generateKeyPairSync } from 'node:crypto'
import { BankProvider, ERROR } from '@transacto/contracts'
import type { ResolveDropLinkRes } from '@transacto/contracts'
import {
  adaptNovaPayCard,
  isAllowedDropLinkHost,
  isCanonicalDropLink,
  NOVAPAY_CASE_OPEN,
  parseDropLink
} from 'src/shared/utils'
import { EgressChannel, ScraperWorkerMethod } from 'src/shared/interfaces'
import { parseJsonBody, ScraperWorkerService } from 'src/shared/scraper-worker'
import { BankScraperApiService } from 'src/modules/bank-scraper'

/**
 * How many redirects we will follow before giving up.
 *
 * PUMB currently needs one hop to reach the `box_id` — `mobile-app.pumb.ua`
 * 301s straight to `frames.payhub.com.ua/moneybox?box_id=…`. The allowance is
 * larger than that so an extra CDN hop does not break the feature, and small
 * enough that a redirect loop terminates rather than tying up a worker.
 */
const MAX_REDIRECTS = 5

/** The redirect body is read only because a GET brings one; this is far above any hop and below a page. */
const REDIRECT_BODY_LIMIT = 64 * 1024

/** The jar page's own backend, which maps a share link's sendId to the real jar. */
const MONO_HANDLER_URL = 'https://send.monobank.ua/api/handler'

/** Where a share link lives, rebuilt only as the `Referer` of the call above. */
const MONO_JAR_URL = 'https://send.monobank.ua/jar'

/**
 * The stream-widget URL, whose `jar` parameter is the long id.
 *
 * Resolution targets this shape rather than the builder page: the builder uses
 * `longJarId=`, which `extractTargetId` does not read, so a builder URL would
 * resolve to the literal string `builder.html`.
 */
const MONO_WIDGET_URL = 'https://send.monobank.ua/widget.html'

/** `jarStatus` of a jar that can still take money. */
const MONO_JAR_ACTIVE = 'ACTIVE'

/** `status` of a PUMB moneybox that can still take money. */
const PUMB_MONEYBOX_ACTIVE = 'ACTIVE'

/**
 * An ephemeral uncompressed P-256 point, base64 — the `Pc` the jar page sends.
 *
 * Built from the JWK coordinates as `0x04 || x || y` rather than by slicing a
 * DER export, so it does not depend on the encoder's byte layout.
 */
const ephemeralPublicKey = (): string => {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const { x, y } = publicKey.export({ format: 'jwk' })

  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(x as string, 'base64url'),
    Buffer.from(y as string, 'base64url')
  ]).toString('base64')
}

/**
 * Turns the link a user pasted into the one the scraper can read.
 *
 * The whole feature exists for PUMB. Its app shares a moneybox as
 * `mobile-app.pumb.ua/XXXX`, while `PumbScraperStrategy` needs the `box_id`
 * query parameter that only appears after a 301 to `payhub.com.ua`. Users were
 * being asked to open the link in a browser and copy the address bar by hand,
 * which is a step that gets done wrong far more often than it gets done.
 *
 * The browser cannot do this itself: `Location` on a cross-origin redirect is
 * not readable from JavaScript, so the hop has to happen here.
 *
 * **This makes an outbound request to a user-supplied URL, so it is written as
 * an allowlist, not a fetcher.** The starting host must belong to the selected
 * bank, redirects are read one hop at a time and re-checked against the same
 * allowlist rather than followed automatically, and nothing but http(s) is ever
 * requested. A permitted host redirecting to somewhere arbitrary is the case
 * that matters — auto-following would sail straight through it.
 *
 * The requests themselves go out through the Isolated Scraper Worker on the
 * `POOL` channel, so this process never opens the socket to a link a user
 * pasted — the exposure that made this the worst place to call out directly.
 * The worker's own SSRF guard (public host, default port, no redirect follow) is
 * a second fence behind the per-hop allowlist here.
 */
@Injectable()
export class DropLinkResolverService {
  private readonly logger = new Logger(DropLinkResolverService.name)

  constructor(
    private readonly bankScraperApi: BankScraperApiService,
    private readonly scraperWorker: ScraperWorkerService
  ) {}

  /**
   * **Every bank is asked, even when the link is already usable.** The call is
   * what reveals the target, the owner and whatever the bank will say about the
   * card, and knowing those *before* an order exists is what lets a wrong setup
   * be refused instead of blocking a running order with a stake already frozen.
   * PUMB used to short-circuit here, which is precisely why a PUMB order could
   * not be checked at creation and why the bank was switched off.
   */
  async resolve(bank: BankProvider, link: string): Promise<ResolveDropLinkRes> {
    const start = parseDropLink(link)
    if (!start) throw new BadRequestException(ERROR.TERMINAL.INVALID_CRED_URL)

    if (!isAllowedDropLinkHost(start, bank))
      throw new BadRequestException(ERROR.SALE.DROP_LINK_UNSUPPORTED_HOST)

    // Monobank is asked either way, even when the link is already usable: the
    // same call that maps the short id to the long one also returns the jar's
    // goal and status, and knowing the goal *before* an order exists is what
    // lets a wrong target be refused instead of blocking a running order.
    if (bank === BankProvider.MONO) {
      const { link, goal, ownerName } = await this.resolveMonobankJar(start)
      const resolved = link !== start.toString()

      if (resolved) this.logger.log(`Resolved ${bank} drop link ${start.toString()} to ${link}`)

      // No card number, masked or otherwise: the jar's own "Номер картки Банки"
      // appears on the share screen, not in any public record, so the user still
      // types it and no check can run against it for Monobank.
      return { link, resolved, goal, cardNumber: null, cardNumberMask: null, ownerName }
    }

    // A PrivatBank envelope link is already usable as it stands, but asking
    // anyway is what reveals the card it pays into and the target it is set to.
    // Until this existed the recommended bank was the one with no goal check at
    // creation at all — `goal: null` skipped it — and no way to tell a link and
    // a card number that belonged to different people.
    if (bank === BankProvider.PRIVAT) {
      const envelope = await this.resolvePrivatEnvelope(start)

      return { link: start.toString(), resolved: false, cardNumberMask: null, ...envelope }
    }

    // A NovaPay case link is already the page the scraper reads, so nothing is
    // resolved here either — what the call buys is the card, the owner and the
    // target, none of which exist anywhere but on that page.
    if (bank === BankProvider.NOVAPAY) {
      const kase = await this.resolveNovaPayCase(start)

      return { link: start.toString(), resolved: false, cardNumberMask: null, ...kase }
    }

    // PUMB takes two steps, and both are needed even when the link already
    // carries a `box_id`: the redirect only finds the moneybox, and the record
    // behind it is what names the owner, the target and the masked card.
    const moneybox = isCanonicalDropLink(start, bank)
      ? start.toString()
      : await this.followRedirects(start, bank)
    const resolved = moneybox !== start.toString()

    if (resolved) this.logger.log(`Resolved ${bank} drop link ${start.toString()} to ${moneybox}`)

    return { link: moneybox, resolved, ...(await this.resolvePumbMoneybox(moneybox)) }
  }

  /**
   * Reads a NovaPay case, for the three things only its page states.
   *
   * The card is the reason this bank can be offered at all: a case names it in
   * full, so the create form fills the field in and the user cannot mistype it.
   * It is also the reason a case whose card cannot be read is refused — the
   * form has no editable field to fall back to, and an order created against a
   * card nobody supplied would be an order nobody can pay.
   */
  private async resolveNovaPayCase(
    url: URL
  ): Promise<{ goal: number | null; cardNumber: string | null; ownerName: string | null }> {
    const publicId = url.pathname.split('/').filter(Boolean).pop()
    if (!publicId) throw new BadRequestException(ERROR.SALE.DROP_LINK_UNRESOLVED)

    try {
      const kase = await this.bankScraperApi.fetchNovaPayCase(publicId)

      if (kase.status !== NOVAPAY_CASE_OPEN)
        throw new BadRequestException(ERROR.SALE.JAR_NOT_ACTIVE)

      const cardNumber = adaptNovaPayCard(kase)

      if (cardNumber === null) {
        // The sentence is the only source there is, so this is either a case
        // shared without a card or the day NovaPay reworded it. Both are for a
        // person to look at; neither is something to guess past.
        this.logger.error(
          `NovaPay case ${publicId} states no card number in its sharing sentence`
        )
        throw new BadRequestException(ERROR.SALE.DROP_LINK_UNRESOLVED)
      }

      // Hryvnia as a decimal string, like PrivatBank's, and kopecks on the wire.
      const goal = Math.round(parseFloat(kase.amount) * 100)

      return {
        goal: Number.isFinite(goal) && goal > 0 ? goal : null,
        cardNumber,
        // Unmasked, unlike every other bank here: a case publishes its owner's
        // full name to everyone who opens the link.
        ownerName: kase.owner || null
      }
    } catch (error: unknown) {
      // A closed case and an unreadable one are verdicts, not hiccups.
      if (error instanceof BadRequestException) throw error

      this.logger.warn(
        `Could not read the NovaPay case behind ${url.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )

      return { goal: null, cardNumber: null, ownerName: null }
    }
  }

  /**
   * Reads a PUMB moneybox's public record — the same one the balance scraper
   * polls, asked once here for what it says about the account rather than about
   * the money.
   *
   * It names three things nothing else could tell us before an order exists:
   * the owner, the target, and **twelve of the card's sixteen digits**. The last
   * is why a PUMB order can be created at all again: a card that cannot be the
   * right one is now refused at the form instead of surfacing three dead orders
   * later.
   *
   * Never throws for a reachable-but-unhelpful answer, exactly as the PrivatBank
   * path does not: these are conveniences, and a PUMB outage must not stop
   * somebody creating an order. A closed moneybox is the one exception — that
   * one can never receive the money.
   */
  private async resolvePumbMoneybox(
    link: string
  ): Promise<{
    goal: number | null
    cardNumber: string | null
    cardNumberMask: string | null
    ownerName: string | null
  }> {
    const unknown = { goal: null, cardNumber: null, cardNumberMask: null, ownerName: null }
    const boxId = new URL(link).searchParams.get('box_id')
    if (!boxId) return unknown

    try {
      const box = await this.bankScraperApi.fetchPumbBox(boxId)

      if (box?.status !== PUMB_MONEYBOX_ACTIVE)
        throw new BadRequestException(ERROR.SALE.JAR_NOT_ACTIVE)

      return {
        // Already kopecks, unlike PrivatBank's decimal strings.
        goal: typeof box.amount === 'number' && Number.isFinite(box.amount) ? box.amount : null,
        // Never a card: what PUMB publishes has four digits missing and cannot
        // be paid into. The user supplies the rest and the mask checks it.
        cardNumber: null,
        cardNumberMask: typeof box.card_to_hash === 'string' ? box.card_to_hash : null,
        ownerName: typeof box.owner_name === 'string' ? box.owner_name : null
      }
    } catch (error: unknown) {
      // A closed moneybox is a verdict, not a hiccup — let it through.
      if (error instanceof BadRequestException) throw error

      this.logger.warn(
        `Could not read the PUMB moneybox behind ${link}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )

      return unknown
    }
  }

  /**
   * Reads a PrivatBank envelope's public record.
   *
   * Everything here is public to anyone holding the share link — the handshake
   * needs no auth — so this reveals nothing the user could not see themselves.
   *
   * Never throws for a reachable-but-unhelpful answer: the card and the goal are
   * conveniences, and a Privat outage must not stop someone creating an order.
   * A closed envelope is the one exception, because that one *is* a reason to
   * refuse — it can never receive the money.
   */
  private async resolvePrivatEnvelope(
    url: URL
  ): Promise<{ goal: number | null; cardNumber: string | null; ownerName: string | null }> {
    const hash = url.pathname.split('/').filter(Boolean).pop()
    if (!hash) throw new BadRequestException(ERROR.SALE.DROP_LINK_UNRESOLVED)

    try {
      const { data } = await this.bankScraperApi.fetchPrivatEnvelope(hash)

      if (data?.active === false) throw new BadRequestException(ERROR.SALE.JAR_NOT_ACTIVE)

      // Kopecks, matching everything else on the wire; PrivatBank reports
      // hryvnia as a decimal string.
      const parsedGoal = data?.goalAmount ? Math.round(parseFloat(data.goalAmount) * 100) : null

      return {
        goal: parsedGoal !== null && Number.isFinite(parsedGoal) ? parsedGoal : null,
        cardNumber: typeof data?.card === 'string' ? data.card : null,
        ownerName: typeof data?.ownerName === 'string' ? data.ownerName : null
      }
    } catch (error: unknown) {
      // A closed envelope is a verdict, not a hiccup — let it through.
      if (error instanceof BadRequestException) throw error

      this.logger.warn(
        `Could not read the PrivatBank envelope behind ${url.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )

      return { goal: null, cardNumber: null, ownerName: null }
    }
  }

  /**
   * Exchanges a Monobank share link's short id for the long one the scraper
   * needs.
   *
   * `send.monobank.ua/jar/<sendId>` carries the *sendId*, and
   * `api.monobank.ua/bank/jar/<sendId>` rejects it with `400 invalid alias` —
   * only the long `extJarId` works. The jar page itself gets that id by asking
   * this endpoint, so we ask it the same way and rebuild the stream-widget URL,
   * whose `jar` parameter `extractTargetId` already knows how to read.
   *
   * That is the whole reason this exists rather than the guide telling users to
   * copy the widget link by hand: they can paste the obvious link and still end
   * up with a terminal that scrapes.
   */
  private async resolveMonobankJar(
    url: URL
  ): Promise<{ link: string; goal: number | null; ownerName: string | null }> {
    // A share link carries the sendId in its path; an already-resolved widget
    // link carries it as a parameter. Either way it is what the endpoint wants.
    const sendId =
      url.searchParams.get('sendId') ?? url.pathname.split('/').filter(Boolean).pop() ?? null
    if (!sendId) throw new BadRequestException(ERROR.SALE.DROP_LINK_UNRESOLVED)

    const jar = await this.fetchMonobankJar(sendId)

    const extJarId = typeof jar.extJarId === 'string' ? jar.extJarId : null
    if (!extJarId) {
      this.logger.warn(
        `Monobank returned no extJarId for sendId ${sendId}` +
          (jar.errCode ? ` (errCode ${String(jar.errCode)})` : '')
      )
      throw new BadRequestException(ERROR.SALE.DROP_LINK_UNRESOLVED)
    }

    // A closed jar can never receive the payment, so there is no point creating
    // a terminal for it — and finding out now beats finding out from a scrape.
    if (typeof jar.jarStatus === 'string' && jar.jarStatus !== MONO_JAR_ACTIVE)
      throw new BadRequestException(ERROR.SALE.JAR_NOT_ACTIVE)

    return {
      link: `${MONO_WIDGET_URL}?jar=${encodeURIComponent(extJarId)}&sendId=${encodeURIComponent(sendId)}`,
      // `jarGoal` is UAH kopecks, matching everything else on the wire — a jar
      // targeting ₴1 000 reports 100000. Absent when no goal is set.
      goal: typeof jar.jarGoal === 'number' ? jar.jarGoal : null,
      // The handshake names the owner itself, masked to a first name and a
      // surname initial: "Іван П.". No second call is needed for it — the
      // jar's public record at `api.monobank.ua/bank/jar` returns the same
      // string, and asking it too was a round trip that bought nothing.
      ownerName: typeof jar.ownerName === 'string' ? jar.ownerName : null
    }
  }

  /**
   * The jar page's own handshake call.
   *
   * `Pc` is an ephemeral uncompressed P-256 public key — the client half of a
   * key exchange the rest of that page uses. Nothing here needs the shared
   * secret, but the endpoint rejects a payload without a well-formed key, so
   * one is generated per call and thrown away. The browser also sends a long
   * `Sc` nonce; it is verifiably optional, so it is not reproduced.
   */
  private async fetchMonobankJar(sendId: string): Promise<Record<string, unknown>> {
    try {
      const result = await this.scraperWorker.request(
        {
          url: MONO_HANDLER_URL,
          channel: EgressChannel.POOL,
          method: ScraperWorkerMethod.POST,
          body: JSON.stringify({ c: 'hello', clientId: sendId, referer: '', Pc: ephemeralPublicKey() }),
          contentType: 'application/json',
          headers: { Referer: `${MONO_JAR_URL}/${sendId}` }
        },
        { consumer: 'Monobank jar handshake' }
      )

      // Their handshake answers 2xx for a jar it knows; anything else is a
      // failure to reach it, which reads to the user as an unresolvable link.
      if (result.upstreamStatus < 200 || result.upstreamStatus >= 300)
        throw new Error(`the jar handshake answered ${result.upstreamStatus}`)

      return parseJsonBody<Record<string, unknown>>(result) ?? {}
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to resolve Monobank jar ${sendId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      throw new BadGatewayException(ERROR.SALE.DROP_LINK_RESOLUTION_FAILED)
    }
  }

  /**
   * Walks the redirect chain by hand, stopping at the first URL the scraper
   * could read.
   *
   * Stopping early is deliberate. PUMB's chain continues from
   * `frames.payhub.com.ua` to `frames2.payhub.com.ua`, but the `box_id` is
   * already present on the first hop and `frames2` looks like a load-balancer
   * target rather than a stable public address — so the first usable link is
   * both sufficient and the better one to persist.
   */
  private async followRedirects(start: URL, bank: BankProvider): Promise<string> {
    let current = start

    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const location = await this.readLocation(current)
      if (!location) break

      // Resolved against the current URL because `Location` is allowed to be
      // relative, and a bare path would otherwise fail to parse.
      const next = parseDropLink(new URL(location, current).toString())
      if (!next) break

      // Re-checked on every hop, not just the first. This is the line that
      // keeps a permitted host from redirecting us anywhere it likes.
      if (!isAllowedDropLinkHost(next, bank)) {
        this.logger.warn(
          `Refusing to follow ${bank} drop link redirect to a host outside the allowlist: ${next.hostname}`
        )
        break
      }

      if (isCanonicalDropLink(next, bank)) return next.toString()

      current = next
    }

    throw new BadRequestException(ERROR.SALE.DROP_LINK_UNRESOLVED)
  }

  /** The `Location` of a single hop, or `null` when this URL does not redirect. */
  private async readLocation(url: URL): Promise<string | null> {
    try {
      // The worker never follows redirects, so a 3xx comes back with its
      // `location` and nothing is chased on our behalf — the per-hop re-check in
      // `followRedirects` stays the only thing that advances the chain. The body
      // is read only because a GET brings one; the cap keeps a chain that ends
      // on a real page from downloading it (that case reports a failed
      // resolution, which reads the same to the user).
      const result = await this.scraperWorker.request(
        {
          url: url.toString(),
          channel: EgressChannel.POOL,
          method: ScraperWorkerMethod.GET,
          headers: { Accept: 'text/html,application/xhtml+xml' },
          maxBytes: REDIRECT_BODY_LIMIT
        },
        { consumer: 'drop-link redirect' }
      )

      // A 4xx/5xx hop is a failed resolution, exactly as the direct call treated
      // anything from 400 up as an error rather than a redirect.
      if (result.upstreamStatus >= 400)
        throw new Error(`a redirect hop answered ${result.upstreamStatus}`)

      return result.location ?? null
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to read the redirect for ${url.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      throw new BadGatewayException(ERROR.SALE.DROP_LINK_RESOLUTION_FAILED)
    }
  }
}
