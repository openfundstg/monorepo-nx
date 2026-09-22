import {
  BankProvider,
  KOPECKS_PER_UAH,
  MIN_USDT_AMOUNT,
  OFFICIAL_CHANNEL_URL,
  SALE_ENABLED_BANKS,
  roundTripProfitKopecks,
  roundTripProfitPercent
} from '@transacto/contracts'
import environments from 'src/environments'
import { SupportLocale } from 'src/shared/constants'
import { transactoOrderFloorKopecks } from 'src/shared/utils'
import { SupportButton, SupportInlineButton } from 'src/modules/support/enums'
import { formatPercent } from 'src/modules/support/utils/format-percent.util'
import { formatUahKopecks } from 'src/modules/support/utils/format-uah.util'
import { formatUsdtCents } from 'src/modules/support/utils/format-usdt.util'

/**
 * The only place in this backend that renders a sentence for a human, and the
 * repository rule it appears to break is worth stating plainly.
 *
 * `CLAUDE.md` forbids storing or sending user-facing text because there is
 * always a client to render it: an alert travels as an enum plus metadata and
 * the Mini App turns it into Ukrainian. **Here there is no client.** Telegram
 * renders whatever bytes the bot sends, so if the backend does not choose the
 * words, nobody does.
 *
 * What survives of the rule is everything that can: the sentences are keyed by
 * enum, never persisted (the database stores a {@link SupportLocale} and a
 * status, not prose), and picked per user — so the same conversation is
 * Ukrainian for one person and English for the next, which is precisely what a
 * frozen rendered string cannot do. Every figure a sentence names is passed in
 * rather than written here: the deposit floor comes from `@transacto/contracts`
 * so the bot and the Mini App cannot quote different minimums.
 *
 * Admin-facing lines are separate and single-language on purpose: the support
 * group is one room with one working language, and translating it per admin
 * would make two people reading the same thread see different text.
 */

/**
 * The product's name as users see it.
 *
 * One constant rather than eighteen literals, because a brand is exactly the
 * kind of string that gets renamed: this file previously said "Transacto" in
 * every dictionary, which is a name users of this bot must never see. The spec
 * beside it asserts no dictionary string names anything else.
 */
export const BRAND = 'Open Funds'

/**
 * The channel link, as Telegram's HTML wants it.
 *
 * A helper rather than the markup written out per dictionary: the address comes
 * from `@transacto/contracts` so the bot and the Mini App cannot point at two
 * different channels, and only the words around it are a language's business.
 *
 * Every message carrying one of these must be sent with
 * `parse_mode: HTML` — without it Telegram prints the tag.
 */
/**
 * The line naming what a round trip earns, or nothing at all.
 *
 * A **function over the pair** rather than a figure each dictionary computes,
 * because the arithmetic is the contract's — the same `roundTripProfitKopecks`
 * and `roundTripProfitPercent` the Mini App's dashboard banner uses, so the bot
 * and the screen a tap later cannot print two different profits.
 *
 * Empty when the spread is not positive. The dashboard drops its banner on the
 * same condition, and for the same reason: a "profit" of zero or less is not a
 * smaller promise, it is a different sentence, and this is not the place to
 * write it.
 */
const spreadLine = (
  rates: SupportRates,
  sentence: (uah: string, percent: string) => string
): string => {
  const kopecks = roundTripProfitKopecks(rates.buy, rates.sell)
  if (kopecks <= 0) return ''

  return sentence(
    formatUahKopecks(kopecks),
    formatPercent(roundTripProfitPercent(rates.buy, rates.sell))
  )
}

const channelLink = (label: string): string =>
  `<a href="${OFFICIAL_CHANNEL_URL}">${label}</a>`

/**
 * What each bank is called, in the spelling the Mini App uses on its own picker.
 *
 * The same word in every language: these are brand names, and a user reading
 * the guide in English still opens a form that says "PrivatBank". A `Record`
 * over the enum, so a bank added to the product fails to compile until it has
 * a name here.
 */
export const BANK_NAME: Readonly<Record<BankProvider, string>> = {
  [BankProvider.MONO]: 'Monobank',
  [BankProvider.PRIVAT]: 'PrivatBank',
  [BankProvider.PUMB]: 'PUMB',
  [BankProvider.NOVAPAY]: 'NovaPay'
}

/**
 * The banks a sale can actually be created on, written out for a sentence.
 *
 * Read from the same list the create form filters its picker with, so the guide
 * cannot go on offering a bank the product has switched off — which is exactly
 * what it did with Monobank.
 */
const enabledBankNames = (): string =>
  SALE_ENABLED_BANKS.map((bank) => BANK_NAME[bank]).join(', ')

