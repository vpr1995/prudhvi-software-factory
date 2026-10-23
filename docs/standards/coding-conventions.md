# Coding Conventions

## Purpose

This document sets the coding rules for this repo. Agents and humans must follow these rules. Each rule has at least one enforcer.

## Document rules

- This document is a gate file. A change needs approval from a human. See `docs/standards/gates.md`.
- Each convention has an enforcer. A convention with no tool enforcer is checked by the AI reviewer. Such entries are listed in `REVIEW.md` under "Conventions with no tool enforcer".
- An enforcer marked "(planned)" is not yet active. Do not treat it as a working gate.
- To change a rule, open a PR that changes this file. Do not add an inline disable to pass a check.

## How to read each entry

Each rule has four parts:

- **Rule:** the convention to follow.
- **Good:** an example that follows the rule.
- **Bad:** an example that breaks the rule.
- **Enforcer:** the tool, CI check, or `REVIEW.md` entry that finds a violation.

---

## A. Naming

### A.1 Variables and parameters

**Rule:** Name variables and parameters in camelCase.

**Good:**

```ts
const orderTotal = 42;

export function applyDiscount(userId: string, discountRate: number): number {
  return orderTotal * discountRate;
}
```

**Bad:**

```ts
const order_total = 42;

export function apply_discount(user_id: string, DiscountRate: number): number {
  return order_total * DiscountRate;
}
```

**Enforcer:** `@typescript-eslint/naming-convention`.

### A.2 Functions and methods

**Rule:** Name functions and methods in camelCase. Start each name with a verb.

**Good:**

```ts
export function getUser(userId: string): Promise<UserProfile | undefined> {
  return userRepository.findById(userId);
}

export function calculateTax(orderTotal: number): number {
  return orderTotal * TAX_RATE;
}
```

**Bad:**

```ts
export function user(userId: string): Promise<UserProfile | undefined> {
  return userRepository.findById(userId);
}

export function Tax_Calc(orderTotal: number): number {
  return orderTotal * TAX_RATE;
}
```

**Enforcer:** `@typescript-eslint/naming-convention` checks camelCase. The verb-first check is in `REVIEW.md` ("Conventions with no tool enforcer").

### A.3 Booleans

**Rule:** Name boolean variables with the prefix `is`, `has`, `should`, or `can`.

**Good:**

```ts
const isActive = true;
const hasAccess = false;
```

**Bad:**

```ts
const active = true;
const access = false;
```

**Enforcer:** `@typescript-eslint/naming-convention` with `types: ['boolean']`.

### A.4 Types, interfaces, and classes

**Rule:** Name types, interfaces, and classes in PascalCase. Do not add an `I` or `T` prefix.

**Good:**

```ts
export type UserProfile = {
  readonly userId: string;
  readonly displayName: string;
};

export class OrderService {}
```

**Bad:**

```ts
export type IUserProfile = {
  readonly userId: string;
  readonly displayName: string;
};

export class orderService {}
```

**Enforcer:** `@typescript-eslint/naming-convention`.

### A.5 React components

**Rule:** Name React components in PascalCase.

**Good:**

```tsx
export function OrderSummary(props: OrderSummaryProps): React.JSX.Element {
  return <section>{props.orderId}</section>;
}
```

**Bad:**

```tsx
export function orderSummary(props: OrderSummaryProps): React.JSX.Element {
  return <section>{props.orderId}</section>;
}
```

**Enforcer:** `@typescript-eslint/naming-convention` and `react/jsx-pascal-case`.

### A.6 React hooks

**Rule:** Name custom hooks in camelCase with the `use` prefix.

**Good:**

```ts
export function useOrderTotal(orderId: string): number {
  const [total] = useState(0);
  return total;
}
```

**Bad:**

```ts
export function orderTotal(orderId: string): number {
  const [total] = useState(0);
  return total;
}
```

**Enforcer:** `react-hooks/rules-of-hooks` reports a hook call in a function without the `use` prefix.

### A.7 Module-level constants

**Rule:** Name module-level primitive constants in UPPER_SNAKE_CASE. Name module-level objects and functions in camelCase.

**Good:**

```ts
const MAX_RETRY_COUNT = 3;

const orderStatus = {
  open: 'open',
  paid: 'paid',
} as const;
```

**Bad:**

```ts
const maxRetryCount = 3;

const ORDER_STATUS = {
  open: 'open',
  paid: 'paid',
} as const;
```

**Enforcer:** `@typescript-eslint/naming-convention`.

### A.8 Zod schemas and inferred types

**Rule:** Name a Zod schema in PascalCase with a `Schema` suffix. Name its inferred type with the same name, without the suffix.

**Good:**

```ts
import { z } from 'zod';

export const CreateOrderSchema = z.object({
  productId: z.string().min(1),
});

export type CreateOrder = z.infer<typeof CreateOrderSchema>;
```

**Bad:**

```ts
import { z } from 'zod';

export const createOrder = z.object({
  productId: z.string().min(1),
});

export type CreateOrderType = z.infer<typeof createOrder>;
```

**Enforcer:** Custom rule in `tooling/eslint-config` (planned).

### A.9 Generic type parameters

**Rule:** Name generic type parameters in PascalCase. Use a descriptive name. A `T` prefix is allowed.

**Good:**

```ts
export function firstItem<TItem>(items: readonly TItem[]): TItem | undefined {
  return items[0];
}
```

