---
name: create-endpoint
description: Step-by-step runbook for adding a NestJS endpoint — request/response DTOs, DB service, business service, controller, access decorators, module registration, error codes. Use when adding, changing, or reviewing any HTTP endpoint in src/modules/**.
---

# Runbook: Create a New NestJS Endpoint

Follow these steps in order. Do not skip steps or merge responsibilities across layers.
General project rules are in `CLAUDE.md` at the repo root.

---

## Step 1 — Define the request DTO; type the response from contracts

Create one file in `src/modules/{domain}/dto/`: `{action}.req.dto.ts`, the incoming payload.

**There is no response DTO class and no Swagger.** `@nestjs/swagger` is not installed in this
workspace — `@ApiProperty` fails the build — and the response shape is a wire contract, so it
lives in `@transacto/contracts` and the handler returns it directly. A `.res.dto.ts` would be a
second declaration of a type the frontends already import.

**Rules:**
- The class `implements` the request interface from `@transacto/contracts`.
- Every field must be `readonly`.
- Every field must have a `class-validator` decorator (`@IsString()`, `@IsInt()`, `@IsEnum()`, …).
  **A property with no decorator is silently stripped** by the global `ValidationPipe`
  (`whitelist: true`), and any unexpected property in the payload is a `400`.
- Nested objects require `@ValidateNested()` and `@Type(() => NestedClass)`.
- Document units and intent in a doc comment — that is what the missing `@ApiProperty` used to
  pretend to do.

```typescript
// create-fiat-deposit.req.dto.ts
import { KOPECKS_PER_UAH, type CreateFiatDepositReq } from '@transacto/contracts'

export class CreateFiatDepositReqDto implements CreateFiatDepositReq {
  /** UAH kopecks, e.g. `170600` for ₴1 706. */
  @IsInt()
  @Min(KOPECKS_PER_UAH)
  readonly amountUah: number
}
```

Validate the **shape** here and the **rule** in the service: a floor enforced in the DTO answers
with a bare validation message, where the service can throw an `ERROR` code the client
translates. `CreateDepositDto`'s `@Min(0)` next to `MIN_USDT_AMOUNT` in the facade is the
pattern.

---

## Step 2 — Implement the DB Service method

Add the Mongoose query to the repository module —
`src/modules/repositories/{domain}-db/services/{domain}-db.service.ts`.

- This is the **only** place a query may live. Never add one to a domain module.
- No business logic here — only the database operation.
- Use generics for flexible return types where appropriate.
- Export it from `services/index.ts`; export any new interface from `interfaces/index.ts`.

```typescript
// src/modules/repositories/order-db/services/order-db.service.ts
@Injectable()
export class OrderDbService {
  constructor(@InjectModel(Order.name) private readonly orderModel: Model<Order>) {}

  async create(data: Partial<Order>): Promise<Order> {
    return this.orderModel.create(data)
  }

  async findById<T = Order>(id: Types.ObjectId): Promise<T | null> {
    return this.orderModel.findById(id).lean()
  }
}