/** Sentences the bot sends to a user, in their own language. */
export enum SupportUserText {
  /** Answer to `/start` — the only thing that does not open a conversation. */
  GREETING = 'GREETING',
  /** Sent once, when a user's first message opens a topic. */
  CONVERSATION_STARTED = 'CONVERSATION_STARTED',
  /** Answer to the *Support* key: everything after this goes to an operator. */
  SUPPORT_PROMPT = 'SUPPORT_PROMPT',
  /** Answer to the *Language* key, above the three choices. */
  LANGUAGE_PROMPT = 'LANGUAGE_PROMPT',
  /** Confirmation, always rendered in the newly chosen language. */
  LANGUAGE_SET = 'LANGUAGE_SET',
  /** The *Balance* key, pressed by somebody with no Mini App account yet. */
  BALANCE_NO_ACCOUNT = 'BALANCE_NO_ACCOUNT',
  /** Confirmation that a standing request for an amount has been cancelled. */
  FIAT_WATCH_CANCELLED = 'FIAT_WATCH_CANCELLED',
  /**
   * The unsubscribe key pressed when there is nothing left to cancel.
   *
   * Ordinary rather than exceptional: the key lives on a message that stays in
   * the chat forever, so it is pressed on last week's notification by somebody
   * who unsubscribed in the Mini App days ago.
   */
  FIAT_WATCH_ALREADY_OFF = 'FIAT_WATCH_ALREADY_OFF',
  /** The seller confirmed a card order's money. */
  CARD_ORDER_CONFIRMED = 'CARD_ORDER_CONFIRMED',
  /** …or said it never came, which stops the sale and asks for a statement. */
  CARD_ORDER_DENIED = 'CARD_ORDER_DENIED',
  /**
   * A key pressed on an order somebody has already answered.
   *
   * Ordinary rather than exceptional: the message stays in the chat forever,
   * and the same order can be answered on the sale's own screen.
   */
  CARD_ORDER_ALREADY_ANSWERED = 'CARD_ORDER_ALREADY_ANSWERED',
  /** Denied from an old keyboard, before the payment was late. */
  CARD_ORDER_NOT_OVERDUE = 'CARD_ORDER_NOT_OVERDUE',
  /** Transacto will not execute it any more — too late, or cancelled upstream. */
  CARD_ORDER_NOT_EXECUTABLE = 'CARD_ORDER_NOT_EXECUTABLE',
  /** Something was down. Distinct from the above: trying again may work. */
  CARD_ORDER_FAILED = 'CARD_ORDER_FAILED',
  /** The key pressed on an order that is not this person's to answer. */
  CARD_ORDER_NOT_FOUND = 'CARD_ORDER_NOT_FOUND'
}

/**
 * One card order, as a message about it needs it.
 *
 * **No card number, in any form.** The seller knows which of their cards it is,
 * and a chat message is the last place a payment credential should reach.
 */
export interface SupportCardOrderView {
  /** UAH kopecks the payer was routed to send. */
  readonly amount: number
  /** The code the seller sees on the sale, and quotes to support. */
  readonly publicId: string
}

/**
 * The two prices this product quotes, as the card shows them together.
 *
 * One object rather than two nullable fields, because they are known together
 * or not at all — both are derived from a single reading of the market, and a
 * card that had one of them could only print half a spread. See
 * `ExchangeRateService.getSpread`.
 *
 * There is no market rate here and there must never be: a rate a screen can
 * read is a rate a screen can quote.
 */
export interface SupportRates {
  /** Kopecks per USDT a user **pays** when acquiring it. The smaller number. */
  readonly buy: number
  /** Kopecks per USDT a user **gets** when selling it. The larger number. */
  readonly sell: number
}

/** Everything the balance card prints, in the units the database holds. */
export interface SupportBalanceView {
  /** Spendable, USDT cents. `frozen` has already been taken out of it. */
  readonly available: number
  /** USDT cents committed to open sales. */
  readonly frozen: number
  /** USDT cents in the referral pot, which cannot fund an order. */
  readonly referral: number
  /** Lifetime sold total, in **UAH kopecks** — not cents, unlike the rest. */
  readonly turnover: number
  /**
   * Both prices, or `null` when the market could not be reached.
   *
   * Nullable rather than absent, because these are the only figures on this
   * card that come from outside: `ExchangeRateService` refuses to quote rather
   * than guess, and a balance is still worth showing without them. The lines
   * are dropped, the card is not.
   */
  readonly rates: SupportRates | null
}

/**
 * Everything the guide names, gathered where the product enforces it.
 *
 * An object rather than four positional arguments, because the list has already
 * grown twice and a reader of `guide(10, 300, '…', 15)` cannot tell which is
 * which. Every field here exists because the guide was once wrong about it.
 */
export interface SupportGuideFigures {
  /** Smallest crypto deposit, from `@transacto/contracts`. */
  readonly minUsdt: number
  /** Whole hryvnia below which a refunding sale closes itself. */
  readonly remainderUah: number
  /**
   * The banks a sale may be created on, already written out.
   *
   * Derived from `SALE_ENABLED_BANKS` rather than typed: the guide
   * named monobank for months after it was switched off, and offered a user a
   * bank the form would not let them choose.
   */
  readonly banks: string
  /** Minutes a hryvnia top-up allows for the transfer and the receipt. */
  readonly payWindowMinutes: number
}

/** Everything the "a sum you asked for has appeared" message prints. */
export interface SupportFiatAmountsView {
  /** The amounts that just reached the book, in UAH kopecks, cheapest first. */
  readonly amountsUah: readonly number[]
  /** The range as the user wrote it, quoted back so they know which request fired. */
  readonly minAmountUah: number
  readonly maxAmountUah: number
  /** Whether this was the one message they asked for and the request is now gone. */
  readonly once: boolean
}

