"use strict";

const DEFAULT_API_BASE_URL = "https://api.zephyrscale.smartbear.com/v2";
const PROJECT_KEY = "SCRUM";
const PLACEHOLDER_TOKEN = "ABCD_REPLACE_WITH_ACTUAL_TOKEN";
const ALLOWED_API_BASE_URLS = new Set([
  "https://api.zephyrscale.smartbear.com/v2",
  "https://eu.api.zephyrscale.smartbear.com/v2",
  "https://au.api.zephyrscale.smartbear.com/v2",
  "https://de.api.zephyrscale.smartbear.com/v2"
]);

const TEST_CASE_KEY = /^[A-Z][A-Z0-9_]*-T\d+$/;
const TEST_CYCLE_KEY = /^[A-Z][A-Z0-9_]*-R\d+$/;
const TEST_EXECUTION_KEY = /^[A-Z][A-Z0-9_]*-E\d+$/;
const UPDATE_TEST_CASE_FIELDS = new Set([
  "id", "key", "name", "project", "objective", "precondition", "estimatedTime",
  "labels", "component", "priority", "status", "folder", "owner", "customFields"
]);
const UPDATE_TEST_CYCLE_FIELDS = new Set([
  "id", "key", "name", "project", "jiraProjectVersion", "status", "folder",
  "description", "plannedStartDate", "plannedEndDate", "owner", "customFields"
]);
const UPDATE_TEST_EXECUTION_FIELDS = new Set([
  "statusName", "environmentName", "actualEndDate", "executionTime",
  "automated", "executedById", "assignedToId", "comment"
]);
const CREATE_TEST_CASE_FIELDS = new Set([
  "projectKey", "name", "objective", "precondition", "estimatedTime",
  "componentId", "priorityName", "statusName", "folderId", "ownerId",
  "labels", "customFields"
]);
const CREATE_TEST_CYCLE_FIELDS = new Set([
  "projectKey", "name", "description", "plannedStartDate", "plannedEndDate",
  "jiraProjectVersion", "statusName", "folderId", "ownerId", "customFields"
]);
const CREATE_TEST_EXECUTION_FIELDS = new Set([
  "projectKey", "testCaseKey", "testCycleKey", "statusName",
  "testScriptResults", "environmentName", "actualEndDate", "executionTime",
  "executedById", "assignedToId", "comment", "customFields", "automated"
]);
const TEST_SCRIPT_RESULT_FIELDS = new Set(["statusName", "actualEndDate", "actualResult"]);

class ZephyrServiceError extends Error {
  constructor(message, {
    code = "zephyr_error",
    statusCode = 502,
    upstreamStatusCode,
    retryAfter
  } = {}) {
    super(message);
    this.name = "ZephyrServiceError";
    this.code = code;
    this.statusCode = statusCode;
    this.upstreamStatusCode = upstreamStatusCode;
    this.retryAfter = retryAfter;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) {
    throw new ZephyrServiceError(`${label} must be a JSON object.`, {
      code: "invalid_request",
      statusCode: 400
    });
  }
}

function assertAllowedFields(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new ZephyrServiceError(`${label} contains unsupported field(s): ${unexpected.join(", ")}.`, {
      code: "invalid_request",
      statusCode: 400
    });
  }
}

function assertNonBlankString(value, label, maxLength = 255) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new ZephyrServiceError(`${label} must be a non-empty string of at most ${maxLength} characters.`, {
      code: "invalid_request",
      statusCode: 400
    });
  }
}

function assertProjectKey(projectKey = PROJECT_KEY) {
  if (projectKey !== PROJECT_KEY) {
    throw new ZephyrServiceError(`Only the ${PROJECT_KEY} Jira project is enabled for this integration.`, {
      code: "invalid_request",
      statusCode: 400
    });
  }
  return projectKey;
}

