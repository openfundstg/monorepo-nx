---
name: angular-structure
description: Strict file placement and naming spec for this Angular app — where every file kind lives, its required suffix, and the api/service split. Use when creating a new module, page, component, service, guard, resolver, interceptor, pipe, directive, modal, enum, interface or constant, or when deciding where a file belongs or whether an existing path is compliant.
---

# Angular File Placement Spec

Every file kind has **exactly one** correct location and **exactly one** suffix. General coding
rules are in `CLAUDE.md` at the repo root; current non-compliance is tracked in `REFACTORING.md`.

---

## Application Shell

```
src/
├── index.html
├── styles.scss                  # global entry
├── styles/                      # _breakpoints.scss, _buttons.scss, … (@use, never @import)
├── fonts/
├── assets/i18n/                 # en.json · ru.json · uk.json  (ngx-translate)
├── environments/                # environment.ts · environment.prod.ts
└── app/
    ├── core/                    # app-wide singletons, provided once
    ├── shared/                  # reusable stateless building blocks
    └── <module>/                # one folder per logical module
```

### `core/` vs `shared/` vs `<module>/`

| Folder | Holds | Test |
|---|---|---|
| `core/` | App-wide singletons instantiated **once**: root interceptors, app bootstrap/session services, global error handling, app-level guards | "The app has exactly one of these, and it lives for the app's lifetime" |
| `shared/` | Stateless reusable pieces used by **two or more** modules: pipes, directives, dumb presentational components, pure utils, cross-module enums and interfaces | "It holds no state and any module could use it" |
| `<module>/` | Everything owned by one feature — the default home | "Only this feature uses it" |

Both `core/` and `shared/` use the same internal folder layout and suffixes as a module
(`services/`, `pipes/`, `interfaces/`, `enums/`, …) and the same `index.ts` barrels.

**Default to `<module>/`.** Promote to `shared/` only on the *second* consumer, and to `core/`
only when it must be a true app-wide singleton. `core/` and `shared/` are not dumping grounds:
a service with feature-specific business logic belongs in its module no matter how many places
call it — extract the shared *part* instead. `shared/` must never import from `core/` or from a
feature module.

---

## Module Layout

Create only the folders a module needs — but when a file of a given kind is needed, it goes
here, with this suffix:

```
app/<module>/
├── api/                 update-user.req.ts · update-user.res.ts
├── components/          reusable presentational components
├── pages/               routed views
├── services/
│   ├── <name>.api.service.ts    HTTP calls only
│   └── <name>.service.ts        business logic
├── enums/               <name>.enum.ts
├── interfaces/          <name>.interface.ts
├── constants/           <name>.const.ts
├── guards/              <name>.guard.ts
├── resolvers/           <name>.resolver.ts
├── interceptors/        <name>.interceptor.ts
├── pipes/               <name>.pipe.ts
├── directives/          <name>.directive.ts
├── modals/              <modal-name>/<modal-name>.modal.ts
└── routes.ts
```

| Folder | Suffix | Contents |
|---|---|---|
| `api/` | `.req.ts` / `.res.ts` | Request & response contracts — one pair per endpoint |
| `services/` | `.api.service.ts` | Thin HTTP functions only — no branching, no state |
| `services/` | `.service.ts` | Business logic, orchestration, signal state |
| `enums/` | `.enum.ts` | `enum` declarations **and** `const X = { … } as const` groups |
| `interfaces/` | `.interface.ts` | `interface` declarations, no `I` prefix |
| `constants/` | `.const.ts` | Plain constant values |
| `guards/` | `.guard.ts` | Functional `CanActivateFn` — never a class |
| `resolvers/` | `.resolver.ts` | Functional `ResolveFn` |
| `interceptors/` | `.interceptor.ts` | Functional `HttpInterceptorFn` |
| `pipes/` | `.pipe.ts` | Standalone, `pure: true` |
| `directives/` | `.directive.ts` | Standalone directives |
| `modals/` | `.modal.ts` | One folder per modal; three files like any component |
| `<module>/` | `routes.ts` | Lazily-loaded `Routes` for the module |