export interface SupportDictionary {
  readonly text: Readonly<Record<SupportUserText, string>>
  readonly buttons: Readonly<Record<SupportButton, string>>
  readonly inlineButtons: Readonly<Record<SupportInlineButton, string>>
  /**
   * The message that calls somebody back about an amount they asked for.
   *
   * A function because every figure in it is theirs, and because the amounts
   * are a list whose length is whatever the book did in the last twenty
   * seconds.
   */
  readonly fiatAmountsAvailable: (view: SupportFiatAmountsView) => string
  /** Interpolates money, so it is a function; every figure arrives in cents. */
  readonly balanceCard: (balance: SupportBalanceView) => string
  /**
   * Interpolates every figure rather than naming any here — see
   * {@link SupportGuideFigures}. A guide that quotes its own numbers is a guide
   * that eventually quotes the wrong ones, and this one did.
   */
  readonly guide: (figures: SupportGuideFigures) => string
  /** Asks the seller whether one card order's money arrived. */
  readonly cardOrderAwaiting: (view: SupportCardOrderView) => string
  /** …and tells them the sale is paused because nobody said. */
  readonly cardOrderDisputed: (view: SupportCardOrderView) => string
}

const UK: SupportDictionary = {
  buttons: {
    [SupportButton.GUIDE]: '📖 Гайд',
    [SupportButton.BALANCE]: '💰 Баланс',
    [SupportButton.SUPPORT]: '💬 Підтримка',
    [SupportButton.LANGUAGE]: '🌐 Мова'
  },
  text: {
    GREETING:
      `Вітаємо у ${BRAND} 👋\n\n` +
      'Скористайтеся кнопками нижче: «Гайд» — як усе працює\n ' +
      '«Баланс» — скільки у вас коштів\n ' +
      '«Підтримка» — написати оператору.\n\n' +
      `📣 Новини та оновлення — ${channelLink('наш канал')}.`,
    CONVERSATION_STARTED:
      '✅ Звернення прийнято. Оператор відповість у цьому чаті — сповіщення прийде сюди ж.',
    SUPPORT_PROMPT:
      '💬 Опишіть питання одним повідомленням — я передам його оператору. ' +
      'Можна надсилати скріншоти та документи.',
    LANGUAGE_PROMPT: '🌐 Оберіть мову:',
    LANGUAGE_SET: '✅ Мову змінено на українську.',
    BALANCE_NO_ACCOUNT:
      `У вас ще немає акаунта ${BRAND}. Відкрийте застосунок — акаунт створиться автоматично.`,
    FIAT_WATCH_CANCELLED:
      '🔕 Готово — більше не повідомлятимемо про суми. ' +
      'Підписатися знову можна в застосунку, на екрані поповнення гривнею.',
    FIAT_WATCH_ALREADY_OFF: '🔕 Підписки вже немає — повідомлень про суми ви не отримуєте.',
    CARD_ORDER_CONFIRMED: '✅ Дякуємо! Зарахування підтверджено, продаж триває.',
    CARD_ORDER_DENIED:
      '⚠️ Записали. Нові платежі по цій заявці зупинено.\n\n' +
      'Якщо гроші все ж надійдуть — підтвердьте у застосунку. ' +
      'Якщо ні — надішліть там виписку по картці, ми перевіримо самі.',
    CARD_ORDER_ALREADY_ANSWERED: 'Цей платіж уже опрацьовано — робити нічого не треба.',
    CARD_ORDER_NOT_OVERDUE:
      'Час на цей платіж ще не вийшов — зачекайте. Якщо гроші так і не надійдуть, ми запитаємо вас самі.',
    CARD_ORDER_NOT_EXECUTABLE:
      '⚠️ Цей платіж уже не можна підтвердити автоматично. Натисніть «Підтримка», ' +
      'і оператор розбереться вручну.',
    CARD_ORDER_FAILED: 'Не вдалося опрацювати зараз. Спробуйте ще раз за хвилину.',
    CARD_ORDER_NOT_FOUND: 'Не знайшли цей платіж серед ваших заявок.'
  },
  inlineButtons: {
    [SupportInlineButton.FIAT_WATCH_OFF]: '🔕 Відписатися',
    [SupportInlineButton.OPEN_MINI_APP]: '💳 Поповнити',
    [SupportInlineButton.CARD_SALE_CONFIRM]: '✅ Гроші надійшли',
    [SupportInlineButton.CARD_SALE_DENY]: '❌ Не надійшли',
    [SupportInlineButton.OPEN_SALE]: '📄 Відкрити заявку'
  },
  fiatAmountsAvailable: ({ amountsUah, minAmountUah, maxAmountUah, once }) =>
    `🔔 <b>Зʼявилася сума для поповнення</b>\n\n` +
    amountsUah.map((amount) => `• <b>${formatUahKopecks(amount)} грн</b>`).join('\n') +
    `\n\nВи просили повідомити про суми від ${formatUahKopecks(minAmountUah)} ` +
    `до ${formatUahKopecks(maxAmountUah)} грн.\n` +
    `Виплату може забрати інший трейдер, тому відкривайте застосунок одразу.` +
    (once ? `\n\nЦе було одноразове сповіщення — підписку вимкнено.` : ''),
  balanceCard: ({ available, frozen, referral, turnover, rates }) =>
    `💰 <b>Ваш баланс</b>\n\n` +
    `Доступно: <b>${formatUsdtCents(available)} USDT</b>` +
    (frozen > 0 ? `\nУ роботі: ${formatUsdtCents(frozen)} USDT` : '') +
    (referral > 0 ? `\nРеферальні: ${formatUsdtCents(referral)} USDT` : '') +
    `\n\nПродано за весь час: <b>${formatUahKopecks(turnover)} грн</b>` +
    (rates === null
      ? '\n\nКурси тимчасово недоступні.'
      : `\n\n📉 Купити: <b>${formatUahKopecks(rates.buy)} грн</b> за 1 USDT` +
        `\n📈 Продати: <b>${formatUahKopecks(rates.sell)} грн</b> за 1 USDT` +
        spreadLine(rates, (uah, percent) => `\n\n💰 Ваш профіт: <b>${uah} грн</b> (${percent}%) з кожного USDT`)),
  cardOrderAwaiting: ({ amount, publicId }) =>
    `💳 <b>Очікується зарахування</b>\n\n` +
    `На вашу картку має надійти <b>${formatUahKopecks(amount)} грн</b> ` +
    `за заявкою <b>${publicId}</b>.\n\n` +
    `Щойно побачите гроші — натисніть «Гроші надійшли». ` +
    `Якщо не надійдуть — натисніть «Не надійшли», і ми зупинимо заявку.`,
  cardOrderDisputed: ({ amount, publicId }) =>
    `⏸ <b>Заявку призупинено</b>\n\n` +
    `Зарахування <b>${formatUahKopecks(amount)} грн</b> за заявкою <b>${publicId}</b> ` +
    `не підтверджено, тому нові платежі на вашу картку зупинено.\n\n` +
    `Якщо гроші все ж надійшли — підтвердьте кнопкою нижче. ` +
    `Якщо ні — відкрийте заявку і надішліть виписку по картці: ми перевіримо самі.`,
  guide: ({ minUsdt, remainderUah, banks, payWindowMinutes }) =>
    `📖 <b>Як працює ${BRAND}</b>\n\n` +
    `<b>1. Поповніть баланс.</b> Двома способами, на вибір:\n\n` +
    `  • <b>Гривнею</b> — оберіть суму зі списку, перекажіть її з картки MonoBank або ` +
    `ПриватБанк і завантажте квитанцію. На переказ і квитанцію разом — ${payWindowMinutes} хв.\n` +
    `  • <b>Криптою</b> — надішліть переказ у мережі TRON (TRC-20) на адресу, яку покаже ` +
    `застосунок, і вставте TxID. Мінімум — ${minUsdt} USDT.\n\n` +
    `<b>2. Створіть продаж.</b> Оберіть банк (${banks}), вкажіть суму та надішліть посилання ` +
    `за інструкцією на екрані. Потрібну суму USDT буде заморожено на балансі, поки продаж ` +
    `відкритий.\n\n` +
    `<b>3. Дочекайтеся виконання.</b> Статус оновлюється наживо, а коли продаж завершиться — ` +
    `залежить від того, що ви обрали на кроці 2:\n\n` +
    `  • <b>Дочекатися повної суми</b> — продаж закриється, коли на банку надійде вся сума ` +
    `до цілі.\n` +
    `  • <b>Повернути залишок на баланс</b> (рекомендовано) — щойно до цілі банки лишається ` +
    `менше ніж ${remainderUah} грн, продаж завершується автоматично, а залишок повертається ` +
    `на ваш баланс у USDT за курсом на момент створення.\n\n` +
    `<b>4. Закрийте банку.</b> Після завершення продажу закрийте банку у застосунку банку — ` +
    `поки вона відкрита, слот залишається зайнятим. Щойно банк повідомить, що банку закрито, ` +
    `слот звільниться сам.\n\n` +
    `<b>5. Рівні довіри.</b> Що більший ваш оборот, то більше продажів можна тримати ` +
    `одночасно. Поточний рівень видно на головному екрані.\n\n` +
    `<b>6. Реферальна програма.</b> Поділіться посиланням із розділу «Реферали» — ви ` +
    `отримуватимете відсоток від оборотів запрошених. Ці кошти зберігаються окремо і ` +
    `переводяться на основний баланс у застосунку.\n\n` +
    `Лишилося питання? Натисніть «Підтримка».`
}

