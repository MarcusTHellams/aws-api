# AWS API

An AWS CDK app with a regional API Gateway REST API, AWS WAF, and a TypeScript Lambda.
`GET /health` returns HTTP 200 with `{"status":"ok"}` for authorized backend services.

## Security

Every method requires IAM authentication (`AWS_IAM`), including `/health`.
Callers sign requests with AWS Signature Version 4 using service name `execute-api`
and the API's AWS region. Use the calling service's IAM role and temporary credentials.
There are no API keys, shared application secrets, or user sign-in accounts.

The stack creates `ApiInvokePolicyArn`, a customer-managed policy granting only
`execute-api:Invoke` on this API's `GET /health` route in the `prod` stage.
Attach it to each authorized calling service's IAM role in the same AWS account.
It is not attached to any role automatically. For cross-account callers, we also
need an API resource policy and an appropriate policy in the calling account.

A regional WAF web ACL is associated directly with the deployed API stage, so
calls to its default execute-api URL also pass through WAF. It applies:

- AWS managed Common Rule Set and Known Bad Inputs rules in blocking mode.
- A source-IP rate limit of approximately 1,000 requests per five minutes.
- CloudWatch metrics and sampled requests for inspecting blocked traffic.

The IP limit is shared by services behind the same NAT address. WAF rate limits
are approximate abuse controls. Managed rules may block legitimate requests;
review the WAF metrics and sampled requests when adding payloads and endpoints.
The Common Rule Set currently blocks bodies larger than 8 KB by default.
WAF incurs charges even at low traffic volumes.

## Layout

- `bin/aws-api.ts`: CDK app entry point.
- `lib/aws-api-stack.ts`: API, IAM policy, WAF rules, Lambda, logs, and outputs.
- `src/handlers/health.ts`: health endpoint handler using REST API event types.
- `test/aws-api.test.ts`: response, IAM enforcement, policy scope, and WAF tests.

Lambda runs on Node.js 24, with a five-second timeout and one-week log retention.
CDK bundles TypeScript with esbuild during synthesis; Docker is not required.
Log groups are retained when the stack is deleted.

## Development

Install Vite+ and use the existing pnpm workspace:

```sh
vp install
vp check
vp run build
vp test --run
vp run synth
```

`npm run build` and `npm run test -- --run` also run the type check and tests.
The stack is environment-agnostic; your AWS profile selects the deployment account and region.

## Deployment

Configure AWS credentials and a region, then review the infrastructure changes:

```sh
vp run diff -- --profile your-profile
```

Deployment requires your approval. Once approved, bootstrap the target environment
if needed and deploy:

```sh
vp exec cdk bootstrap --profile your-profile
vp exec cdk deploy --profile your-profile
```

Deployment prints `ApiUrl`, `HealthUrl`, `ApiInvokePolicyArn`, and `WebAclArn`.
This replaces the previous HTTP API with a REST API and introduces `/prod/` in
the endpoint URL. Use the new outputs if an earlier version was already deployed.

After deployment, attach the output policy ARN to an authorized service role:

```sh
aws iam attach-role-policy \
  --role-name YOUR_CALLING_SERVICE_ROLE \
  --policy-arn YOUR_API_INVOKE_POLICY_ARN \
  --profile your-profile
```

## Calling the API

For a smoke test, export temporary credentials for a role that has the invoke
policy attached. Set `AWS_REGION` to the API region and `HEALTH_URL` to the output
URL. With a curl version supporting `--aws-sigv4`:

```sh
curl --fail-with-body \
  --aws-sigv4 "aws:amz:${AWS_REGION}:execute-api" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  --header "X-Amz-Security-Token: ${AWS_SESSION_TOKEN}" \
  "${HEALTH_URL}"
```

Expected response: `{"status":"ok"}`. An unsigned request, or a signed request
from a role without invoke permission, should receive HTTP 403. Test both cases
after deployment; local template tests cannot exercise live WAF or IAM decisions.
Backend code should use its runtime role credentials and an AWS SigV4 signer.

## Adding endpoints

Add a handler under `src/handlers/`, create its `NodejsFunction` in the stack,
and connect it with `api.root.addResource(...).addMethod(..., new LambdaIntegration(...))`.
New methods inherit IAM authentication from `defaultMethodOptions`.
Grant each calling service only the new method ARNs it needs; the starter invoke
policy currently grants only `GET /health`. The existing WAF association covers
all methods in the `prod` stage. No database or custom domain is configured yet.

## Hono per feature: products example

`src/features/products/app.ts` defines the feature's Hono routes.
`src/features/products/handler.ts` adapts that app to Lambda.

| Route                    | Lambda   | Response                                                                       |
| ------------------------ | -------- | ------------------------------------------------------------------------------ |
| `GET /health`            | Health   | `{"status":"ok"}`                                                              |
| `GET /products`          | Products | `{"products":[{"id":"notebook","name":"Notebook"},{"id":"pen","name":"Pen"}]}` |
| `GET /products/notebook` | Products | `{"product":{"id":"notebook","name":"Notebook"}}`                              |

Products are read-only sample data, with no persistence or create endpoint.
Unknown product IDs return HTTP 404 with `{"error":"Product not found"}`.
`src/http/create-app.ts` supplies shared no-store headers and JSON error responses
for future feature apps. Keep business logic inside each feature.

