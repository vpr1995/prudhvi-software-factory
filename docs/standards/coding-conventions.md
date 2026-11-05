# Coding Conventions

## Purpose

This document sets the coding rules for this repo. Agents and humans must follow these rules. Each rule has at least one enforcer.

## Document rules

- A human reviews each change to this document.
- Each convention has an enforcer. A convention with no tool enforcer is checked by the AI reviewer. Such entries are listed in `REVIEW.md` under "Conventions with no tool enforcer".
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

**Enforcer:** `local/zod-schema-naming` in `tooling/eslint-config`.

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

**Rule:** Place each unit test in a `test/` folder at the root of the package or project. The path under `test/` mirrors the source path, and the name is `<file>.test.ts` or `<file>.test.tsx`. Place end-to-end tests in `e2e/*.spec.ts`. See [testing.md](testing.md), section 1.

**Good:**

```text
src/domain/get-user.ts
test/domain/get-user.test.ts
web/e2e/order-page.spec.ts
```

**Bad:**

```text
src/domain/getUser.ts
src/domain/get-user.test.ts
src/domain/__tests__/getUser.js
```

**Enforcer:** The vitest `include` glob `test/**` in `tooling/vitest-config`.

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

**Enforcer:** The contract test. The AI reviewer checks the route names.

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

**Enforcer:** No tool enforcer. The AI reviewer checks it.

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

**Enforcer:** cdk-nag. The AI reviewer checks the rest.

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

**Enforcer:** No tool enforcer. The AI reviewer checks it. See `docs/standards/git-workflow.md`.

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

**Enforcer:** The `barrel` selector of `no-restricted-syntax` in `tooling/eslint-config/src/restricted-syntax.js`.

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

**Enforcer:** No tool enforcer. The `readonly` check is in `REVIEW.md` ("Conventions with no tool enforcer").

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

### B.18 Strict compiler options live in one place

**Rule:** Each tsconfig extends a preset from `@vprprudhvi/tooling-tsconfig` (`base`, `node`, `library`, `web`). A local tsconfig sets only paths, output and environment options. Strictness lives only in `tooling/tsconfig`.

**Good:**

```json
{
  "extends": "@vprprudhvi/tooling-tsconfig/node.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "test"]
}
```

**Bad:**

```json
{
  "extends": "@vprprudhvi/tooling-tsconfig/node.json",
  "compilerOptions": { "noEmit": true, "strict": false }
}
```

**Enforcer:** `node tooling/tsconfig/scripts/check-tsconfigs.mjs`. CI runs it on each PR. The lists of allowed options are at the top of the script.

---

## C. Errors and logging

### C.1 Result type for domain functions

**Rule:** Domain functions return `Result<T, E>` from `@vprprudhvi/shared-result`. Throw only for a broken invariant, which is a bug.

**Good:**

```ts
import { err, ok, type Result } from '@vprprudhvi/shared-result';

export async function getUser(userId: string): Promise<Result<UserProfile, UserNotFoundError>> {
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

**Enforcer:** No tool enforcer. The AI reviewer checks it.

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

**Enforcer:** `no-console` and `local/no-secret-in-log` (a secret or PII key in a logger call is a lint error). The redact list in `@vprprudhvi/shared-logger` masks known fields at run time.

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

**Enforcer:** No tool enforcer. The AI reviewer checks it. The test checks are in `docs/standards/observability.md`, section 11.

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
'use client';

export function AddToCartButton(props: AddToCartButtonProps): React.JSX.Element {
  return (
    <button type="button" onClick={props.onAdd}>
      Add
    </button>
  );
}
```

**Bad:**

```tsx
// web/app/orders/page.tsx
'use client';

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

**Enforcer:** `eslint-plugin-boundaries`. The no-runtime-logic check is in `REVIEW.md` ("Conventions with no tool enforcer").

### D.4 Infra source layout (`bin/`, `lib/`)

**Rule:** Put the CDK app entry in `bin/app.ts`. Put infra code in `lib/<name>-stack.ts`, `lib/constructs/`, and `lib/config/<env>.ts`. Keep `lib/constructs/` for this project only. Put shared constructs in `packages/cdk-constructs`.
Read shared AWS resources (user pool, zone, certificate) through SSM helpers in `@vprprudhvi/shared-cdk-constructs`. Never import `platform/infra` code.

**Good:**

```ts
// projects/sample/lib/sample-api-stack.ts
import { TracedHttpApi } from '@vprprudhvi/shared-cdk-constructs';
```

**Bad:**

```ts
// projects/sample/lib/sample-api-stack.ts
import { OtherApiStack } from '../../other/lib/other-api-stack.js'; // never: another project
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

**Enforcer:** `local/todo-with-issue` in `tooling/eslint-config`.

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
app
  .withTypeProvider<ZodTypeProvider>()
  .post('/v1/orders', { schema: { body: CreateOrderSchema } }, async (request) =>
    createOrder(request.body),
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
// config.ts (the only file that reads process.env)
import { createEnvFlagProvider, createFlagClient, defineFlags } from '@vprprudhvi/shared-flags';

const registry = defineFlags({
  ordersExport: { defaultValue: false, description: 'Show the export button.' },
});
const flags = createFlagClient(registry, [createEnvFlagProvider(process.env)]);

if (flags.isEnabled('ordersExport')) {
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

**Rule:** Each PR must change one thing. The soft limit is 2000 changed lines.

**Good:**

```text
PR title: feat(orders): add CSV export
```

**Bad:**

```text
PR title: misc fixes, lint config, and orders export
```

**Enforcer:** The one-change check is in `REVIEW.md` ("Conventions with no tool enforcer").