const RU: SupportDictionary = {
  buttons: {
    [SupportButton.GUIDE]: '📖 Гайд',
    [SupportButton.BALANCE]: '💰 Баланс',
    [SupportButton.SUPPORT]: '💬 Поддержка',
    [SupportButton.LANGUAGE]: '🌐 Язык'
  },
  text: {
    GREETING:
      `Добро пожаловать в ${BRAND} 👋\n\n` +
      'Пользуйтесь кнопками ниже: «Гайд» — как всё работает\n ' +
      '«Баланс» — сколько у вас средств\n ' +
      '«Поддержка» — написать оператору.\n\n' +
      `📣 Новости и обновления — ${channelLink('наш канал')}.`,
    CONVERSATION_STARTED:
      '✅ Обращение принято. Оператор ответит в этом чате — уведомление придёт сюда же.',
    SUPPORT_PROMPT:
      '💬 Опишите вопрос одним сообщением — я передам его оператору. ' +
      'Можно присылать скриншоты и документы.',
    LANGUAGE_PROMPT: '🌐 Выберите язык:',
    LANGUAGE_SET: '✅ Язык изменён на русский.',
    BALANCE_NO_ACCOUNT:
      `У вас ещё нет аккаунта ${BRAND}. Откройте приложение — аккаунт создастся автоматически.`,
    FIAT_WATCH_CANCELLED:
      '🔕 Готово — больше не будем сообщать о суммах. ' +
      'Подписаться снова можно в приложении, на экране пополнения гривной.',
    FIAT_WATCH_ALREADY_OFF: '🔕 Подписки уже нет — уведомления о суммах вам не приходят.',
    CARD_ORDER_CONFIRMED: '✅ Спасибо! Зачисление подтверждено, продажа продолжается.',
    CARD_ORDER_DENIED:
      '⚠️ Записали. Новые платежи по этой заявке остановлены.\n\n' +
      'Если деньги всё же придут — подтвердите в приложении. ' +
      'Если нет — отправьте там выписку по карте, мы проверим сами.',
    CARD_ORDER_ALREADY_ANSWERED: 'Этот платёж уже обработан — делать ничего не нужно.',
    CARD_ORDER_NOT_OVERDUE:
      'Время на этот платёж ещё не вышло — подождите. Если деньги так и не придут, мы спросим вас сами.',
    CARD_ORDER_NOT_EXECUTABLE:
      '⚠️ Этот платёж уже нельзя подтвердить автоматически. Нажмите «Поддержка», ' +
      'и оператор разберётся вручную.',
    CARD_ORDER_FAILED: 'Не удалось обработать сейчас. Попробуйте ещё раз через минуту.',
    CARD_ORDER_NOT_FOUND: 'Не нашли этот платёж среди ваших заявок.'
  },
  inlineButtons: {
    [SupportInlineButton.FIAT_WATCH_OFF]: '🔕 Отписаться',
    [SupportInlineButton.OPEN_MINI_APP]: '💳 Пополнить',
    [SupportInlineButton.CARD_SALE_CONFIRM]: '✅ Деньги пришли',
    [SupportInlineButton.CARD_SALE_DENY]: '❌ Не пришли',
    [SupportInlineButton.OPEN_SALE]: '📄 Открыть заявку'
  },
  fiatAmountsAvailable: ({ amountsUah, minAmountUah, maxAmountUah, once }) =>
    `🔔 <b>Появилась сумма для пополнения</b>\n\n` +
    amountsUah.map((amount) => `• <b>${formatUahKopecks(amount)} грн</b>`).join('\n') +
    `\n\nВы просили сообщить о суммах от ${formatUahKopecks(minAmountUah)} ` +
    `до ${formatUahKopecks(maxAmountUah)} грн.\n` +
    `Выплату может забрать другой трейдер, поэтому открывайте приложение сразу.` +
    (once ? `\n\nЭто было разовое уведомление — подписка отключена.` : ''),
  balanceCard: ({ available, frozen, referral, turnover, rates }) =>
    `💰 <b>Ваш баланс</b>\n\n` +
    `Доступно: <b>${formatUsdtCents(available)} USDT</b>` +
    (frozen > 0 ? `\nВ работе: ${formatUsdtCents(frozen)} USDT` : '') +
    (referral > 0 ? `\nРеферальные: ${formatUsdtCents(referral)} USDT` : '') +
    `\n\nПродано за всё время: <b>${formatUahKopecks(turnover)} грн</b>` +
    (rates === null
      ? '\n\nКурсы временно недоступны.'
      : `\n\n📉 Купить: <b>${formatUahKopecks(rates.buy)} грн</b> за 1 USDT` +
        `\n📈 Продать: <b>${formatUahKopecks(rates.sell)} грн</b> за 1 USDT` +
        spreadLine(rates, (uah, percent) => `\n\n💰 Ваш профит: <b>${uah} грн</b> (${percent}%) с каждого USDT`)),
  cardOrderAwaiting: ({ amount, publicId }) =>
    `💳 <b>Ожидается зачисление</b>\n\n` +
    `На вашу карту должно прийти <b>${formatUahKopecks(amount)} грн</b> ` +
    `по заявке <b>${publicId}</b>.\n\n` +
    `Как только увидите деньги — нажмите «Деньги пришли». ` +
    `Если не придут — нажмите «Не пришли», и мы остановим заявку.`,
  cardOrderDisputed: ({ amount, publicId }) =>
    `⏸ <b>Заявка приостановлена</b>\n\n` +
    `Зачисление <b>${formatUahKopecks(amount)} грн</b> по заявке <b>${publicId}</b> ` +
    `не подтверждено, поэтому новые платежи на вашу карту остановлены.\n\n` +
    `Если деньги всё же пришли — подтвердите кнопкой ниже. ` +
    `Если нет — откройте заявку и отправьте выписку по карте: мы проверим сами.`,
  guide: ({ minUsdt, remainderUah, banks, payWindowMinutes }) =>
    `📖 <b>Как работает ${BRAND}</b>\n\n` +
    `<b>1. Пополните баланс.</b> Двумя способами, на выбор:\n\n` +
    `  • <b>Гривной</b> — выберите сумму из списка, переведите её с карты MonoBank или ` +
    `ПриватБанк и загрузите квитанцию. На перевод и квитанцию вместе — ${payWindowMinutes} мин.\n` +
    `  • <b>Криптой</b> — отправьте перевод в сети TRON (TRC-20) на адрес, который покажет ` +
    `приложение, и вставьте TxID. Минимум — ${minUsdt} USDT.\n\n` +
    `<b>2. Создайте продажу.</b> Выберите банк (${banks}), укажите сумму и отправьте ссылку ` +
    `по инструкции на экране. Нужная сумма USDT будет заморожена на балансе, пока продажа ` +
    `открыта.\n\n` +
    `<b>3. Дождитесь выполнения.</b> Статус обновляется вживую, а как продажа завершится — ` +
    `зависит от того, что вы выбрали на шаге 2:\n\n` +
    `  • <b>Дождаться полной суммы</b> — продажа закроется, когда на банку поступит вся сумма ` +
    `до цели.\n` +
    `  • <b>Вернуть остаток на баланс</b> (рекомендуется) — как только до цели банки остаётся ` +
    `меньше ${remainderUah} грн, продажа завершается автоматически, а остаток возвращается ` +
    `на ваш баланс в USDT по курсу на момент создания.\n\n` +
    `<b>4. Закройте банку.</b> После завершения продажи закройте банку в приложении банка — ` +
    `пока она открыта, слот остаётся занятым. Как только банк сообщит, что банка закрыта, ` +
    `слот освободится сам.\n\n` +
    `<b>5. Уровни доверия.</b> Чем больше ваш оборот, тем больше продаж можно держать ` +
    `одновременно. Текущий уровень виден на главном экране.\n\n` +
    `<b>6. Реферальная программа.</b> Поделитесь ссылкой из раздела «Рефералы» — вы будете ` +
    `получать процент от оборотов приглашённых. Эти средства хранятся отдельно и переводятся ` +
    `на основной баланс в приложении.\n\n` +
    `Остался вопрос? Нажмите «Поддержка».`
}