function assertTestCaseKey(key) {
  if (typeof key !== "string" || !TEST_CASE_KEY.test(key) || !key.startsWith(`${PROJECT_KEY}-`)) {
    throw new ZephyrServiceError("A valid Zephyr test case key is required.", {
      code: "invalid_request",
      statusCode: 400
    });
  }
  return key;
}

function assertTestCycleIdOrKey(value) {
  if (typeof value !== "string" ||
    (!(value.startsWith(`${PROJECT_KEY}-`) && TEST_CYCLE_KEY.test(value)) && !/^\d+$/.test(value))) {
    throw new ZephyrServiceError("A valid Zephyr test cycle ID or key is required.", {
      code: "invalid_request",
      statusCode: 400
    });
  }
  return value;
}

function assertTestExecutionIdOrKey(value) {
  if (typeof value !== "string" ||
    (!(value.startsWith(`${PROJECT_KEY}-`) && TEST_EXECUTION_KEY.test(value)) && !/^\d+$/.test(value))) {
    throw new ZephyrServiceError("A valid Zephyr test execution ID or key is required.", {
      code: "invalid_request",
      statusCode: 400
    });
  }
  return value;
}

function assertPagedList(value, label) {
  if (!isRecord(value) || !Array.isArray(value.values) ||
    !Number.isInteger(value.startAt) || !Number.isInteger(value.maxResults)) {
    throw new ZephyrServiceError(`Zephyr returned an invalid ${label} list response.`, {
      code: "invalid_response",
      statusCode: 502
    });
  }
  return value;
}

function assertCursorPage(value) {
  if (!isRecord(value) || !Array.isArray(value.values) ||
    !Number.isInteger(value.limit) || !("nextStartAtId" in value)) {
    throw new ZephyrServiceError("Zephyr returned an invalid test case search response.", {
      code: "invalid_response",
      statusCode: 502
    });
  }
  return value;
}

function validateCreateTestCase(payload) {
  assertRecord(payload, "Test case");
  assertAllowedFields(payload, CREATE_TEST_CASE_FIELDS, "Test case");
  assertProjectKey(payload.projectKey);
  assertNonBlankString(payload.name, "Test case name");
  if (payload.objective !== undefined && typeof payload.objective !== "string") {
    throw new ZephyrServiceError("Test case objective must be a string.", { code: "invalid_request", statusCode: 400 });
  }
  if (payload.precondition !== undefined && typeof payload.precondition !== "string") {
    throw new ZephyrServiceError("Test case precondition must be a string.", { code: "invalid_request", statusCode: 400 });
  }
}

function validateUpdateTestCase(key, payload) {
  assertTestCaseKey(key);
  assertRecord(payload, "Test case update");
  assertAllowedFields(payload, UPDATE_TEST_CASE_FIELDS, "Test case update");
  for (const field of ["id", "key", "name", "project", "priority", "status"]) {
    if (!(field in payload)) {
      throw new ZephyrServiceError(`Test case update requires ${field}.`, { code: "invalid_request", statusCode: 400 });
    }
  }
  if (payload.key !== key) {
    throw new ZephyrServiceError("The test case key in the body must match the URL.", {
      code: "invalid_request",
      statusCode: 400
    });
  }
  assertNonBlankString(payload.name, "Test case name");
  if (!isRecord(payload.project) || payload.project.key !== PROJECT_KEY) assertProjectKey(payload.project?.key);
}

function validateCreateTestCycle(payload) {
  assertRecord(payload, "Test cycle");
  assertAllowedFields(payload, CREATE_TEST_CYCLE_FIELDS, "Test cycle");
  assertProjectKey(payload.projectKey);
  assertNonBlankString(payload.name, "Test cycle name");
  if (payload.description !== undefined && typeof payload.description !== "string") {
    throw new ZephyrServiceError("Test cycle description must be a string.", { code: "invalid_request", statusCode: 400 });
  }
}

