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
├── store/               <slice>.{state,actions,reducer,selectors,effects}.ts
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
| `store/` | `.state.ts` etc. | One NgRx slice — five files, never fewer |
| `<module>/` | `routes.ts` | Lazily-loaded `Routes` for the module |

`components/` vs `pages/`: a **page** is reachable through a route in `routes.ts`; a
**component** is only ever used inside another template.

---

## The API Split

Two layers, never merged. `*.api.service.ts` performs the call and returns the `*.res.ts`
type — nothing else. `*.service.ts` owns every decision, transform and piece of state.
Components talk to `*.service.ts` only.

```ts
// api/create-deposit.req.ts
export interface CreateDepositReq { readonly amount: number }

// api/create-deposit.res.ts
export interface CreateDepositRes { readonly depositId: string; readonly address: string }

// services/deposit.api.service.ts — transport only
@Injectable({ providedIn: 'root' })
export class DepositApiService {
  private readonly http = inject(HttpClient);

  createDeposit(req: CreateDepositReq): Observable<CreateDepositRes> {
    return this.http.post<CreateDepositRes>(`${environment.apiUrl}/deposits`, req);
  }
}

// services/deposit.service.ts — logic and state
@Injectable({ providedIn: 'root' })
export class DepositService {
  private readonly api = inject(DepositApiService);
  readonly isCreating = signal(false);

  async createDeposit(amount: number): Promise<CreateDepositRes> {
    this.isCreating.set(true);
    try {
      return await firstValueFrom(this.api.createDeposit({ amount }));
    } finally {
      this.isCreating.set(false);
    }
  }
}
```

---

## The Store

App-wide state is NgRx. A slice lives in the `store/` folder of the module that **owns the
data**, split five ways — one concern per file, always these names:

```
auth/store/            core/store/                    dashboard/store/
├── auth.state.ts        (the slice with no module    ├── trust.state.ts
├── auth.actions.ts       to own it lives in core/)   ├── trust.actions.ts
├── auth.reducer.ts     ├── rates.state.ts            ├── trust.reducer.ts
├── auth.selectors.ts   ├── rates.actions.ts          ├── trust.selectors.ts
└── auth.effects.ts     └── …                         └── trust.effects.ts
```

- The slice goes **beside the api service that fills it** — `auth/store/` uses
  `auth/services/auth.api.service.ts`. Only a slice no feature owns (`rates`) belongs in
  `core/store/`, and it is flat there rather than nested in a folder of its own.
- **`state.ts` exports the interface, the `*_FEATURE` key and `initial*State`.** The feature key
  is what `provideStore` and `createFeatureSelector` both read; there is no second copy of it.
- **Derived state is a selector, never a `computed` in a component.** Anything spanning two
  slices — how far along a rung a turnover is — is a selector too, and lives with the slice that
  is doing the deriving.
- **Effects are functional**: `createEffect(() => …, { functional: true })`, exported
  individually and re-exported as one `<name>Effects` object for `provideEffects`.
- **Where a slice is registered** decides what it costs. App-wide slices go in `app.config.ts`
  via `provideStore`; a slice only one module reads is registered by that module's `routes.ts`
  with `provideState` + `provideEffects`, so a screen nobody opens costs no reducer.
- Components read with `store.selectSignal(...)` and write with `store.dispatch(...)`. A
  component never subscribes to a selector by hand.

Feature-local state — a form's fields, which step a wizard is on, a file being uploaded — stays
in component signals. The store is for what outlives one screen.

---

## Functional Building Blocks

```ts
// guards/auth.guard.ts
export const authGuard: CanActivateFn = () =>
  inject(TmaService).isAuthenticated() || inject(Router).createUrlTree(['/login']);

// resolvers/sale.resolver.ts
export const saleResolver: ResolveFn<TmaSale> = (route) =>
  inject(SaleService).getOrder(route.paramMap.get('id')!);

// interceptors/tma-auth.interceptor.ts
export const tmaAuthInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ setHeaders: { 'X-Tma-Init-Data': inject(TmaService).initData() } }));
```

Register them in `app.config.ts` — `provideHttpClient(withInterceptors([tmaAuthInterceptor]))` —
never as class providers.

---

## Routes

One `routes.ts` per module, lazily loaded from `app.routes.ts`:

```ts
// app/settings/routes.ts
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/settings/settings.component').then(m => m.SettingsComponent),
  },
];

// app/app.routes.ts
export const routes: Routes = [
  { path: 'settings', loadChildren: () => import('./settings/routes').then(m => m.routes) },
];
```

The wildcard `{ path: '**', redirectTo: '' }` stays last in `app.routes.ts`. A module whose
`loadChildren` entry is missing does not error — it falls through the wildcard and silently
redirects to the dashboard, so the page looks alive in the source and is unreachable in the app.
That has already happened here once.

---

## Components, Pages and Modals

Three files each — `.ts` + `.html` + `.scss` — in their own folder:

```
shared/components/bottom-nav/     pages/settings/               modals/confirm-deposit/
├── bottom-nav.component.ts       ├── settings.component.ts     ├── confirm-deposit.modal.ts
├── bottom-nav.component.html     ├── settings.component.html   ├── confirm-deposit.modal.html
└── bottom-nav.component.scss     └── settings.component.scss   └── confirm-deposit.modal.scss
```

Component styles stay in that component's `.scss`; anything shared moves to `src/styles/`.

---

## Placement Checklist

Before creating a file, confirm:

1. Which **module** does it belong to? Default to a named feature module; use `core/` only for
   app-wide singletons and `shared/` only once a second module needs it.
1. Is it state two screens read? → a slice in that module's `store/`, not a signal in one of
   them.
2. Which **folder** in the table above? Which **suffix**?
3. Is it a `enum` or `as const` group? → `enums/*.enum.ts`, never inline in a component.
4. Does it do HTTP? → `*.api.service.ts`, and nothing but the call.
5. Is it a component? → three files in its own folder.
6. Does it hardcode a URL, key or user-facing string? → `src/environments/*.ts` or
   `src/assets/i18n/*.json` instead. A new translation key goes into **all three** dictionaries
   in the same commit; `app/shared/i18n.spec.ts` fails `nx test` if they drift apart.
