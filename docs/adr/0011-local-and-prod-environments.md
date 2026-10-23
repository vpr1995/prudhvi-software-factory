# ADR 0011: Local and prod environments

- Status: Accepted
- Date: 2026-10-23

## Context

ADR 0005 sets the deploy order `dev`, then `staging`, then `prod`. The repo now has one AWS account and one Cognito user pool. The platform stack deploys only `prod`. A `dev` stack and a `staging` stack have no separate platform to test against. They add cost and drift without a matching platform. Developers still need to run the web app and the API on their machine against real cloud services. The release also needs a check before `prod`.

## Decision

- The deployment environments are `local` and `prod`. `dev` and `staging` are removed.
- The repo uses one AWS account and one Cognito user pool. The platform stack `platform/infra` deploys only `prod`. Use `-c env=prod`. The stack name is `PlatformInfra-prod`.
- SSM parameter names keep the pattern `/platform/<env>/...`. Only `/platform/prod/...` exists.
- A project config has two fields. `env` has type `DeployEnv` and is `local` or `prod`. `platformEnv` has type `PlatformEnv` and is always `prod`. Both project environments read `/platform/prod/...`.
- Each project environment has its own Cognito app client on the shared user pool.
- `local` runs the web app and the API on the developer machine at `http://localhost:3000`. The local app uses cloud resources, such as Cognito and later DynamoDB, with the developer AWS profile. A `local` deploy creates only the app client and, later, the data stores. It creates no Lambda function and no HTTP API.
- `prod` is the full deploy.
- The release order is `local`, then `prod`. The developer checks a change in `local` first.
- Feature flags from `packages/flags` carry the staged release. See ADR 0005.

## Consequences

- Positive: One platform stack and one user pool. There is less infra to deploy and check.
- Positive: The developer checks a change against real cloud services before `prod`.
- Positive: Each project environment has its own app client. A change to the `local` client does not change the `prod` client.
- Negative: The user list is shared. A `prod` user can sign in to the `local` app. Test users are real users in the pool.
- Negative: There is no pre-production cloud stage. The first run of a Lambda function or an HTTP API in the cloud is in `prod`. Feature flags limit the risk.
- Positive: The API authorizer accepts only tokens for the app client of its own stack. The `prod` API rejects tokens from the `local` client. See `packages/cdk-constructs/src/http-api.ts` (`userPoolClients: [props.userPoolClient]`) and `projects/sample/test/infra/sample-api-stack.test.ts` (the JWT audience assertion).