function validateUpdateTestCycle(key, payload) {
  assertTestCycleIdOrKey(key);
  assertRecord(payload, "Test cycle update");
  assertAllowedFields(payload, UPDATE_TEST_CYCLE_FIELDS, "Test cycle update");
  for (const field of ["id", "key", "name", "project", "status"]) {
    if (!(field in payload)) {
      throw new ZephyrServiceError(`Test cycle update requires ${field}.`, { code: "invalid_request", statusCode: 400 });
    }
  }
  if (typeof payload.key !== "string" || !TEST_CYCLE_KEY.test(payload.key) ||
    !payload.key.startsWith(`${PROJECT_KEY}-`) ||
    (!/^\d+$/.test(key) && payload.key !== key)) {
    throw new ZephyrServiceError("The test cycle key in the body must match the SCRUM project and URL.", {
      code: "invalid_request",
      statusCode: 400
    });
  }
  assertNonBlankString(payload.name, "Test cycle name");
  if (!isRecord(payload.project) || payload.project.key !== PROJECT_KEY) assertProjectKey(payload.project?.key);
}

function validateCreateTestExecution(payload) {
  assertRecord(payload, "Test execution");
  assertAllowedFields(payload, CREATE_TEST_EXECUTION_FIELDS, "Test execution");
  assertProjectKey(payload.projectKey);
  assertTestCaseKey(payload.testCaseKey);
  if (typeof payload.testCycleKey !== "string" ||
    !TEST_CYCLE_KEY.test(payload.testCycleKey) ||
    !payload.testCycleKey.startsWith(`${PROJECT_KEY}-`)) {
    throw new ZephyrServiceError(`A ${PROJECT_KEY} test cycle key is required.`, {
      code: "invalid_request",
      statusCode: 400
    });
  }
  assertNonBlankString(payload.statusName, "Execution status");
  if (payload.testScriptResults !== undefined) {
    if (!Array.isArray(payload.testScriptResults)) {
      throw new ZephyrServiceError("Test script results must be an array.", {
        code: "invalid_request",
        statusCode: 400
      });
    }
    for (const [index, result] of payload.testScriptResults.entries()) {
      assertRecord(result, `Test script result ${index + 1}`);
      assertAllowedFields(result, TEST_SCRIPT_RESULT_FIELDS, `Test script result ${index + 1}`);
      assertNonBlankString(result.statusName, `Test script result ${index + 1} status`);
      if (result.actualResult !== undefined && typeof result.actualResult !== "string") {
        throw new ZephyrServiceError(`Test script result ${index + 1} actualResult must be a string.`, {
          code: "invalid_request",
          statusCode: 400
        });
      }
    }
  }
}

function validateUpdateTestExecution(key, payload) {
  assertTestExecutionIdOrKey(key);
  assertRecord(payload, "Test execution update");
  assertAllowedFields(payload, UPDATE_TEST_EXECUTION_FIELDS, "Test execution update");
  if (Object.keys(payload).length === 0) {
    throw new ZephyrServiceError("Test execution update must include at least one supported field.", {
      code: "invalid_request",
      statusCode: 400
    });
  }
  if (payload.statusName !== undefined) assertNonBlankString(payload.statusName, "Execution status");
  if (payload.comment !== undefined && typeof payload.comment !== "string") {
    throw new ZephyrServiceError("Execution comment must be a string.", { code: "invalid_request", statusCode: 400 });
  }
  if (payload.executionTime !== undefined && (!Number.isInteger(payload.executionTime) || payload.executionTime < 0)) {
    throw new ZephyrServiceError("Execution time must be a non-negative integer.", { code: "invalid_request", statusCode: 400 });
  }
  if (payload.automated !== undefined && typeof payload.automated !== "boolean") {
    throw new ZephyrServiceError("The automated field must be a boolean.", { code: "invalid_request", statusCode: 400 });
  }
}