// src/modules/repositories/order-db/services/index.ts
export * from './order-db.service'
```

If the collection is new, add `schemas/{domain}.schema.ts` and register it in
`{domain}-db.module.ts`:

```typescript
@Module({
  imports: [MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }])],
  providers: [OrderDbService],
  exports: [OrderDbService]
})
export class OrderDbModule {}
```

---

## Step 3 — Implement the Business Service method

Add the orchestration logic to `src/modules/{domain}/services/{domain}.service.ts`.

- Inject the DB service from the repository module, via its barrel:
  `import { OrderDbService } from 'src/modules/repositories/order-db/services'`.
- No `Model.find()` / `Model.aggregate()` / `Model.create()` calls here — and no
  `mongoose` / `@nestjs/mongoose` import anywhere in a domain module.
- Third-party HTTP goes in a sibling `{domain}.api.service.ts`, which does the call and
  nothing else; this service makes the decisions.
- Use `ensure()` for null-checks instead of manual `if (!x) throw`.
- Use `Promise.all()` for independent async operations.
- Use `try/finally` if acquiring a Redis lock.
- All errors via NestJS HTTP exceptions with `ERROR` constant codes.

```typescript
// order.service.ts
async createOrder(user: User, dto: CreateOrderReqDto): Promise<CreateOrderResDto> {
  const idempotencyKey = `order:idempotency:${user._id}:${this.hashPayload(dto)}`
  const cached = await this.redis.get(idempotencyKey)
  if (cached) return JSON.parse(cached)

  const lockKey = `${idempotencyKey}:lock`
  const acquired = await this.redis.set(lockKey, '1', 'PX', 10000, 'NX')
  if (!acquired) throw new ConflictException(ERROR.ORDER.DUPLICATE_REQUEST)

  try {
    const [products, promoCode] = await Promise.all([
      this.productDbService.findManyByIds(dto.cart.map(i => i.productId)),
      dto.promoCode ? this.promoCodeService.findByCode(dto.promoCode) : Promise.resolve(null)
    ])

    const order = await this.orderDbService.create({ userId: user._id, ...dto })
    const result: CreateOrderResDto = { orderId: order._id.toString(), paymentUrl: '...' }

    await this.redis.set(idempotencyKey, JSON.stringify(result), 'EX', 600)
    return result
  } finally {
    await this.redis.del(lockKey)
  }
}
```

---

## Step 4 — Add the Controller method

Add the endpoint to `src/modules/{domain}/{domain}.controller.ts`.

**Rules:**
- No business logic or `if`-branches — delegate entirely to the service.
- Always set `@HttpCode()` for non-GET methods.
- Always type the return as `Promise<ResponseDto>`.
- Use `@Res({ passthrough: true })` only when setting cookies or headers.

```typescript
@Post()
@HttpCode(HttpStatus.CREATED)
@UserTypeTMA()
async reserve(
  @Req() req: TmaAuthenticatedRequest,
  @Body() dto: CreateFiatDepositReqDto
): Promise<TmaFiatDeposit> {
  return this.fiatDeposits.reserve(req.tmaUser.id, dto.amountUah)
}
```

### If the endpoint takes a file

`FileInterceptor` works — multer is present through `@nestjs/platform-express` — but
**`@types/multer` is not installed**, so `Express.Multer.File` does not exist. Declare the
fields you read as a local interface rather than adding a types package for one parameter, and
set the size limit twice: on the interceptor, so a phone does not stream ten megabytes into
memory before anything looks at it, and in the service, where it holds for every caller.

```typescript
interface UploadedReceipt {
  readonly buffer: Buffer
  readonly originalname: string
  readonly mimetype: string
}

@Post(':id/receipts')
@UserTypeTMA()
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: FIAT_RECEIPT_MAX_BYTES } }))
async uploadReceipt(
  @Param('id') id: string,
  @UploadedFile() file: UploadedReceipt
): Promise<TmaFiatDeposit> { … }
```

---

## Step 5 — Apply the correct access decorators

The global guard execution order is fixed: **SessionOrApiKeyGuard → CsrfGuard → UserTypesGuard**.

Choose the appropriate decorator combination:

| Scenario | Decorator(s) |
|---|---|
| Authenticated trader only | `@UserTypeTrader()` |
| Authenticated Telegram Mini App user only | `@UserTypeTMA()` |
| More than one user type may call it | `@UserTypes(UserType.TRADER, UserType.TMA)` |
| Public, no auth | `@Public()` |
| Webhook / OAuth callback (skip CSRF) | `@SkipCsrf()` |
| Public webhook | `@Public()` + `@SkipCsrf()` |

Every endpoint carries exactly one access decorator — there is no implicit default.

---

## Step 6 — Register in the module

The domain module **imports the repository module** — it never registers a schema itself:

```typescript
@Module({
  imports: [OrderDbModule],
  providers: [OrderService, OrderApiService],
  controllers: [OrderController],
  exports: [OrderService]
})
export class OrderModule {}
```

`MongooseModule.forFeature()` belongs in `{domain}-db.module.ts` only (Step 2).

---

## Step 7 — Error codes

If a new error domain is needed, add a new block to `libs/contracts/src/lib/constants/errors.ts` numbered in increments of 100. `ERROR` is owned by contracts, not the backend:

```typescript
export const ERROR = {
  // ... existing domains
  NEW_DOMAIN: {
    NOT_FOUND:      { code: 2300, message: 'Resource not found' },
    ALREADY_EXISTS: { code: 2301, message: 'Resource already exists' }
  }
} as const
```

---

## Step 8 — Review

When finished, run the `strict-reviewer` agent over every file you created or modified.

---

## Related runbooks

- Talking to the Transacto operator panel — its session, its HTML tables, and the rules that
  cost money if broken → the `transacto-panel` skill.
- An endpoint the admin panel consumes, with an audited operator action → the `admin-feature`
  skill in `apps/admin/`.