**Bad:**

```ts
export function firstItem<item>(items: readonly item[]): item | undefined {
  return items[0];
}
```

**Enforcer:** `@typescript-eslint/naming-convention`.

### A.10 Files and folders

**Rule:** Name files and folders in kebab-case.

**Good:**

```text
src/features/orders/order-summary.tsx
src/domain/get-user.ts
```

**Bad:**

```text
src/features/orders/OrderSummary.tsx
src/domain/getUser.ts
src/domain/get_user.ts
```

**Enforcer:** `unicorn/filename-case`.

### A.11 Test files

**Rule:** Place each unit test next to its source file as `<file>.test.ts` or `<file>.test.tsx`. Place end-to-end tests in `e2e/*.spec.ts`.

**Good:**

```text
src/domain/get-user.ts
src/domain/get-user.test.ts
web/e2e/order-page.spec.ts
```

**Bad:**

```text
src/domain/getUser.ts
src/domain/__tests__/getUser.js
```

**Enforcer:** The vitest `include` glob in `tooling/vitest-config`, and `scripts/gates/check-gates.mjs`.

### A.12 Environment variables

**Rule:** Name each environment variable in UPPER_SNAKE_CASE. Start each name with the project prefix.

**Good:**

```ts
// src/api/config.ts
const envSchema = z.object({
  SAMPLE_API_DB_URL: z.string().url(),
});
```

**Bad:**

```ts
// src/api/config.ts
const envSchema = z.object({
  DB_URL: z.string().url(),
  sampleApiDbUrl: z.string().url(),
});
```

**Enforcer:** The Zod env schema in `config.ts` (a missing or invalid variable fails at start). The prefix check is in `REVIEW.md` ("Conventions with no tool enforcer").

### A.13 API paths

**Rule:** Use kebab-case, plural nouns, and a version prefix in API paths.

**Good:**

```ts
app.get('/v1/order-items/:orderItemId', getOrderItemRoute);
```

**Bad:**

```ts
app.get('/getOrderItem/:id', getOrderItemRoute);
app.get('/v1/orderItem/:id', getOrderItemRoute);
app.get('/order_items/:id', getOrderItemRoute);
```

**Enforcer:** Custom lint rule on route registration (planned) and the contract test.

### A.14 JSON fields in the API

**Rule:** Use camelCase for each JSON field name in an API contract.

**Good:**

```ts
// src/contracts/order.ts
export const OrderSchema = z.object({
  orderId: z.string(),
  createdAt: z.string().datetime(),
});
```

**Bad:**

```ts
// src/contracts/order.ts
export const OrderSchema = z.object({
  order_id: z.string(),
  created_at: z.string(),
});
```

**Enforcer:** The Zod schemas in `src/contracts` and the contract tests. The field-case check is in `REVIEW.md` ("Conventions with no tool enforcer").

### A.15 CDK construct IDs

**Rule:** Use PascalCase for each CDK construct ID.

**Good:**

```ts
new s3.Bucket(this, 'AssetsBucket', {
  encryption: s3.BucketEncryption.S3_MANAGED,
});
```

**Bad:**

```ts
new s3.Bucket(this, 'assets-bucket', {
  encryption: s3.BucketEncryption.S3_MANAGED,
});
```

**Enforcer:** Custom lint rule for infra (planned).

### A.16 AWS resource names

**Rule:** Do not set physical names on AWS resources. Let CDK generate the names.

**Good:**

```ts
new s3.Bucket(this, 'AssetsBucket', {
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
});
```

**Bad:**

```ts
new s3.Bucket(this, 'AssetsBucket', {
  bucketName: 'sample-assets-prod',
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
});
```

**Enforcer:** cdk-nag and a custom rule (planned).

### A.17 Branch names

**Rule:** Name each branch `<type>/<short-kebab>`, where `<type>` is a Conventional Commits type.

**Good:**

```text
feat/order-export
fix/login-redirect
```

**Bad:**

```text
order-export
feature/OrderExport
john-work
```

**Enforcer:** Branch-name check in `commit-msg` or CI (planned). See `docs/standards/git-workflow.md`.

### A.18 Abbreviations

**Rule:** Write full words. Use only these abbreviations: `id`, `url`, `api`, `db`, `env`, `config`.

**Good:**

```ts
const userId = 'user-1';
const requestUrl = new URL('https://example.com/v1/orders');
```

**Bad:**

```ts
const uid = 'user-1';
const reqUrl = new URL('https://example.com/v1/orders');
const cfg = loadConfig();
```

**Enforcer:** `unicorn/prevent-abbreviations` with the allowlist.

---

## B. Types and language

### B.1 Use `type`, not `interface`

**Rule:** Declare object shapes with `type`. Do not use `interface`.

**Good:**

```ts
export type UserProfile = {
  readonly userId: string;
  readonly displayName: string;
};
```

**Bad:**

```ts
export interface UserProfile {
  userId: string;
  displayName: string;
}
```

**Enforcer:** `@typescript-eslint/consistent-type-definitions` set to `type`.

### B.2 No TypeScript enums

**Rule:** Do not use `enum`. Use an `as const` object and a union type.

**Good:**

```ts
export const OrderStatus = {
  Open: 'open',
  Paid: 'paid',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
```

**Bad:**

```ts
export enum OrderStatus {
  Open = 'open',
  Paid = 'paid',
}
```

