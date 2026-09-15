# `@transacto/history-table`

The terminal history table, shared by the Chrome extension and the admin panel.

**Consumed from source, not built.** Both consumers are Angular apps in this
repo, so the `@transacto/source` export condition points at `src/index.ts` and
each app's own compiler builds it. There is no `dist`, no ng-packagr and no
build target — those exist to publish a library, and this one is never published.

## Why it is a library

The two apps must show this table _identically_: it is the same scraper audit
trail, read by a trader about their own jar and by an operator about anybody's.
Two copies would be two implementations of the same six columns and the same
badge rules, and "identical" would survive exactly until the first change to
either.

## What belongs here, and what does not

**Here:** the table, its rows, the money cells and their movement arrows, the
badge colours and labels. Everything that decides _how a history row looks_.

**Not here:** where the rows come from. The extension loads them for its own
trader over its own socket; the panel loads anybody's over a different one. The
component takes `logs` and renders them — it fetches nothing, subscribes to
nothing, and knows about neither app.

That split is what lets one component serve both without either app leaking into
the other, which the module boundaries forbid anyway (`scope:extension` and
`scope:admin` can only meet in `scope:shared`).

## Translation keys

The component renders keys, never sentences — `HISTORY.TABLE.*`,
`HISTORY.ORDER.*`, `HISTORY.ALERT.*` and `ALERTS.*_DESC`. **Each consuming app
supplies them in its own dictionaries**, because the library has no dictionary
of its own and `ngx-translate` is configured per app. An app missing a key
renders the key, which is the feedback that gets it written.