const EN: SupportDictionary = {
  buttons: {
    [SupportButton.GUIDE]: '📖 Guide',
    [SupportButton.BALANCE]: '💰 Balance',
    [SupportButton.SUPPORT]: '💬 Support',
    [SupportButton.LANGUAGE]: '🌐 Language'
  },
  text: {
    GREETING:
      `Welcome to ${BRAND} 👋\n\n` +
      'Use the keys below: “Guide” — how it works\n ' +
      '“Balance” — what you hold\n ' +
      '“Support” — message an operator.\n\n' +
      `📣 News and updates — ${channelLink('our channel')}.`,
    CONVERSATION_STARTED: '✅ Your request has been received. An operator will reply in this chat.',
    SUPPORT_PROMPT:
      '💬 Describe your question in one message and I will pass it to an operator. ' +
      'Screenshots and documents are welcome.',
    LANGUAGE_PROMPT: '🌐 Choose a language:',
    LANGUAGE_SET: '✅ Language switched to English.',
    BALANCE_NO_ACCOUNT:
      `You have no ${BRAND} account yet. Open the app — it is created automatically.`,
    FIAT_WATCH_CANCELLED:
      '🔕 Done — we will not write about amounts any more. ' +
      'You can subscribe again in the app, on the hryvnia top-up screen.',
    FIAT_WATCH_ALREADY_OFF: '🔕 There is no subscription left — you are not being notified.',
    CARD_ORDER_CONFIRMED: '✅ Thank you. The payment is confirmed and the sale continues.',
    CARD_ORDER_DENIED:
      '⚠️ Noted. No further payments will be sent to this sale.\n\n' +
      'If the money does arrive after all, confirm it in the app. ' +
      'If it does not, send your card statement there and we will check it ourselves.',
    CARD_ORDER_ALREADY_ANSWERED: 'This payment has already been handled — nothing to do.',
    CARD_ORDER_NOT_OVERDUE:
      'This payment is not late yet — please wait. If the money never arrives, we will ask you.',
    CARD_ORDER_NOT_EXECUTABLE:
      '⚠️ This payment can no longer be confirmed automatically. Press “Support” and ' +
      'an operator will sort it out by hand.',
    CARD_ORDER_FAILED: 'That could not be processed just now. Please try again in a minute.',
    CARD_ORDER_NOT_FOUND: 'We could not find that payment among your sales.'
  },
  inlineButtons: {
    [SupportInlineButton.FIAT_WATCH_OFF]: '🔕 Unsubscribe',
    [SupportInlineButton.OPEN_MINI_APP]: '💳 Top up',
    [SupportInlineButton.CARD_SALE_CONFIRM]: '✅ Money arrived',
    [SupportInlineButton.CARD_SALE_DENY]: '❌ Nothing arrived',
    [SupportInlineButton.OPEN_SALE]: '📄 Open the sale'
  },
  fiatAmountsAvailable: ({ amountsUah, minAmountUah, maxAmountUah, once }) =>
    `🔔 <b>An amount you asked about is available</b>\n\n` +
    amountsUah.map((amount) => `• <b>${formatUahKopecks(amount)} UAH</b>`).join('\n') +
    `\n\nYou asked to be told about amounts from ${formatUahKopecks(minAmountUah)} ` +
    `to ${formatUahKopecks(maxAmountUah)} UAH.\n` +
    `Another trader can take the payout, so open the app straight away.` +
    (once ? `\n\nThat was the one-off notification — the request is now off.` : ''),
  balanceCard: ({ available, frozen, referral, turnover, rates }) =>
    `💰 <b>Your balance</b>\n\n` +
    `Available: <b>${formatUsdtCents(available)} USDT</b>` +
    (frozen > 0 ? `\nIn open orders: ${formatUsdtCents(frozen)} USDT` : '') +
    (referral > 0 ? `\nReferral: ${formatUsdtCents(referral)} USDT` : '') +
    `\n\nSold all time: <b>₴${formatUahKopecks(turnover)}</b>` +
    (rates === null
      ? '\n\nRates are temporarily unavailable.'
      : `\n\n📉 Buy: <b>₴${formatUahKopecks(rates.buy)}</b> per 1 USDT` +
        `\n📈 Sell: <b>₴${formatUahKopecks(rates.sell)}</b> per 1 USDT` +
        spreadLine(rates, (uah, percent) => `\n\n💰 Your profit: <b>₴${uah}</b> (${percent}%) on every USDT`)),
  cardOrderAwaiting: ({ amount, publicId }) =>
    `💳 <b>A payment is on its way</b>\n\n` +
    `<b>₴${formatUahKopecks(amount)}</b> should reach your card for sale <b>${publicId}</b>.\n\n` +
    `As soon as you see the money, press \u201cMoney arrived\u201d. ` +
    `If it never comes, press \u201cNothing arrived\u201d and we will pause the sale.`,
  cardOrderDisputed: ({ amount, publicId }) =>
    `⏸ <b>The sale is paused</b>\n\n` +
    `<b>₴${formatUahKopecks(amount)}</b> for sale <b>${publicId}</b> was not confirmed, so no ` +
    `further payments are being sent to your card.\n\n` +
    `If the money did arrive, confirm it with the button below. If it did not, open the sale ` +
    `and send your card statement: we will check it ourselves.`,
  guide: ({ minUsdt, remainderUah, banks, payWindowMinutes }) =>
    `📖 <b>How ${BRAND} works</b>\n\n` +
    `<b>1. Top up your balance.</b> Two ways, your choice:\n\n` +
    `  • <b>In hryvnia</b> — pick an amount from the list, transfer it from a MonoBank or ` +
    `PrivatBank card and upload the receipt. ${payWindowMinutes} minutes for the transfer and ` +
    `the receipt together.\n` +
    `  • <b>In crypto</b> — send a TRON (TRC-20) transfer to the address the app shows you and ` +
    `paste the TxID. Minimum ${minUsdt} USDT.\n\n` +
    `<b>2. Create a sale.</b> Choose a bank (${banks}), enter the amount and send the link as ` +
    `the screen instructs. The USDT it needs is frozen on your balance while the sale is ` +
    `open.\n\n` +
    `<b>3. Wait for it to fill.</b> The status updates live, and how the sale ends depends on ` +
    `what you chose in step 2:\n\n` +
    `  • <b>Wait for the full amount</b> — the sale closes once the jar has reached its ` +
    `target.\n` +
    `  • <b>Return the remainder to your balance</b> (recommended) — as soon as less than ` +
    `${remainderUah} UAH is left to the target, the sale finishes on its own and the ` +
    `remainder comes back to your balance in USDT, at the rate it was created with.\n\n` +
    `<b>4. Close the jar.</b> When a sale is finished, close its jar in your banking app — ` +
    `while it is open the slot stays taken. Once the bank reports the jar closed, the slot is ` +
    `released automatically.\n\n` +
    `<b>5. Trust levels.</b> The more you turn over, the more sales you may run at once. Your ` +
    `level is on the home screen.\n\n` +
    `<b>6. Referrals.</b> Share the link from the Referrals section and you earn a percentage ` +
    `of what the people you invite turn over. It is kept separately and moved to your main ` +
    `balance in the app.\n\n` +
    `Still have a question? Press "Support".`
}