**Enforcer:** `no-restricted-syntax` on `TSEnumDeclaration`.

### B.3 No `any`

**Rule:** Do not use `any`. Use `unknown` and narrow the type.

**Good:**

```ts
export function readName(input: unknown): string {
  return NameSchema.parse(input).name;
}
```

**Bad:**

```ts
export function readName(input: any): string {
  return input.name;
}
```

**Enforcer:** `@typescript-eslint/no-explicit-any`.

### B.4 No non-null assertions

**Rule:** Do not use the non-null assertion `!`. Narrow the value, or throw an error for a broken invariant.

**Good:**

```ts
const user = users.get(userId);
if (user === undefined) {
  throw new Error(`invariant: user ${userId} is missing from the index`);
}
```

**Bad:**

```ts
const user = users.get(userId)!;
```

**Enforcer:** `@typescript-eslint/no-non-null-assertion`.

### B.5 No type casts except `as const`

**Rule:** Do not use `as` to cast a type. The only allowed form is `as const`.

**Good:**

```ts
const ROLES = ['admin', 'viewer'] as const;
const user = UserSchema.parse(raw);
```

**Bad:**

```ts
const user = raw as User;
```

**Enforcer:** `@typescript-eslint/consistent-type-assertions` with `assertionStyle: 'never'`. The `as const` form stays allowed.

### B.6 Explicit return types on exports

**Rule:** Write an explicit return type on each exported function.

**Good:**

```ts
const TAX_RATE = 0.2;

export function calculateTax(orderTotal: number): number {
  return orderTotal * TAX_RATE;
}
```

**Bad:**

```ts
const TAX_RATE = 0.2;

export function calculateTax(orderTotal: number) {
  return orderTotal * TAX_RATE;
}
```

**Enforcer:** `@typescript-eslint/explicit-module-boundary-types`.

### B.7 Type-only imports

**Rule:** Use `import type` for each import that is only a type.

**Good:**

```ts
import type { CreateOrder } from '../contracts/index.js';
```

**Bad:**

```ts
import { CreateOrder } from '../contracts/index.js';
```

**Enforcer:** `@typescript-eslint/consistent-type-imports`. The `verbatimModuleSyntax` option in `tooling/tsconfig` also enforces this.

### B.8 Named exports only

**Rule:** Use named exports. Use a default export only where Next.js requires one (`page.tsx`, `layout.tsx`, `route.ts`, and config files).

**Good:**

```ts
export function formatPrice(amountInCents: number): string {
  return `$${(amountInCents / 100).toFixed(2)}`;
}
```

**Bad:**

```ts
export default function formatPrice(amountInCents: number): string {
  return `$${(amountInCents / 100).toFixed(2)}`;
}
```

**Enforcer:** `import-x/no-default-export`, with overrides for the Next.js files.

### B.9 No barrel files

**Rule:** Do not add an `index.ts` that re-exports other modules. The only exception is the `index.ts` at the root of a package.

**Good:**

```ts
import { getUser } from './get-user.js';
```

**Bad:**

```ts
// routes/user/index.ts
export * from './get-user.js';
export * from './list-users.js';
```

**Enforcer:** Custom rule or `no-restricted-imports` (planned).

### B.10 Import order

**Rule:** Order imports as: Node built-ins, external packages, `@vprprudhvi/shared-*`, own project, then relative paths. Put one blank line between groups.

**Good:**

```ts
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { createLogger } from '@vprprudhvi/shared-logger';

import { CreateOrderSchema } from '../contracts/index.js';

import { calculateTax } from './calculate-tax.js';
```

**Bad:**

```ts
import { calculateTax } from './calculate-tax.js';
import { CreateOrderSchema } from '../contracts/index.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
```

**Enforcer:** `import-x/order`.

### B.11 `const` by default

**Rule:** Use `const` by default. Use `let` only when the code reassigns the value. Do not use `var`.

**Good:**

```ts
const total = sumLineItems(items);

let attempt = 0;
while (attempt < MAX_RETRY_COUNT) {
  attempt += 1;
}
```

**Bad:**

```ts
var total = sumLineItems(items);

let limit = 10;
console.log(limit);
```

**Enforcer:** `prefer-const` and `no-var`.

### B.12 `async` and `await`

**Rule:** Use `async` and `await` for promises. Do not use `.then()` chains.

**Good:**

```ts
export async function getUser(userId: string): Promise<UserProfile | undefined> {
  const row = await userRepository.findById(userId);
  return row;
}
```

**Bad:**

```ts
export function getUser(userId: string): Promise<UserProfile | undefined> {
  return userRepository.findById(userId).then((row) => row);
}
```

**Enforcer:** `promise/prefer-await-to-then`.

### B.13 Readonly data

**Rule:** Mark props and array fields in exported types as `readonly`.

**Good:**

```ts
export type OrderSummaryInput = {
  readonly orderId: string;
  readonly lineItems: readonly LineItem[];
};
```

**Bad:**

```ts
export type OrderSummaryInput = {
  orderId: string;
  lineItems: LineItem[];
};
```

**Enforcer:** `@typescript-eslint/prefer-readonly-parameter-types` (planned, warn level, off for React props types). This rule checks parameter types only. The `readonly` check on properties is in `REVIEW.md` ("Conventions with no tool enforcer").

### B.14 Strict equality

