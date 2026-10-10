# Swagger UI

Open `http://<dashboard-computer-IP>:4310/swagger` (or `/docs`) to browse the dashboard's OpenAPI 3.1 contract and send requests. On the dashboard computer, use [local Swagger UI](http://127.0.0.1:4310/swagger). The page and specification are public; protected API calls still require their normal credentials and grants.

Run `just build` after installing dependencies, then `just start` or `just run`. Swagger UI assets are pinned and copied into `dist` during the build. The dashboard serves them locally, so no CDN or internet connection is required at runtime. The upstream license is available at `/swagger/LICENSE.txt`.

## Submit without a token

Select **Public proposals** to read proposal context and submit content or layout suggestions without Authorize. All suggestions stay private until operator approval. See [token-free examples](public-proposals.md). Protected operations use the separate authentication steps below.

Source discovery also requires no authentication: expand `getSources` under **Discovery** to call `GET /api/v1/sources`. It returns source metadata and publication policies, without private content. Changing those policies still requires operator authentication.

## Authorize and execute

1. Open **Authorize** and enter the raw token, without the `Bearer` prefix.
2. Use **bearerAuth** for a producer token or operator credential. Use **controllerAuth** for a separately issued direct control token. Each operation uses its declared scheme; entering a producer token does not grant operator or controller access.
3. Expand an operation, select **Try it out**, fill current IDs/revisions and request fields, then select **Execute**. Inspect the HTTP status and response body.

Use `getCapabilities`, `getSources`, `getCurrentSession` and `getSessionContext` before submitting content. Default source policies require `intent: propose`; producer `apply` also requires explicit source opt-in and a publishing grant. Replace the synthetic example's UUID, session ID, revision and timestamps with current values. Swagger sends real commands: successful proposals remain private until operator review, while authorized direct control changes need no review. See [content integration](client-guide.md) and [source policies and direct control](direct-control.md).

For a control token, read `getControlContext`, then use `setControlScene` or `updateControlWidget` within its granted scope. Hold/Hidden remain in force. Use a fresh request ID for each new command; resend the identical body/ID after a lost response. Read the current state and reconsider revision conflicts before retrying.

The explorer uses explicit bearer authentication and omits cookies from requests. An existing operator login does not authorize Swagger requests. Cookie authentication remains available to ordinary operator clients in the canonical OpenAPI document; it is omitted from the explorer's authorization dialog. Enter an operator bearer credential to execute Operator operations from Swagger.

Tokens are held in page memory and cleared on reload. Log out an authorization in its dialog to replace/remove it. External specification query overrides and the online validator are disabled, following the [Swagger UI configuration options](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/). The page loads only the dashboard's `/openapi.json` and keeps requests on its origin under the existing content security policy. Normal Host/Origin checks, quotas, revision checks and server permissions apply.