`components/` vs `pages/`: a **page** is reachable through a route in `routes.ts`; a
**component** is only ever used inside another template.

---

## The API Split

Two layers, never merged. `*.api.service.ts` performs the call and returns the `*.res.ts`
type — nothing else. `*.service.ts` owns every decision, transform and piece of state.
Components talk to `*.service.ts` only.

```ts
// api/sync-terminal.req.ts
export interface SyncTerminalReq { readonly terminalId: string }

// api/sync-terminal.res.ts
export interface SyncTerminalRes { readonly balance: number; readonly syncedAt: string }

// services/terminal.api.service.ts — transport only
@Injectable({ providedIn: 'root' })
export class TerminalApiService {
  private readonly http = inject(HttpClient);

  syncTerminal(req: SyncTerminalReq): Observable<SyncTerminalRes> {
    return this.http.post<SyncTerminalRes>(`${environment.apiUrl}/terminals/sync`, req);
  }
}

// services/terminal.service.ts — logic and state
@Injectable({ providedIn: 'root' })
export class TerminalService {
  private readonly api = inject(TerminalApiService);
  readonly isSyncing = signal(false);

  async syncTerminal(terminalId: string): Promise<void> {
    this.isSyncing.set(true);
    try {
      const res = await firstValueFrom(this.api.syncTerminal({ terminalId }));
      this.terminals.update(list => list.map(t =>
        t.terminalId === terminalId ? { ...t, balance: res.balance } : t
      ));
    } finally {
      this.isSyncing.set(false);
    }
  }
}
```

---

## Functional Building Blocks

```ts
// guards/auth.guard.ts
export const authGuard: CanActivateFn = () =>
  inject(AuthService).isAuthenticated() || inject(Router).createUrlTree(['/login']);

// resolvers/terminal.resolver.ts
export const terminalResolver: ResolveFn<Terminal> = route =>
  inject(TerminalService).byId(route.paramMap.get('id')!);

// interceptors/auth.interceptor.ts
export const authInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ setHeaders: { Authorization: `Bearer ${inject(AuthService).token()}` } }));
```

Register them in `app.config.ts` — `provideHttpClient(withInterceptors([authInterceptor]))` —
never as class providers.

---

## Routes

One `routes.ts` per module, lazily loaded from `app.routes.ts`:

```ts
// app/dashboard/routes.ts
export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
];

// app/app.routes.ts
export const routes: Routes = [
  { path: 'dashboard', loadChildren: () => import('./dashboard/routes').then(m => m.routes) },
];
```

---

## Components, Pages and Modals

Three files each — `.ts` + `.html` + `.scss` — in their own folder:

```
components/terminal-card/          pages/dashboard/            modals/confirm-sync/
├── terminal-card.component.ts     ├── dashboard.component.ts  ├── confirm-sync.modal.ts
├── terminal-card.component.html   ├── dashboard.component.html├── confirm-sync.modal.html
└── terminal-card.component.scss   └── dashboard.component.scss└── confirm-sync.modal.scss
```

Component styles stay in that component's `.scss`; anything shared moves to `src/styles/`.

---

## Placement Checklist

Before creating a file, confirm:

1. Which **module** does it belong to? Default to a named feature module; use `core/` only for
   app-wide singletons and `shared/` only once a second module needs it.
2. Which **folder** in the table above? Which **suffix**?
3. Is it a `enum` or `as const` group? → `enums/*.enum.ts`, never inline in a component.
4. Does it do HTTP? → `*.api.service.ts`, and nothing but the call.
5. Is it a component? → three files in its own folder.
6. Does it hardcode a URL, key or user-facing string? → `src/environments/*.ts` or
   `src/assets/i18n/*.json` instead.
