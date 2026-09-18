# Transacto — Nx Monorepo

All workspace rules, project layout, contract ownership, commands and gotchas are in
**[CLAUDE.md](./CLAUDE.md)**.

Read it, plus the `CLAUDE.md` of the project you are touching, before generating or reviewing
any code:

- `apps/api/CLAUDE.md` — NestJS backend
- `apps/monobank-extension/CLAUDE.md` — Angular Chrome extension
- `apps/telegram-mini-app/CLAUDE.md` — Angular Telegram Mini App
- `CONTRACTS.md` — the shared `@transacto/contracts` library

## One rule that does not wait for you to read the rest

**No real personal or financial data is ever committed.** Not in a fixture, a test, a doc
comment, an example or a sample log line. Real means captured from an actual person or an
actual bank response: a name or patronymic, a card number — whole **or** masked — an IBAN, a
tax number, a receipt or transaction code, a phone, an email, an address, a token, a password.

Use invented values that still satisfy whatever the code checks: Luhn-valid fake cards, format-
valid fake IBANs, invented names. A third-party payload is captured as *structure, never its
values*.

It is stated first here because it is the only rule in this repository whose violation cannot be
fixed by a later commit. A value pushed once is disclosed, and removing it costs a rewrite of
every commit and a force-push — which has now happened. Two things enforce it:
`apps/api/src/shared/no-real-data.spec.ts` fails the build on an undeclared card, masked card,
IBAN or tax number, and CHECK 8 of `strict-reviewer` covers names, which no scanner can.

Full rule, and what to do when the check fires: **[CLAUDE.md](./CLAUDE.md)**, *Real data never
lives in the repository*.
