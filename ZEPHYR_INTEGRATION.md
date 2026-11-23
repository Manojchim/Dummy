# Zephyr Scale Cloud integration

The backend uses the existing Node.js HTTP server and Node's built-in `fetch`; no new runtime dependency is required. All Zephyr requests are made server-side by `zephyr-service.js`. The browser never receives the Zephyr API token.

## Configuration

1. Generate a Zephyr Scale Cloud API access token from Jira's Zephyr API keys page. The official API documentation describes this as a Bearer token.
2. Copy `.env.example` to `.env` and replace `ABCD_REPLACE_WITH_ACTUAL_TOKEN` with the token locally. Keep `.env` out of source control; `.gitignore` already excludes it. Do not put the token in frontend variables, source files, or workspace settings.
3. Keep the US endpoint configured:

   ```text
   ZEPHYR_SCALE_API_BASE_URL=https://api.zephyrscale.smartbear.com/v2
   ```

   The backend only accepts the official HTTPS regional bases listed in SmartBear's OpenAPI specification.
4. Configure `STRIDE_ADMIN_TOKEN` with a random value of at least 32 characters. This existing backend credential protects every `/api/zephyr/*` route; it is separate from the Zephyr API token.
5. Start with `npm start` (Node.js 22.13 or newer). The project uses Node's `--env-file-if-exists` support to load `.env`; no `dotenv` package is needed.

The `.env.example` token is deliberately a dummy value. The backend treats that exact placeholder as missing configuration and will not send it to Zephyr.

## Access control and requests

The server binds to `127.0.0.1` by default, does not enable CORS, and requires the existing administrator Bearer token for all Zephyr routes. Send that local token in the `Authorization` header. The Zephyr token remains server-side and is never returned in health or API responses.

| Method | Local endpoint | Function |
|---|---|---|
| GET | `/api/zephyr/health` | Makes an authenticated, read-only test-case list request and validates the response shape |
| GET | `/api/zephyr/testcases?projectKey=SCRUM&maxResults=100&startAt=0` | List a page of test cases |
| GET | `/api/zephyr/testcases/:key` | Retrieve a test case |
| POST | `/api/zephyr/testcases` | Check for an exact name duplicate, then create a test case |
| PUT | `/api/zephyr/testcases/:key` | Update a test case using the documented update schema |
| POST | `/api/zephyr/testcases/:key/link` | Link a test case to a Jira issue using its numeric `issueId` |
| GET | `/api/zephyr/testcycles?projectKey=SCRUM&maxResults=100&startAt=0` | List a page of test cycles |
| POST | `/api/zephyr/testcycles` | Create a test cycle |
| GET / PUT | `/api/zephyr/testcycles/:idOrKey` | Retrieve or update a test cycle |
| GET | `/api/zephyr/testexecutions?projectKey=SCRUM&maxResults=100&startAt=0` | List executions; optional `testCycle` and `testCase` filters are supported |
| POST | `/api/zephyr/testexecutions` | Create an execution for a test case and cycle |
| GET / PUT | `/api/zephyr/testexecutions/:idOrKey` | Retrieve or update an execution |
| POST | `/api/zephyr/testexecutions/:idOrKey/link` | Link an execution to a Jira issue using numeric `issueId` |
| POST | `/api/zephyr/testexecutions/:idOrKey/attachments/:fileName` | Upload raw evidence (`image/png`, `image/jpeg`, `application/zip`, `text/plain`, and other listed types; 10 MB maximum) |

List routes expose the documented offset pagination parameters and enforce Zephyr's `maxResults` and `startAt` bounds. Duplicate checks scan the project's cursor-paginated `/testcases/nextgen` results and compare normalized exact names, avoiding dependence on server-side search matching semantics. Concurrent duplicate creates within this server process share one pending create; independent external clients are not protected by a distributed lock. Evidence uploads accept the listed local MIME types and forward the raw bytes using the API-required `application/octet-stream` content type.

The documented issue-link payload takes a Jira numeric `issueId`, not an issue key. The integration does not add a separate Jira REST client or Jira API credentials; callers must supply that ID. Execution updates accept `comment` but no top-level `actualResult`; execution creation supports `testScriptResults[].actualResult` for per-step actual results. The API creates an empty test step when creating a test case; use the documented test-step endpoints if managing steps is needed.

The OpenAPI specification does not define a standalone “add test case to cycle” operation. Creating an execution with both `testCaseKey` and `testCycleKey` is the documented association between a test and its cycle.

When Zephyr's project permission system is enabled, the API documentation identifies `CREATE_TEST_CASE`, `EDIT_TEST_CASE`, `CREATE_TEST_RUN`, `EDIT_TEST_RUN`, and `EXECUTE_TEST_RUN` as relevant permissions. The configured account's permissions have not been verified. The published OpenAPI specification does not list OAuth scopes.

## Error behavior

- Missing token or invalid regional base: HTTP 503; no upstream request is made.
- Invalid local input: HTTP 400; unsupported project keys and payload properties are rejected before forwarding.
- Duplicate case name: HTTP 409.
- Upstream 401/403: HTTP 502 with the actual `upstreamStatus` and a sanitized configuration/permission message.
- Upstream 404: HTTP 404; upstream 429: HTTP 503 with retry timing when available; upstream 5xx/network errors: HTTP 502; timeouts: HTTP 504.
- Safe GET and PUT requests retry transient 429/5xx/network/timeouts. POST requests are not automatically retried to avoid duplicate writes.

Logs are structured JSON and include the operation, method, status, and duration only. Authorization headers, tokens, request bodies, and upstream error bodies are not logged or returned.

## Testing

Run the mocked unit/backend suite with:

```text
npm run test:zephyr
```

Tests use only fake credentials and mocked Fetch responses; they do not call Zephyr or create test-management records.

## Connection verification status

The implementation must be considered connected only when `/api/zephyr/health` returns `connected: true` after a successful authenticated upstream response. A configured token or a local server health response alone does not establish connectivity.

Live verification on 2026-11-20: Node loaded both `ZEPHYR_SCALE_API_TOKEN` and `STRIDE_ADMIN_TOKEN` from the local `.env`; `.env` remains ignored by Git. One non-retrying, read-only request to `GET https://api.zephyrscale.smartbear.com/v2/testcases?projectKey=SCRUM&maxResults=1&startAt=0` returned **HTTP 401** with the sanitized response `Zephyr rejected the configured API token.` Authentication was not established, so project test cases were not retrieved and no duplicate check or create request was attempted. No Zephyr records were changed. The token's format alone does not establish that it is a Zephyr Scale Cloud API token; configure an active API token generated from Zephyr Scale's API access-token page. A credential-shaped literal was also removed from the service source; revoke it if it was ever a valid credential. The backend admin handler remains protected by the configured `STRIDE_ADMIN_TOKEN`; no authorized local health request was made after the upstream 401 to avoid a second authentication attempt.

## Official API references

- [Zephyr Scale Cloud REST API and OpenAPI specification](https://support.smartbear.com/zephyr-scale-cloud/api-docs/)
- [Zephyr Scale API access token management](https://support.smartbear.com/zephyr/docs/en/rest-api/api-access-tokens-management.html)