**Rule:** Use `===` and `!==`. Do not use `==` or `!=`.

**Good:**

```ts
if (order.status === 'paid') {
  markShipped(order);
}
```

**Bad:**

```ts
if (order.status == 'paid') {
  markShipped(order);
}
```

**Enforcer:** `eqeqeq`.

### B.15 No magic numbers

**Rule:** Do not use number literals outside tests, except `0`, `1`, and `-1`. Name each other value in a constant.

**Good:**

```ts
const MAX_RETRY_COUNT = 3;

if (attempts > MAX_RETRY_COUNT) {
  throw new Error('too many attempts');
}
```

**Bad:**

```ts
if (attempts > 3) {
  throw new Error('too many attempts');
}
```

**Enforcer:** `no-magic-numbers`, with `0`, `1`, and `-1` ignored.

### B.16 Maximum three parameters

**Rule:** Use at most three function parameters. Above three, use one options object.

**Good:**

```ts
export function createOrder(input: {
  readonly userId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly note?: string;
}): Order {
  return buildOrder(input);
}
```

**Bad:**

```ts
export function createOrder(
  userId: string,
  productId: string,
  quantity: number,
  note: string | undefined,
): Order {
  return buildOrder({ userId, productId, quantity, note });
}
```

**Enforcer:** `max-params` set to `3`.

### B.17 Maximum nesting depth

**Rule:** Keep block nesting at three levels or fewer. Use early returns.

**Good:**

```ts
export function getDiscount(order: Order): number {
  if (!order.isEligible) {
    return 0;
  }
  if (order.total <= 0) {
    return 0;
  }
  return order.total * DISCOUNT_RATE;
}
```

**Bad:**

```ts
export function getDiscount(order: Order): number {
  if (order.isEligible) {
    if (order.total > 0) {
      if (order.lineItems.length > 0) {
        if (order.isGift) {
          return order.total * DISCOUNT_RATE;
        }
      }
    }
  }
  return 0;
}
```

**Enforcer:** `max-depth` set to `3`, and `no-else-return`.

---

## C. Errors and logging

### C.1 Result type for domain functions

**Rule:** Domain functions return `Result<T, E>` from `@vprprudhvi/shared-result`. Throw only for a broken invariant, which is a bug.

**Good:**

```ts
import { err, ok, type Result } from '@vprprudhvi/shared-result';

export async function getUser(
  userId: string,
): Promise<Result<UserProfile, UserNotFoundError>> {
  const row = await userRepository.findById(userId);
  if (row === undefined) {
    return err(new UserNotFoundError(userId));
  }
  return ok(row);
}
```

**Bad:**

```ts
export async function getUser(userId: string): Promise<UserProfile> {
  const row = await userRepository.findById(userId);
  if (row === undefined) {
    throw new Error('user not found');
  }
  return row;
}
```

**Enforcer:** `REVIEW.md` ("Conventions with no tool enforcer"). `no-throw-literal` catches only a literal thrown value, such as `throw 'text'`.

### C.2 Error classes

**Rule:** Extend `AppError` in each error class. Set a `code` in UPPER_SNAKE_CASE.

**Good:**

```ts
import { AppError } from '@vprprudhvi/shared-result';

export class UserNotFoundError extends AppError {
  readonly code = 'USER_NOT_FOUND';
}
```

**Bad:**

```ts
export class UserNotFound extends Error {}

throw new Error('USER_NOT_FOUND');
```

**Enforcer:** Custom rule in `tooling/eslint-config` (planned).

### C.3 API error envelope

**Rule:** Return every API error in one envelope: `{ error: { code, message, requestId } }`.

**Good:**

```ts
// src/contracts/error.ts
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});
```

**Bad:**

```ts
reply.status(404).send({ message: 'order not found' });
```

**Enforcer:** The contract schema, and the Fastify error handler test.

### C.4 Logging

**Rule:** Log only with `@vprprudhvi/shared-logger`. Use structured fields. Do not log secrets or PII.

**Good:**

```ts
logger.info({ orderId, durationMs }, 'order exported');
```

**Bad:**

```ts
console.log('order ' + orderId + ' exported for ' + email);
```

**Enforcer:** `no-console`. The Opengrep custom rule for secret and PII fields is planned. The redact list in `@vprprudhvi/shared-logger` masks known fields at run time.

### C.5 Tracing and trace ids

**Rule:** Follow `docs/standards/observability.md` for spans, log fields, and trace ids. Create spans only with `@vprprudhvi/shared-telemetry`.

**Good:**

```ts
import { withSpan } from '@vprprudhvi/shared-telemetry';

await withSpan('orders.export', () => exportOrder(orderId));
```

**Bad:**

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'; // only packages/telemetry imports the SDK
```

**Enforcer:** `no-restricted-imports` in `tooling/eslint-config` (planned). The test gates are in `docs/standards/observability.md`, section 11.

---

## D. Folder layout per part

### D.1 API source layout (`src/api/`)

**Rule:** Put API code in `routes/<resource>/`, `domain/`, and `adapters/`. Keep `config.ts` and `server.ts` at the top level. The `domain/` folder must not import `adapters/` or `fastify`.

**Good:**

```ts
// src/api/domain/apply-discount.ts
export function applyDiscount(orderTotal: number, discountRate: number): number {
  return orderTotal * (1 - discountRate);
}
```

**Bad:**

```ts
// src/api/domain/apply-discount.ts
import type { FastifyRequest } from 'fastify';
import { db } from '../adapters/db.js';
```

**Enforcer:** `eslint-plugin-boundaries`.

### D.2 Web source layout (`web/`)

**Rule:** Put web code in `app/`, `components/`, `features/<feature>/`, and `lib/`. Use Server Components by default. Put `"use client"` only in leaf components.

**Good:**

```tsx
// web/components/add-to-cart-button.tsx
"use client";