const DICTIONARIES: Readonly<Record<SupportLocale, SupportDictionary>> = {
  [SupportLocale.UK]: UK,
  [SupportLocale.RU]: RU,
  [SupportLocale.EN]: EN
}

export const dictionaryOf = (locale: SupportLocale): SupportDictionary => DICTIONARIES[locale]

/** Every dictionary, for code that has to look across all of them at once. */
export const ALL_DICTIONARIES: readonly SupportDictionary[] = Object.values(DICTIONARIES)

/**
 * Which language to speak to a user in.
 *
 * A hand-picked language always wins: Telegram reports the *client's* language,
 * so a Ukrainian with an English phone is told they are English on every single
 * message, and a preference that lost to that would be forgotten instantly.
 *
 * With no preference, the tag decides — it can be bare (`uk`) or full
 * (`en-GB`), so only the prefix is compared. English is the fallback for
 * everything else, on the grounds that a user we have no reading on is more
 * likely to get by in English than in a language chosen for them.
 */
export const resolveSupportLocale = (
  preferred: SupportLocale | null | undefined,
  languageCode: string | undefined
): SupportLocale => {
  if (preferred) return preferred

  const language = languageCode?.toLowerCase().split('-')[0]

  if (language === SupportLocale.UK) return SupportLocale.UK
  if (language === SupportLocale.RU) return SupportLocale.RU

  return SupportLocale.EN
}

