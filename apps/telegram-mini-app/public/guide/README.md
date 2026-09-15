# Bank setup screenshots

Drop the screenshots for the sale create guide here. Each file is
referenced by `app/sale/constants/bank-guide.const.ts` and rendered by
`BankInstructionsComponent`.

**Nothing breaks while a file is missing.** The component listens for the
image's `error` event and swaps in a dashed "Screenshot coming soon" box, so the
guide is readable today and the picture appears the moment you add the file. No
code change is needed when you do — the paths below are already wired.

## Expected files

One folder per bank, one numbered file per step — `guide/<Bank>/<N>.jpg`, where
`N` is the step's position in that bank's `steps` array. Renumbering the steps
means renumbering the files and nothing else.

| Folder | Steps | What they show |
|---|---|---|
| `Mono/` | `1.jpg` – `6.jpg` | Creating a jar (банка), its «Віджети для стрімів» section, copying the stream-widget link, where the jar's own card number is |
| `Privat/` | `1.jpg` – `4.jpg` | Creating an envelope (конверт), naming it and setting its goal, checking the goal, copying the link and the envelope's card |
| `PUMB/` | `1.jpg` – `7.jpg` | Creating a moneybox (манібокс), naming it, its goal, opening it, sharing it, and copying the link and card |
| `NovaPay/` | `1.jpg` – `5.jpg` | See below — one file per screen of the app's own flow |

PUMB used to need two screenshots showing a browser address bar. The scraper
reads the `box_id` query parameter, which the shared `mobile-app.pumb.ua` link
does not carry — so users were told to open the link in a browser and copy the
address by hand. `DropLinkResolverService` now follows that redirect
server-side, so the manual route survives as one line of fallback text under the
steps and needs no screenshot.

NovaPay's five files map one-to-one onto the screens of its flow:

| File | Screen |
|---|---|
| `1.jpg` | «Накопичення», the «Кейс» block, «Створити кейс» |
| `2.jpg` | Naming the Case — the name field, the description, «Продовжити» |
| `3.jpg` | «Обери тип Кейсу» with «Із цільовою сумою» picked, «Вкажи розмір Кейсу» filled, and «Створити Кейс» at the foot |
| `4.jpg` | The Case screen, with «Поширити» |
| `5.jpg` | «Поширити кейс» — the «Закинути на Кейс за посиланням» row |

There is deliberately no picture of the «Створюємо Кейс» screen that sits between
3 and 4: it is a spinner, so there is nothing on it to do and nothing to show.
The share *preview* — the card with «Відправити» — is not one of these either;
it is for sending the case to somebody, and the step here is copying the link.

**NovaPay needs no card screenshot at all**, unlike the other three: a case
publishes its card in full, so the form fills that field in and the user cannot
edit it. The share sheet's «Закинути на Кейс за номером» row is deliberately not
one of the six — showing it would invite users to copy a number the form does
not want, and its value is a payment credential that must not ship in a
screenshot.

## Guidance

- **Format:** JPEG, named by step number inside the bank's folder — see the table.
- **Aspect:** portrait phone screenshots. They render at up to 260px wide with
  `height: auto`, so any phone aspect ratio works; keep them consistent so the
  steps do not jump about as the guide scrolls.
- **Redact** balances, card numbers, names and phone numbers before committing.
  These ship to every user in the production bundle.
- **Size:** keep each under ~150 KB. They are served from the app's own origin
  and lazily loaded (`loading="lazy"`), but the production build has a 500 kB
  initial-bundle budget and these count against transfer on a mobile connection.

## Adding a step

Add an entry to the bank's `steps` array in `bank-guide.const.ts` with its
`textKey` and image path, then add that key to all three dictionaries in
`src/assets/i18n/`. `app/shared/i18n.spec.ts` derives its expectation from the
constant, so a step with no translation fails `nx test telegram-mini-app`.