function validateIssueId(issueId) {
  const numericId = typeof issueId === "string" && /^\d+$/.test(issueId)
    ? Number(issueId)
    : issueId;
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    throw new ZephyrServiceError("A positive numeric Jira issueId is required by the Zephyr API.", {
      code: "invalid_request",
      statusCode: 400
    });
  }
  return numericId;
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function safeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ZephyrServiceError("Zephyr API base URL configuration is invalid.", {
      code: "invalid_configuration",
      statusCode: 503
    });
  }
  const normalized = `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    !ALLOWED_API_BASE_URLS.has(normalized)) {
    throw new ZephyrServiceError("Zephyr API base URL must match a documented HTTPS region.", {
      code: "invalid_configuration",
      statusCode: 503
    });
  }
  return normalized;
}

function retryAfterMilliseconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function mapUpstreamError(statusCode, retryAfter) {
  if (statusCode === 400) {
    return { code: "upstream_bad_request", statusCode: 400, message: "Zephyr rejected the request. Check the documented fields and project configuration." };
  }
  if (statusCode === 409) {
    return { code: "upstream_conflict", statusCode: 409, message: "Zephyr reported a conflict for this resource or link." };
  }
  if (statusCode === 401) {
    return { code: "upstream_unauthorized", statusCode: 502, message: "Zephyr rejected the configured API token." };
  }
  if (statusCode === 403) {
    return { code: "upstream_forbidden", statusCode: 502, message: "The configured Zephyr account lacks permission for this operation." };
  }
  if (statusCode === 404) {
    return { code: "upstream_not_found", statusCode: 404, message: "The requested Zephyr resource or project was not found or is inaccessible." };
  }
  if (statusCode === 422) {
    return { code: "upstream_validation_error", statusCode: 422, message: "Zephyr rejected a status, environment, or other resource value." };
  }
  if (statusCode === 429) {
    return { code: "upstream_rate_limited", statusCode: 503, message: "Zephyr rate-limited the request; retry later.", retryAfter };
  }
  if (statusCode >= 500) {
    return { code: "upstream_unavailable", statusCode: 502, message: "Zephyr Scale is temporarily unavailable." };
  }
  return { code: "upstream_error", statusCode: 502, message: "Zephyr returned an unexpected response." };
}

class ZephyrScaleService {
  constructor({
    fetchImpl = globalThis.fetch,
    tokenProvider = () => process.env.ZEPHYR_SCALE_API_TOKEN,
    baseUrlProvider = () => process.env.ZEPHYR_SCALE_API_BASE_URL || DEFAULT_API_BASE_URL,
    timeoutMs = 10000,
    retries = 2,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logger = console
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("A Fetch API implementation is required.");
    this.fetchImpl = fetchImpl;
    this.tokenProvider = tokenProvider;
    this.baseUrlProvider = baseUrlProvider;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.sleep = sleep;
    this.logger = logger;
    this.createLocks = new Map();
  }

  getConfiguration() {
    const token = this.tokenProvider();
    if (typeof token !== "string" || !token.trim() || token.trim() !== token ||
      /\s/.test(token) || token === PLACEHOLDER_TOKEN) {
      throw new ZephyrServiceError("Zephyr API token is not configured. Set ZEPHYR_SCALE_API_TOKEN on the backend.", {
        code: "configuration_missing",
        statusCode: 503
      });
    }
    return {
      token,
      baseUrl: safeBaseUrl(this.baseUrlProvider() || DEFAULT_API_BASE_URL)
    };
  }

  log(level, event) {
    const loggerMethod = this.logger?.[level];
    if (typeof loggerMethod !== "function") return;
    loggerMethod.call(this.logger, JSON.stringify(event));
  }

  async request(path, {
    method = "GET",
    query,
    body,
    contentType,
    allowEmptyResponse = false,
    includeResponseMetadata = false
  } = {}) {
    const { token, baseUrl } = this.getConfiguration();
    const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    };
    let requestBody;
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
      requestBody = body;
      headers["Content-Type"] = contentType || "application/octet-stream";
    } else if (body !== undefined) {
      requestBody = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }

    const canRetry = method === "GET" || method === "PUT";
    const safePath = url.pathname.replace(`${new URL(baseUrl).pathname}/`, "/");
    for (let attempt = 0; ; attempt += 1) {
      const startedAt = Date.now();
      let response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers,
          body: requestBody,
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        if (canRetry && attempt < this.retries && (timedOut || error?.name === "TypeError")) {
          this.log("warn", {
            event: "zephyr_request_retry",
            method,
            path: safePath,
            reason: timedOut ? "timeout" : "network",
            attempt: attempt + 1
          });
          await this.sleep(Math.min(500 * (2 ** attempt), 4000));
          continue;
        }
        this.log("error", {
          event: "zephyr_request_failed",
          method,
          path: safePath,
          reason: timedOut ? "timeout" : "network",
          durationMs: Date.now() - startedAt
        });
        throw new ZephyrServiceError(
          timedOut ? "The Zephyr request timed out." : "Unable to reach Zephyr Scale.",
          { code: timedOut ? "upstream_timeout" : "upstream_network_error", statusCode: timedOut ? 504 : 502 }
        );
      }

      const retryAfter = response.headers.get("retry-after");
      if ((response.status === 429 || response.status >= 500) && canRetry && attempt < this.retries) {
        const delay = retryAfterMilliseconds(retryAfter) ??
          (response.status === 429 ? Math.min(1000 * (2 ** attempt), 30000) : Math.min(500 * (2 ** attempt), 4000));
        if (delay <= 30000) {
          await response.body?.cancel();
          this.log("warn", {
            event: "zephyr_request_retry",
            method,
            path: safePath,
            reason: response.status === 429 ? "rate_limit" : "upstream_server",
            upstreamStatus: response.status,
            attempt: attempt + 1
          });
          await this.sleep(delay);
          continue;
        }
      }

      if (!response.ok) {
        await response.body?.cancel();
        const mapped = mapUpstreamError(response.status, retryAfterMilliseconds(retryAfter));
        this.log("error", {
          event: "zephyr_request_failed",
          method,
          path: safePath,
          upstreamStatus: response.status,
          durationMs: Date.now() - startedAt
        });
        throw new ZephyrServiceError(mapped.message, {
          code: mapped.code,
          statusCode: mapped.statusCode,
          upstreamStatusCode: response.status,
          retryAfter: mapped.retryAfter
        });
      }

      this.log("info", {
        event: "zephyr_request_completed",
        method,
        path: safePath,
        upstreamStatus: response.status,
        durationMs: Date.now() - startedAt
      });
      if (response.status === 204) {
        return includeResponseMetadata ? { data: null, status: response.status } : null;
      }
      const text = await response.text();
      if (!text && allowEmptyResponse) {
        return includeResponseMetadata ? { data: null, status: response.status } : null;
      }
      if (!text) {
        throw new ZephyrServiceError("Zephyr returned an empty response where JSON was expected.", {
          code: "invalid_response",
          statusCode: 502,
          upstreamStatusCode: response.status
        });
      }
      try {
        const data = JSON.parse(text);
        return includeResponseMetadata ? { data, status: response.status } : data;
      } catch {
        throw new ZephyrServiceError("Zephyr returned an invalid JSON response.", {
          code: "invalid_response",
          statusCode: 502,
          upstreamStatusCode: response.status
        });
      }
    }
  }

  async checkConnection(projectKey = PROJECT_KEY) {
    assertProjectKey(projectKey);
    const response = await this.request("/testcases", {
      query: { projectKey, maxResults: 1, startAt: 0 },
      includeResponseMetadata: true
    });
    if (response.status !== 200) {
      throw new ZephyrServiceError("Zephyr returned an unexpected status for the health check.", {
        code: "invalid_response",
        statusCode: 502,
        upstreamStatusCode: response.status
      });
    }
    return {
      result: assertPagedList(response.data, "test case"),
      upstreamStatus: response.status
    };
  }

  async listTestCases({ projectKey = PROJECT_KEY, maxResults = 100, startAt = 0 } = {}) {
    assertProjectKey(projectKey);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 1000 ||
      !Number.isInteger(startAt) || startAt < 0 || startAt > 1000000 || startAt % maxResults !== 0) {
      throw new ZephyrServiceError("Invalid Zephyr test case pagination values.", {
        code: "invalid_request",
        statusCode: 400
      });
    }
    return assertPagedList(await this.request("/testcases", {
      query: { projectKey, maxResults, startAt }
    }), "test case");
  }

  async getTestCase(key) {
    assertTestCaseKey(key);
    return this.request(`/testcases/${encodeURIComponent(key)}`);
  }

  async findExistingTestCaseByName(name, projectKey = PROJECT_KEY) {
    assertNonBlankString(name, "Test case name");
    assertProjectKey(projectKey);
    let startAtId = 0;
    const normalizedName = normalizeName(name);
    for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
      const page = assertCursorPage(await this.request("/testcases/nextgen", {
        query: { projectKey, limit: 1000, startAtId }
      }));
      const existing = page.values.find((testCase) =>
        typeof testCase?.name === "string" && normalizeName(testCase.name) === normalizedName
      );
      if (existing) return existing;
      if (page.nextStartAtId === null || page.nextStartAtId === undefined) return null;
      if (!Number.isInteger(page.nextStartAtId) || page.nextStartAtId <= startAtId) {
        throw new ZephyrServiceError("Zephyr returned invalid test case pagination metadata.", {
          code: "invalid_response",
          statusCode: 502
        });
      }
      startAtId = page.nextStartAtId;
    }
    throw new ZephyrServiceError("Zephyr test case search exceeded the pagination safety limit.", {
      code: "pagination_limit",
      statusCode: 502
    });
  }

  async createTestCase(payload) {
    validateCreateTestCase(payload);
    const lockKey = `${payload.projectKey}:${normalizeName(payload.name)}`;
    if (this.createLocks.has(lockKey)) return this.createLocks.get(lockKey);
    const operation = this.createTestCaseIfUnique(payload);
    this.createLocks.set(lockKey, operation);
    try {
      return await operation;
    } finally {
      this.createLocks.delete(lockKey);
    }
  }

  async createTestCaseIfUnique(payload) {
    const duplicate = await this.findExistingTestCaseByName(payload.name, payload.projectKey);
    if (duplicate) {
      throw new ZephyrServiceError(`A test case named "${payload.name.trim()}" already exists (${duplicate.key}).`, {
        code: "duplicate_test_case",
        statusCode: 409
      });
    }
    const created = await this.request("/testcases", { method: "POST", body: payload });
    if (!isRecord(created) || typeof created.key !== "string" || !TEST_CASE_KEY.test(created.key)) {
      throw new ZephyrServiceError("Zephyr did not return a valid test case key after creation.", {
        code: "invalid_response",
        statusCode: 502
      });
    }
    return created;
  }

  async updateTestCase(key, payload) {
    validateUpdateTestCase(key, payload);
    return this.request(`/testcases/${encodeURIComponent(key)}`, { method: "PUT", body: payload });
  }

  async linkTestCaseToIssue(key, issueId) {
    assertTestCaseKey(key);
    return this.request(`/testcases/${encodeURIComponent(key)}/links/issues`, {
      method: "POST",
      body: { issueId: validateIssueId(issueId) }
    });
  }

  async listTestCycles({ projectKey = PROJECT_KEY, maxResults = 100, startAt = 0 } = {}) {
    assertProjectKey(projectKey);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 1000 ||
      !Number.isInteger(startAt) || startAt < 0 || startAt > 1000000 || startAt % maxResults !== 0) {
      throw new ZephyrServiceError("Invalid Zephyr test cycle pagination values.", {
        code: "invalid_request",
        statusCode: 400
      });
    }
    return assertPagedList(await this.request("/testcycles", {
      query: { projectKey, maxResults, startAt }
    }), "test cycle");
  }

  async createTestCycle(payload) {
    validateCreateTestCycle(payload);
    const created = await this.request("/testcycles", { method: "POST", body: payload });
    if (!isRecord(created) || typeof created.key !== "string" || !TEST_CYCLE_KEY.test(created.key)) {
      throw new ZephyrServiceError("Zephyr did not return a valid test cycle key after creation.", {
        code: "invalid_response",
        statusCode: 502
      });
    }
    return created;
  }

  async getTestCycle(idOrKey) {
    assertTestCycleIdOrKey(idOrKey);
    return this.request(`/testcycles/${encodeURIComponent(idOrKey)}`);
  }

  async updateTestCycle(idOrKey, payload) {
    validateUpdateTestCycle(idOrKey, payload);
    return this.request(`/testcycles/${encodeURIComponent(idOrKey)}`, { method: "PUT", body: payload });
  }

  async listTestExecutions({
    projectKey = PROJECT_KEY,
    testCycle,
    testCase,
    maxResults = 100,
    startAt = 0
  } = {}) {
    assertProjectKey(projectKey);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 1000 ||
      !Number.isInteger(startAt) || startAt < 0 || startAt > 1000000 || startAt % maxResults !== 0) {
      throw new ZephyrServiceError("Invalid Zephyr test execution pagination values.", {
        code: "invalid_request",
        statusCode: 400
      });
    }
    if (testCycle !== undefined) assertTestCycleIdOrKey(testCycle);
    if (testCase !== undefined) assertTestCaseKey(testCase);
    return assertPagedList(await this.request("/testexecutions", {
      query: { projectKey, testCycle, testCase, maxResults, startAt }
    }), "test execution");
  }

  async createTestExecution(payload) {
    validateCreateTestExecution(payload);
    const created = await this.request("/testexecutions", { method: "POST", body: payload });
    if (!isRecord(created) || !(typeof created.key === "string" ||
      Number.isInteger(created.id) || (typeof created.id === "string" && /^\d+$/.test(created.id)))) {
      throw new ZephyrServiceError("Zephyr did not return a valid test execution identifier after creation.", {
        code: "invalid_response",
        statusCode: 502
      });
    }
    return created;
  }

  async getTestExecution(idOrKey) {
    assertTestExecutionIdOrKey(idOrKey);
    return this.request(`/testexecutions/${encodeURIComponent(idOrKey)}`);
  }

  async updateTestExecution(idOrKey, payload) {
    validateUpdateTestExecution(idOrKey, payload);
    return this.request(`/testexecutions/${encodeURIComponent(idOrKey)}`, {
      method: "PUT",
      body: payload
    });
  }

  async linkTestExecutionToIssue(idOrKey, issueId) {
    assertTestExecutionIdOrKey(idOrKey);
    return this.request(`/testexecutions/${encodeURIComponent(idOrKey)}/links/issues`, {
      method: "POST",
      body: { issueId: validateIssueId(issueId) }
    });
  }

  async uploadTestExecutionAttachment(idOrKey, fileName, content) {
    assertTestExecutionIdOrKey(idOrKey);
    if (typeof fileName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName) ||
      fileName === "." || fileName === "..") {
      throw new ZephyrServiceError("Attachment file name is invalid.", { code: "invalid_request", statusCode: 400 });
    }
    if (!Buffer.isBuffer(content) || content.length === 0) {
      throw new ZephyrServiceError("Attachment content must be a non-empty binary file.", {
        code: "invalid_request",
        statusCode: 400
      });
    }
    return this.request(
      `/testexecutions/${encodeURIComponent(idOrKey)}/attachments/${encodeURIComponent(fileName)}`,
      { method: "PUT", body: content, contentType: "application/octet-stream", allowEmptyResponse: true }
    );
  }
}

module.exports = {
  DEFAULT_API_BASE_URL,
  PROJECT_KEY,
  ZephyrScaleService,
  ZephyrServiceError,
  validateCreateTestCase,
  validateUpdateTestCase,
  validateCreateTestCycle,
  validateUpdateTestCycle,
  validateCreateTestExecution,
  validateUpdateTestExecution,
  validateIssueId
};