export const supportUserText = (key: SupportUserText, locale: SupportLocale): string =>
  DICTIONARIES[locale].text[key]

/**
 * The guide, with every figure read from where the product enforces it.
 *
 * The deposit floor comes from contracts; the remainder threshold from
 * `TRANSACTO_MIN_ORDER_KOPECKS`, the same value `OrderMatcherService` settles
 * against and the same one the Mini App's remainder choice names; the bank list
 * from `SALE_ENABLED_BANKS`, which is what the create form filters its
 * picker with; the payment window from the variable the receipt endpoint
 * refuses on. All four are deployment- or product-configurable, and a number or
 * a bank name written into this file would be right until the day somebody
 * changed it and nowhere would say so. That is not hypothetical — the guide
 * offered Monobank for months after sales on it were switched off.
 */
export const supportGuideText = (locale: SupportLocale): string =>
  DICTIONARIES[locale].guide({
    minUsdt: MIN_USDT_AMOUNT,
    remainderUah: Math.round(
      transactoOrderFloorKopecks() / KOPECKS_PER_UAH
    ),
    banks: enabledBankNames(),
    payWindowMinutes: Number(environments.TMA_FIAT_PAY_WINDOW_MINUTES || '15')
  })

export const supportBalanceCard = (locale: SupportLocale, balance: SupportBalanceView): string =>
  DICTIONARIES[locale].balanceCard(balance)