API Gateway registers both GET methods explicitly, using the same Products Lambda.
Both require IAM authentication and pass through the stage WAF. There is no global
catch-all Lambda. Application tests use Hono's `app.request`; adapter tests also
exercise actual REST API event shapes, including the deployed stage prefix.

Deployment also outputs `ProductsUrl` and `ProductsReadPolicyArn`. Attach the
products policy to calling service roles using the policy attachment command above.
The health policy still grants only health access. Use the signed curl example
with `ProductsUrl` or `ProductsUrl/notebook` and credentials authorized for products.

For another feature, create its own app and Lambda adapter, a separate
`NodejsFunction`, and CDK methods. Reuse `createApp()` for common middleware.
Each Lambda gets its own execution role; grant AWS resource permissions per feature.
Adding a product endpoint requires a Hono route, a CDK method, and appropriate
caller policy changes. Gateway-generated errors for unregistered methods use
API Gateway's response format; Hono's JSON error handling applies inside the app.

## Orders feature

Orders is a second independent Hono feature with its own Lambda and execution role.
It reuses the shared middleware and is covered by the same WAF and IAM defaults.

- `GET /orders` returns two read-only sample orders with status and line items.
- `GET /orders/order-1001` returns one sample order in an `order` object.
- Unknown IDs return HTTP 404 with `{"error":"Order not found"}`.

Routes live in `src/features/orders/app.ts`; `handler.ts` exports its Lambda adapter.
There is no database or order creation yet. Deployment outputs `OrdersUrl` and
`OrdersReadPolicyArn`. Attach the orders policy only to services that should read
orders; the health and products policies grant no orders access.

To try it in SAM, stop the existing server, rebuild the bundles, and restart:

```sh
vp run synth
sam local start-api --template cdk.out/AwsApiStack.template.json --port 3000 --warm-containers eager
```

With Docker Desktop, if SAM cannot locate Docker, first set this in that terminal:

```sh
export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"
```

In another terminal:

```sh
curl http://localhost:3000/orders
curl http://localhost:3000/orders/order-1001
curl http://localhost:3000/orders/missing
```

SAM does not enforce the deployed API's IAM authentication or WAF rules.

## Direct DynamoDB service integration example

`GET /direct-products/{productId}` is separate from the Hono products feature.
API Gateway calls DynamoDB `GetItem` directly; no Hono or Lambda runs for this
route. IAM authentication and the existing stage WAF still apply.

The stack creates an on-demand DynamoDB table with a string partition key `id`.
The table starts empty. It is retained when the stack is deleted or replaced;
remove it manually when the example is no longer needed. The gateway integration
role can only `GetItem` from this table. The separate caller policy only grants
GET access under `/direct-products/`; attach it to authorized service roles.
The existing Hono product fixtures are not read from or copied into this table.

The integration uses a strongly consistent read and projects only `id` and `name`.
A found item returns HTTP 200 in DynamoDB's attribute-value format:

```json
{ "product": { "id": { "S": "notebook" }, "name": { "S": "Notebook" } } }
```

A missing item returns HTTP 404 with `{"error":"Product not found"}`.
DynamoDB HTTP 4xx/5xx responses map to a generic HTTP 502 error. Gateway-generated
errors (for example, unsigned requests or unsupported content types) keep their
own gateway status and format. This demo has no list or write endpoint.

### VTL mapping templates

The gateway mappings are plain VTL files in `lib/integrations/templates/`:

- `get-product.request.vtl`: builds the DynamoDB GetItem request.
- `get-product.response.vtl`: returns the item or a 404 response.
- `get-product.error.vtl`: returns the generic backend error response.

CDK reads the files during synthesis. CloudFormation substitutes `${TableName}`
with the generated table name; API Gateway evaluates the VTL for each request.
There is no TypeScript template generator. The response preserves DynamoDB's
attribute-value JSON format.

### Trying the example after an approved deployment

Local build, tests, and synthesis check infrastructure configuration, but SAM
`local start-api` does not emulate this direct DynamoDB integration. Test the
route in an approved AWS development account. No deployment has been performed
as part of adding this example.

The stack outputs `DirectProductsTableName`, `DirectProductExampleUrl`, and
`DirectProductsReadPolicyArn`. After deployment, load the provided example using
a development profile with `dynamodb:PutItem` permission on that table (the
API caller and gateway roles deliberately do not have write permission):

```sh
aws dynamodb put-item \
  --table-name YOUR_DIRECT_PRODUCTS_TABLE_NAME \
  --item file://examples/direct-products/notebook.json \
  --profile your-profile \
  --region YOUR_REGION
```

Attach `DirectProductsReadPolicyArn` to an authorized calling role. Use the signed
curl command earlier in this README with `DirectProductExampleUrl`, or another
ID under `/direct-products/`. Use the API's region and that role's temporary
credentials. Requests without a content-type header default to `application/json`;
the request mapping deliberately rejects unsupported content types.

Check the seeded lookup returns 200, an unknown ID returns 404, unsigned calls
are rejected, and roles with only health/products/orders access cannot use this
route. Template tests do not execute VTL or verify live authorization and errors.