export function AddToCartButton(props: AddToCartButtonProps): React.JSX.Element {
  return <button type="button" onClick={props.onAdd}>Add</button>;
}
```

**Bad:**

```tsx
// web/app/orders/page.tsx
"use client";

export default function OrdersPage(): React.JSX.Element {
  return <OrderList />;
}
```

**Enforcer:** `eslint-plugin-boundaries` for the folders. The `"use client"` placement is in `REVIEW.md` ("Conventions with no tool enforcer").

### D.3 Contracts source layout (`src/contracts/`)

**Rule:** Put one file per resource in `src/contracts/`. Keep only Zod schemas and types. Do not add runtime logic.

**Good:**

```ts
// src/contracts/order.ts
import { z } from 'zod';

export const OrderSchema = z.object({
  orderId: z.string(),
  status: z.enum(['open', 'paid']),
});

export type Order = z.infer<typeof OrderSchema>;
```

**Bad:**

```ts
// src/contracts/order.ts
import { db } from '../api/adapters/db.js';

export function isPaid(order: Order): boolean {
  return order.status === 'paid';
}
```

**Enforcer:** `eslint-plugin-boundaries` and `dependency-cruiser`. The no-runtime-logic check is in `REVIEW.md` ("Conventions with no tool enforcer").

### D.4 Infra source layout (`bin/`, `lib/`)

**Rule:** Put the CDK app entry in `bin/<name>.ts`. Put infra code in `lib/stacks/`, `lib/constructs/`, and `lib/config/<env>.ts`. Keep `lib/constructs/` for this project only. Put shared constructs in `packages/cdk-constructs`.
Read shared AWS resources (user pool, zone, certificate) through SSM helpers in `@vprprudhvi/shared-cdk-constructs`. Never import `platform/infra` code.

**Good:**

```ts
// projects/sample/lib/stacks/api-stack.ts
import { ApiService } from '@vprprudhvi/shared-cdk-constructs';
```

**Bad:**

```ts
// projects/sample/lib/stacks/api-stack.ts
import { OtherApiStack } from '../../../other/lib/stacks/api-stack.js'; // never: another project
import { UserPool } from '@vprprudhvi/platform-infra'; // never: platform code is not imported
```

**Enforcer:** `eslint-plugin-boundaries`.

---

## E. Comments and docs

### E.1 Comments say why

**Rule:** Write comments that say why code exists. Do not write comments that repeat what the code does. Add TSDoc to each exported function, type, and construct.

**Good:**

```ts
/** Converts a total to payment cents. */
export function toPaymentAmount(orderTotal: number): number {
  // The payment provider rejects decimal amounts, so cents are required.
  return Math.round(orderTotal * CENTS_PER_UNIT);
}
```

**Bad:**

```ts
export function toPaymentAmount(orderTotal: number): number {
  // multiply by 100
  return Math.round(orderTotal * CENTS_PER_UNIT);
}
```

**Enforcer:** `jsdoc/require-jsdoc` for exports. The why-not-what check is in `REVIEW.md` ("Conventions with no tool enforcer").

### E.2 TODO needs an issue

**Rule:** Write each TODO with an issue number: `TODO(#123): ...`.

**Good:**

```ts
// TODO(#456): remove this fallback after the v2 contract ships.
```

**Bad:**

```ts
// TODO: fix this later
```

**Enforcer:** `no-warning-comments` and a custom regex rule (planned).

### E.3 No commented-out code

**Rule:** Do not commit commented-out code. Delete it. Git keeps the history.

**Good:**

```ts
export function calculateTax(orderTotal: number): number {
  return orderTotal * TAX_RATE;
}
```

**Bad:**

```ts
export function calculateTax(orderTotal: number): number {
  // const oldTotal = legacyTotal(orderTotal);
  // return oldTotal * 0.1;
  return orderTotal * TAX_RATE;
}
```

**Enforcer:** `sonarjs/no-commented-code`.

---

## F. Size and change rules

### F.1 Validate input at boundaries

**Rule:** Validate all input at a boundary with a Zod schema from `src/contracts` of the same project. API routes use `fastify-type-provider-zod`. The web app parses each response with the same schemas.

**Good:**

```ts
app.withTypeProvider<ZodTypeProvider>().post(
  '/v1/orders',
  { schema: { body: CreateOrderSchema } },
  async (request) => createOrder(request.body),
);
```

**Bad:**

```ts
app.post('/v1/orders', async (request) => {
  const { productId } = request.body as { productId: string };
  return createOrder({ productId });
});
```

**Enforcer:** `REVIEW.md` ("Conventions with no tool enforcer"). The route tests in `docs/standards/testing.md` check the schema.

### F.2 Read config in one place

**Rule:** Read configuration once in `config.ts`, from a Zod-parsed environment. Do not read `process.env` in any other file.

**Good:**

```ts
// src/api/config.ts
const envSchema = z.object({
  SAMPLE_API_DB_URL: z.string().url(),
});

export const config = envSchema.parse(process.env);
```

**Bad:**

```ts
// src/api/routes/order/create-order.ts
const dbUrl = process.env.SAMPLE_API_DB_URL;
```

**Enforcer:** `no-restricted-syntax` on `process.env` access outside `config.ts`.

### F.3 Feature flags

**Rule:** Put each new user-visible behavior behind a flag from `@vprprudhvi/shared-flags`. Use only flag names from the typed union.

**Good:**

```ts
import { flags } from '@vprprudhvi/shared-flags';

if (await flags.isEnabled('orders.export')) {
  renderExportButton();
}
```

**Bad:**

```ts
renderExportButton();
```

**Enforcer:** The typed flag name rejects unknown strings at compile time. The check that each new behavior has a flag is in `REVIEW.md` ("Conventions with no tool enforcer").

### F.4 Bug fixes need a failing test first

**Rule:** Add a test to each bug fix. The test must fail on the old code and pass on the fixed code.

**Good:**

```ts
it('returns 404 when the order is missing', async () => {
  const response = await app.inject({ method: 'GET', url: '/v1/orders/missing' });
  expect(response.statusCode).toBe(404);
});
```

**Bad:**

```ts
it('returns a response', async () => {
  const response = await app.inject({ method: 'GET', url: '/v1/orders/missing' });
  expect(response.statusCode).toBeDefined();
});
```

**Enforcer:** `REVIEW.md` ("Conventions with no tool enforcer"). The reviewer checks that the test covers the bug.

### F.5 One change per PR

**Rule:** Each PR must change one thing. The soft limit is 400 changed lines. A `large-pr` label from a human is required above 1000 changed lines.

**Good:**

```text
PR title: feat(orders): add CSV export
```

**Bad:**

```text
PR title: misc fixes, lint config, and orders export
```

**Enforcer:** The PR size check in `scripts/gates/check-gates.mjs` (planned). The one-change check is in `REVIEW.md` ("Conventions with no tool enforcer").

---

## G. Python (`projects/<name>/src/api-py`)

Python backends follow PEP 8 and these rules. Each rule names its enforcer. The Python tools run through `uv` and the Rush wrapper. See ADR 0007.

### G.1 Layout

**Rule:** Put code in `src/<package>/`. Put generated models in `src/<package>/generated/`. Keep handlers, domain, and adapters apart, as in D.1.

**Good:**

```text
projects/sample/src/api-py/
  pyproject.toml
  src/sample_api/
    handlers/health.py
    domain/health.py
    generated/models.py   # generated, do not edit
```

**Bad:**

```text
projects/sample/src/api-py/
  handler.py              # HTTP handler, SQL, and business rules in one file
```

**Enforcer:** `REVIEW.md` ("Conventions with no tool enforcer"). Planned: an import-linter contract for `domain/` (planned).

### G.2 Functions and variables: snake_case

**Rule:** Name functions and variables in snake_case. Start each function name with a verb.

**Good:**

```python
def get_user(user_id: str) -> UserProfile | None:
    user_total = 0
    return None
```

**Bad:**

```python
def GetUser(userId: str):
    userTotal = 0
    return None
```

**Enforcer:** ruff `N802` (function name), `N803` (argument name), `N806` (variable name in a function).

### G.3 Classes: PascalCase

**Rule:** Name classes in PascalCase.

**Good:**

```python
class OrderSummary(BaseModel):
    order_id: str
```

**Bad:**

```python
class order_summary(BaseModel):
    order_id: str
```

**Enforcer:** ruff `N801`.

### G.4 Module constants: UPPER_SNAKE_CASE

**Rule:** Name a module-level constant in UPPER_SNAKE_CASE. Use it for primitive values only.

**Good:**

```python
MAX_RETRY_COUNT = 3
```

**Bad:**

```python
maxRetryCount = 3
```

**Enforcer:** ruff `N816` (mixed case at module level). The UPPER_SNAKE_CASE check is partial. `REVIEW.md` checks the rest.

### G.5 Full type hints on every function

**Rule:** Add a type hint to each argument and each return value. `mypy --strict` must pass.

**Good:**

```python
def calculate_tax(order_total: Decimal) -> Decimal:
    return order_total * TAX_RATE
```

**Bad:**

```python
def calculate_tax(order_total):
    return order_total * TAX_RATE
```

**Enforcer:** `mypy --strict`. Also ruff `ANN001` and `ANN201`.

### G.6 No `Any`

**Rule:** Do not use `Any` in annotations. Use `object` or a concrete type, and narrow it with `isinstance`.

**Good:**

```python
def parse_body(raw: bytes) -> CreateOrder:
    return CreateOrder.model_validate_json(raw)
```

**Bad:**

```python
def parse_body(raw: Any) -> Any:
    return json.loads(raw)
```

**Enforcer:** ruff `ANN401` (dynamically typed `Any`). `mypy --strict` reports implicit `Any`.

### G.7 No bare or blind `except`

**Rule:** Name the exception type. Do not catch `Exception` or use a bare `except:`.

**Good:**

```python
try:
    order = load_order(order_id)
except OrderNotFoundError as error:
    raise HTTPNotFound(str(error)) from error
```

**Bad:**

```python
try:
    order = load_order(order_id)
except:
    order = None
```

**Enforcer:** ruff `E722` (bare `except`), `BLE001` (blind `except`).

### G.8 No `assert` in production code

**Rule:** Do not use `assert` to check input or state in `src/`. Raise an error instead. Tests may use `assert`.

**Good:**

```python
if user is None:
    raise UserNotFoundError(user_id)
```

**Bad:**

```python
assert user is not None
```

**Enforcer:** ruff `S101`. The `tests/` folder is exempt in `pyproject.toml` (`[tool.ruff.lint.per-file-ignores]`).

### G.9 Google-style docstrings on public functions and classes

**Rule:** Write a docstring for each public function and class. Use the Google style with `Args:` and `Returns:`.

**Good:**

```python
def get_user(user_id: str) -> UserProfile | None:
    """Return the user with the given ID.

    Args:
        user_id: The user ID to look up.

    Returns:
        The user profile, or None when no user matches.
    """
```

**Bad:**

```python
def get_user(user_id: str) -> UserProfile | None:
    return repository.find(user_id)
```

**Enforcer:** ruff `D100` to `D107` with `[tool.ruff.lint.pydocstyle] convention = "google"`.

### G.10 Models come from the Zod contracts. Never edit them by hand

**Rule:** Import Pydantic models from `generated/`. Change the Zod schema in `src/contracts`, then run the generator. Do not edit a file in `generated/`.

**Good:**

```python
from sample_api.generated.models import CreateOrder
```

**Bad:**

```python
# src/sample_api/generated/models.py (hand edit)
class CreateOrder(BaseModel):
    order_id: str
    discount: float  # added by hand, not in the Zod schema
```

**Enforcer:** CI drift check. The `_phase:build` script regenerates the models and runs `git diff --exit-code`.

### G.11 Log with the Powertools logger. Do not use `print`

**Rule:** Log with `aws_lambda_powertools` `Logger`. Pass fields as keyword arguments. Do not use `print`.

**Good:**

```python
logger.info("order created", order_id=order_id)
```

**Bad:**

```python
print(f"order created {order_id}")
```

**Enforcer:** ruff `T201` (`print` found).

### G.12 No mutable default arguments

**Rule:** Use `None` or an immutable default. Do not use a list, a dict, or a set as a default.

**Good:**

```python
def list_tags(tags: tuple[str, ...] = ()) -> list[str]:
    return list(tags)
```

**Bad:**

```python
def list_tags(tags: list[str] = []) -> list[str]:
    return tags
```

**Enforcer:** ruff `B006`.

### G.13 Run subprocesses without a shell

**Rule:** Pass a list of arguments to `subprocess.run`. Do not use `shell=True` with input.

**Good:**

```python
subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True)
```

**Bad:**

```python
subprocess.run(f"git log {branch}", shell=True)
```

**Enforcer:** ruff `S602` and `S603`. bandit `B602`.

### G.14 Three arguments at most. Use an options object above that

**Rule:** A function takes at most 3 arguments. Pass a Pydantic model or a dataclass for more values.

**Good:**

```python
def create_order(options: CreateOrderOptions) -> Order:
    ...
```

**Bad:**

```python
def create_order(user_id: str, sku: str, qty: int, currency: str, note: str) -> Order:
    ...
```

**Enforcer:** ruff `PLR0913` with `max-args = 3`.

### G.15 Complexity at most 15

**Rule:** Keep the cyclomatic complexity of each function at 15 or below. Use early returns.

**Good:**

```python
def discount_for(order: Order) -> Decimal:
    if order.total <= ZERO:
        return ZERO
    return order.total * DISCOUNT_RATE
```

**Bad:**

```python
def discount_for(order: Order) -> Decimal:
    if order.total > ZERO:
        if order.is_vip:
            if order.region == "eu":
                ...  # many more nested branches
    return ZERO
```

**Enforcer:** ruff `C901` with `max-complexity = 15`.

### G.16 Import order

**Rule:** Sort imports in three groups: standard library, third-party, first-party. Put relative imports last.

**Good:**

```python
import json

from pydantic import BaseModel

from sample_api.domain.health import check_health
```

**Bad:**

```python
from sample_api.domain.health import check_health
import json
from pydantic import BaseModel
```

**Enforcer:** ruff `I001`.

---

## H. Go (`projects/<name>/src/api-go`)

Go backends follow Effective Go and these rules. Each rule names its enforcer. The Go tools run through the Rush wrapper. See ADR 0007.

### H.1 Layout

**Rule:** Put the Lambda entry point in `cmd/<name>/`. Put packages in `internal/`. Put generated types in `internal/gen/`. Do not edit `internal/gen/`.

**Good:**

```text
projects/sample/src/api-go/
  go.mod
  cmd/health/main.go
  internal/domain/health.go
  internal/gen/types.go   # generated, do not edit
```

**Bad:**

```text
projects/sample/src/api-go/
  main.go                 # handler, database access, and rules in one package
```

**Enforcer:** `REVIEW.md` ("Conventions with no tool enforcer").

### H.2 Names: MixedCaps

**Rule:** Use MixedCaps for names. Start an exported name with an uppercase letter. Write acronyms in one case: `userID`, `URL`.

**Good:**

```go
func GetUser(ctx context.Context, userID string) (User, error) {
```

**Bad:**

```go
func get_user(ctx context.Context, user_id string) (User, error) {
```

**Enforcer:** golangci-lint `revive` (`var-naming`).

### H.3 Short receiver names

**Rule:** Use a short receiver name, one or two letters. Use the same name in every method of a type.

**Good:**

```go
func (s *OrderStore) Save(ctx context.Context, order Order) error {
```

**Bad:**

```go
func (orderStore *OrderStore) Save(ctx context.Context, order Order) error {
```

**Enforcer:** golangci-lint `revive` (`receiver-naming`).

### H.4 `context.Context` is the first argument

**Rule:** Put `ctx context.Context` first in each function that does I/O.

**Good:**

```go
func LoadOrder(ctx context.Context, orderID string) (Order, error) {
```

**Bad:**

```go
func LoadOrder(orderID string, ctx context.Context) (Order, error) {
```

**Enforcer:** golangci-lint `revive` (`context-as-argument`).

### H.5 Wrap errors with `%w` and check every error

**Rule:** Wrap an error with `%w` and add context. Do not drop an error return.

**Good:**

```go
if err != nil {
    return fmt.Errorf("load order %s: %w", orderID, err)
}
```

**Bad:**

```go
if err != nil {
    return fmt.Errorf("load order %s: %v", orderID, err)
}
_ = file.Close()
```

**Enforcer:** golangci-lint `errcheck`, `errorlint`.

### H.6 No `panic` in handlers

**Rule:** Return an error from a handler. Do not call `panic` for an expected case.

**Good:**

```go
if order == nil {
    return ErrNotFound
}
```

**Bad:**

```go
if order == nil {
    panic("order not found")
}
```

**Enforcer:** `REVIEW.md` ("Conventions with no tool enforcer").

### H.7 Compare errors with `errors.Is` and `errors.As`

**Rule:** Compare a wrapped error with `errors.Is`. Extract a typed error with `errors.As`.

**Good:**

```go
if errors.Is(err, ErrNotFound) {
```

**Bad:**

```go
if err == ErrNotFound {
```

**Enforcer:** golangci-lint `errorlint`.

### H.8 Switch on enum values must cover every case

**Rule:** A switch over a set of typed constants lists every constant.

**Good:**

```go
switch status {
case StatusOpen:
    return "open"
case StatusClosed:
    return "closed"
}
```

**Bad:**

```go
switch status {
case StatusOpen:
    return "open"
}
```

**Enforcer:** golangci-lint `exhaustive`.

### H.9 Close HTTP response bodies

**Rule:** Close `resp.Body` after each HTTP request.

**Good:**

```go
resp, err := client.Do(req)
if err != nil {
    return err
}
defer resp.Body.Close()
```

**Bad:**

```go
resp, err := client.Do(req)
if err != nil {
    return err
}
return decode(resp.Body)
```

**Enforcer:** golangci-lint `bodyclose`.

### H.10 No SQL built from strings

**Rule:** Pass values as query parameters. Do not build SQL with `fmt.Sprintf`.

**Good:**

```go
row := db.QueryRowContext(ctx, "SELECT name FROM users WHERE id = $1", userID)
```

**Bad:**

```go
row := db.QueryRowContext(ctx, fmt.Sprintf("SELECT name FROM users WHERE id = '%s'", userID))
```

**Enforcer:** golangci-lint `gosec` (`G201`, `G202`).

### H.11 Every `nolint` needs a reason and a named linter

**Rule:** Write `//nolint:<linter> // <reason>`. Do not write a bare `//nolint`.

**Good:**

```go
//nolint:gosec // G304: path is checked by safePath above
data, err := os.ReadFile(path)
```

**Bad:**

```go
//nolint
data, err := os.ReadFile(path)
```

**Enforcer:** golangci-lint `nolintlint` (`require-explanation`, `require-specific`).

### H.12 Complexity at most 15

**Rule:** Keep the cyclomatic complexity of each function at 15 or below.

**Good:** Split a long function into helpers with one job each.

**Bad:**

```go
func route(req Request) Response {
    // 40 nested if and switch statements
}
```

**Enforcer:** golangci-lint `gocyclo` with `min-complexity: 15`.

### H.13 Format with gofumpt and goimports

**Rule:** Run `gofumpt` and `goimports` on each Go file. Do not hand-format.

**Good:** A file that `gofumpt -l` and `goimports -l` print nothing for.

**Bad:** A file with mixed import groups and extra blank lines.

**Enforcer:** `gofumpt` and `goimports` in `pre-commit` and CI.

### H.14 Unused code and dead assignments

**Rule:** Remove unused functions, variables, and imports. Remove assignments whose value is not read.

**Good:** Each declared name is read.

**Bad:**

```go
result := compute()
result = other() // earlier value of result is never read
```

**Enforcer:** golangci-lint `unused`, `ineffassign`, `govet`.

### H.15 Generated types come from the Zod contracts. Never edit them by hand

**Rule:** Change the Zod schema, then run `oapi-codegen`. Do not edit a file in `internal/gen/`.

**Good:**

```go
import "github.com/vprprudhvi/sample/api-go/internal/gen"

var order gen.CreateOrder
```

**Bad:**

```go
// internal/gen/types.go (hand edit)
type CreateOrder struct {
    Discount float64 // added by hand, not in the Zod schema
}
```

**Enforcer:** CI drift check. The `_phase:build` script regenerates the types and runs `git diff --exit-code`.