export const supportCardOrderAwaitingText = (
  locale: SupportLocale,
  view: SupportCardOrderView
): string => DICTIONARIES[locale].cardOrderAwaiting(view)

export const supportCardOrderDisputedText = (
  locale: SupportLocale,
  view: SupportCardOrderView
): string => DICTIONARIES[locale].cardOrderDisputed(view)

export const supportFiatAmountsText = (
  locale: SupportLocale,
  view: SupportFiatAmountsView
): string => DICTIONARIES[locale].fiatAmountsAvailable(view)

export const supportInlineButtonLabel = (
  locale: SupportLocale,
  button: SupportInlineButton
): string => DICTIONARIES[locale].inlineButtons[button]

/**
 * Lines the bot posts into the support group.
 *
 * Ukrainian only, and not because translation was skipped — see the file
 * header. Each is a *function* where it names something, so the value is a
 * parameter rather than a sentence spliced together at the call site.
 */
/**
 * The word an alert tells operators to wait for before transferring.
 *
 * A module constant rather than a member read back off the object, because
 * {@link SupportAdminText.tailClaimed} needs it while that object is still
 * being defined — and because it is quoted in two places that must not drift:
 * the alert says what a successful answer looks like, and the answer opens with
 * it. If the two disagreed, the instruction would be to wait for something that
 * never arrives.
 */
const TAIL_TAKEN_MARK = '✅ Прийнято'

export const SupportAdminText = {
  /** Posted once into a brand-new topic, above the user's first message. */
  topicIntro: (name: string, username: string, telegramId: number): string =>
    `🆕 <b>Нове звернення</b>\n` +
    `Користувач: <a href="tg://user?id=${telegramId}">${name}</a>\n` +
    `Username: ${username || '—'}\n` +
    `Telegram ID: <code>${telegramId}</code>\n\n` +
    `Відповідайте прямо в цьому топіку — усе, що ви напишете, отримає користувач. ` +
    `<code>/close</code> — закрити топік (лишиться у списку із замком, відкриється сам на ` +
    `наступне повідомлення користувача).`,
  /** A thread nobody is mapped to — a topic created by hand, or a stale one. */
  UNLINKED_TOPIC:
    '⚠️ Цей топік не прив’язаний до жодного користувача, тому повідомлення не доставлено. ' +
    'Відповідати можна лише в топіках, які бот створив сам.',
  /**
   * Says what closing actually does, because the obvious reading is wrong.
   *
   * `closeForumTopic` locks a topic; it does not hide it. Telegram keeps it in
   * the group's topic list with a padlock, and the only thing the Bot API can
   * hide is the General topic. The first version of this line said "приховати",
   * and the first person to use it reasonably asked why the topic was still
   * there.
   */
  CLOSED_ACK:
    '🔒 Топік закрито: писати в нього більше не будуть, але Telegram лишає його у списку ' +
    'із замком — ховати топіки він не вміє. Відкриється сам, щойно користувач напише знову.',
  /** The user pressed Stop; nothing can reach them until they restart the bot. */
  USER_BLOCKED_BOT:
    '🚫 Повідомлення не доставлено: користувач заблокував бота. ' +
    'Він отримає відповідь лише після того, як сам розблокує чат.',
  USER_DEACTIVATED: '🚫 Повідомлення не доставлено: акаунт користувача видалено.',
  /** What the alert tells operators to wait for. See the constant above. */
  TAIL_TAKEN_MARK,
  /** The answer to a `+` that took a sale's tail on. */
  tailClaimed: (publicId: string, holdMinutes: number): string =>
    `${TAIL_TAKEN_MARK}: переказ за продажем ${publicId} закріплено за вами.\n` +
    `Продавець уже бачить цей ордер і не зможе завершити продаж достроково ` +
    `наступні ${Math.round(holdMinutes / 60)} год. Надходження він підтвердить сам.`,
  /** Somebody else got there first — which is ordinary, and not a failure. */
  TAIL_ALREADY_CLAIMED:
    'ℹ️ Цей переказ уже взяли раніше. Перевірте, хто саме, перш ніж переказувати — ' +
    'подвійний переказ нікому не повернуть.',
  /**
   * The one answer that means *do not transfer*: the sale has closed or filled,
   * so the money would land in an order that is already over.
   */
  TAIL_NOT_WAITING:
    '⚠️ Цей продаж більше не чекає переказу — його вже завершено або добрано. ' +
    'Не переказуйте: гроші підуть у закритий ордер.',
  /** Anything else. "Try again" rather than "no", because "no" costs a seller. */
  TAIL_CLAIM_FAILED:
    '⚠️ Не вдалося закріпити переказ. Спробуйте відповісти ще раз і не переказуйте, ' +
    'доки не буде підтвердження.'
} as const
