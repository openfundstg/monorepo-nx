# `@transacto/contracts` — Rules

The single source of truth for everything crossing the wire between `apps/api` and the two
frontends. Full rationale and migration status: [../../CONTRACTS.md](../../CONTRACTS.md).

## Hard constraints

1. **Plain TypeScript only.** No `@angular/*`, `@nestjs/*`, `mongoose`, `rxjs`, `socket.io`.
   This library must compile with bare `tsc` and is consumed by a CommonJS NestJS app *and*
   two ESM Angular apps. A framework import breaks one of them.
2. **Never import from an app.** `@nx/enforce-module-boundaries` fails the lint: `type:contracts`
   may depend only on `type:contracts`. The graph points inward.
3. **`.js` extensions on every relative import.** The package is `module: nodenext`, so
   `./lib/enums/order-status.enum` fails to resolve — it must be
   `./lib/enums/order-status.enum.js`, even though the file on disk is `.ts`.
4. **Everything is exported through `src/index.ts`.** Consumers import from the package root
   (`@transacto/contracts`), never a deep path.

## What belongs here

Enums whose values travel over the wire, WebSocket event names and their payloads, HTTP
request/response shapes, shared domain interfaces, and error codes.

**Not** here: Mongoose schemas (persistence, not contract), `class-validator` / `@ApiProperty`
decorators (they stay on the backend DTO class that `implements` the shared interface), UI
state, i18n strings.

## Conventions

- Enum members are SCREAMING_SNAKE_CASE — the backend owns these values and they travel as
  strings. (Frontend-local enums use PascalCase; these are different.)
- Grouped constants use `as const`.
- Interfaces are PascalCase with no `I` prefix.
- File suffixes: `*.enum.ts`, `*.interface.ts`, `*.contract.ts` for WS payload groups.

## Changing a contract

Because this is a monorepo, a contract change and both consumers land in the **same commit** —
there is no version to bump. If a rename breaks a consumer the build fails immediately, which
is the entire point. Verify with:

```bash
npx nx run-many -t build --all
```
