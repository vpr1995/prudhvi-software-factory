# Review template: infra (AWS CDK)

Use this template with `REVIEW.md` for each change in `projects/<name>/bin/`, `projects/<name>/lib/`, or `packages/cdk-constructs/`. Apply the rules to the changed files only. Read the `cdk diff` output in the PR comment before you review.

## Checks

### IAM least privilege

- A policy does not use `*` for an action. Name each action.
- A policy does not use `*` for a resource unless the action has no resource-level support. State why in a comment.
- A role is not given `AdministratorAccess` or a broad managed policy.
- Use `grantRead` and `grantWrite` from the construct when they fit. Check the grant scope.

Example of a finding:

```
Important  projects/sample/lib/constructs/assets.ts:31
Policy action is "s3:*" on resource "*". Access is not least privilege.
Fix: grant s3:GetObject on the bucket ARN only, or use bucket.grantRead().
```

### Stateful resources and replacement

- Read `cdk diff`. Find each resource marked `replace`.
- Stop and report `Important` for any replacement of a stateful resource (database, bucket, table, queue with messages, log group with data). Example: a changed logical ID or a changed immutable property.
- A rename of a construct ID changes the logical ID. Check the diff for it.

### RemovalPolicy

- A stateful resource does not use `RemovalPolicy.DESTROY` outside `dev`.
- Set `RemovalPolicy.RETAIN` for stateful resources in `staging` and `prod`.
- Do not set `removalPolicy` on a stateless resource unless the PR says why.

### Encryption

- Each S3 bucket has encryption. Use SSE-KMS or SSE-S3.
- Each database and each log group that holds data is encrypted.
- Each queue or topic that holds data is encrypted.
- TLS is required for each endpoint that the app uses.

### Public exposure

- A bucket does not allow public access. `blockPublicAccess` is set.
- A security group does not open `0.0.0.0/0` on a port other than 443 (or 80 for redirect).
- A database is not public.
- A public endpoint has an authentication path or a reason in the PR.

### Cost

- A new NAT gateway, load balancer, or instance type has a reason in the PR.
- A new log group sets a retention period. Do not leave it at "never expire".
- A new autoscaling setting has a maximum.
- A change in `dev` does not use a production instance size.

### Config and naming

- Account IDs and region values come from `config/<env>.ts`. Do not hard-code them in constructs.
- Construct IDs are PascalCase. Do not set physical resource names. Let CDK generate them.
- Each stack has the tags the repository requires.

### Tests

- Each construct has a `Template.fromStack` assertion for each property the construct sets.
- Snapshot changes have a reason in the PR.
- `cdk synth` runs with cdk-nag. A nag error must be fixed, or it must have a suppression with a reason that a human approved.

### Platform inputs (SSM)

- A project reads platform values only through the SSM helpers in `@vprprudhvi/shared-cdk-constructs`.
- A project does not import `platform/infra` code. Check the import list.
- A project does not hard-code a user pool ID, a zone ID, or a certificate ARN.
- Each project creates its own Cognito app client. The client has no secret unless the PR says why.
- A project creates DNS records only inside the imported hosted zone, under its own subdomain.

### Lambda and API Gateway

- Each Lambda sets a timeout. The timeout is lower than the API Gateway HTTP API limit of 30 seconds.
- Each Lambda has a memory size and a reserved concurrency or a reason for none.
- Each Lambda role grants only the actions the function calls.
- API Gateway routes use an authorizer (Cognito JWT or IAM) unless the route is public and the PR says why.
- Each API Gateway stage sets throttling for a public route.
- Logs have a retention period.
