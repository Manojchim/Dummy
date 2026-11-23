"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ZephyrScaleService,
  ZephyrServiceError
} = require("../zephyr-service");
const { createZephyrApiHandler } = require("../zephyr-routes");

const TEST_TOKEN = "test-token-not-a-real-credential";
const EMPTY_PAGE = {
  values: [],
  startAt: 0,
  maxResults: 1,
  total: 0,
  isLast: true
};
const QUIET_LOGGER = {
  info() {},
  warn() {},
  error() {}
};

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function makeService(fetchImpl, options = {}) {
  return new ZephyrScaleService({
    fetchImpl,
    tokenProvider: () => TEST_TOKEN,
    baseUrlProvider: () => "https://api.zephyrscale.smartbear.com/v2",
    timeoutMs: 50,
    retries: 0,
    sleep: async () => {},
    logger: QUIET_LOGGER,
    ...options
  });
}

function makeRouteHarness(service) {
  const handler = createZephyrApiHandler({
    service,
    authorize: () => true,
    readJson: async (request) => request.body,
    sendJson: (response, status, value) => {
      response.statusCode = status;
      response.body = value;
    },
    logger: QUIET_LOGGER
  });

  return async function invoke(path, method = "GET", body) {
    const request = {
      method,
      headers: {},
      body
    };
    const response = {};
    await handler(request, response, new URL(path, "http://127.0.0.1"));
    return response;
  };
}

test("missing and placeholder tokens fail before a network request", async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return jsonResponse(EMPTY_PAGE);
  };
  for (const token of ["", "ABCD_REPLACE_WITH_ACTUAL_TOKEN"]) {
    const service = makeService(fetchImpl, { tokenProvider: () => token });
    await assert.rejects(service.checkConnection(), (error) =>
      error instanceof ZephyrServiceError &&
      error.code === "configuration_missing" &&
      error.statusCode === 503
    );
  }
  assert.equal(fetchCalls, 0);
});

test("health reports missing configuration without claiming an API connection", async () => {
  let fetchCalls = 0;
  const service = makeService(async () => {
    fetchCalls += 1;
    return jsonResponse(EMPTY_PAGE);
  }, { tokenProvider: () => "" });
  const invoke = makeRouteHarness(service);

  const response = await invoke("/api/zephyr/health");

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.configured, false);
  assert.equal(response.body.connected, false);
  assert.equal(response.body.upstreamStatus, undefined);
  assert.equal(fetchCalls, 0);
});

test("a successful health check validates the Zephyr page response", async () => {
  let requestUrl;
  let authorization;
  const service = makeService(async (url, options) => {
    requestUrl = url.toString();
    authorization = options.headers.Authorization;
    return jsonResponse(EMPTY_PAGE);
  });

  const result = await service.checkConnection();

  assert.equal(result.upstreamStatus, 200);
  assert.deepEqual(result.result.values, []);
  assert.equal(requestUrl, "https://api.zephyrscale.smartbear.com/v2/testcases?projectKey=SCRUM&maxResults=1&startAt=0");
  assert.equal(authorization, `Bearer ${TEST_TOKEN}`);
});

test("structured logs omit credentials and request headers", async () => {
  const entries = [];
  const service = makeService(async () => jsonResponse(EMPTY_PAGE), {
    logger: {
      info: (entry) => entries.push(entry),
      warn: (entry) => entries.push(entry),
      error: (entry) => entries.push(entry)
    }
  });

  await service.checkConnection();

  const logged = entries.join("\n");
  assert.match(logged, /"event":"zephyr_request_completed"/);
  assert.doesNotMatch(logged, new RegExp(TEST_TOKEN));
  assert.doesNotMatch(logged, /Authorization/);
});

test("401 and 403 upstream responses are reported without upstream error details", async (t) => {
  for (const [status, code, message] of [
    [401, "upstream_unauthorized", "Zephyr rejected the configured API token."],
    [403, "upstream_forbidden", "The configured Zephyr account lacks permission for this operation."]
  ]) {
    await t.test(`HTTP ${status}`, async () => {
      const service = makeService(async () => jsonResponse({ message: "private upstream detail" }, status));
      await assert.rejects(service.checkConnection(), (error) =>
        error.code === code &&
        error.upstreamStatusCode === status &&
        error.message === message &&
        !error.message.includes("private upstream detail")
      );
    });
  }
});

test("timeouts and 5xx responses become safe gateway errors", async (t) => {
  await t.test("timeout", async () => {
    const fetchImpl = async () => {
      const error = new Error("internal network detail");
      error.name = "TimeoutError";
      throw error;
    };
    const service = makeService(fetchImpl);
    await assert.rejects(service.checkConnection(), (error) =>
      error.code === "upstream_timeout" &&
      error.statusCode === 504 &&
      !error.message.includes("internal network detail")
    );
  });

  await t.test("server failure", async () => {
    const service = makeService(async () => jsonResponse({ message: "private detail" }, 503));
    await assert.rejects(service.checkConnection(), (error) =>
      error.code === "upstream_unavailable" &&
      error.statusCode === 502 &&
      error.upstreamStatusCode === 503
    );
  });
});

test("429 responses retry safe reads and preserve throttling information", async (t) => {
  await t.test("successful retry", async () => {
    let calls = 0;
    const delays = [];
    const service = makeService(async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "2" } })
        : jsonResponse(EMPTY_PAGE);
    }, {
      retries: 1,
      sleep: async (milliseconds) => delays.push(milliseconds)
    });

    await service.checkConnection();

    assert.equal(calls, 2);
    assert.deepEqual(delays, [2000]);
  });

  await t.test("exhausted retry", async () => {
    const service = makeService(async () =>
      new Response(null, { status: 429, headers: { "retry-after": "1" } })
    );
    await assert.rejects(service.checkConnection(), (error) =>
      error.code === "upstream_rate_limited" &&
      error.statusCode === 503 &&
      error.upstreamStatusCode === 429 &&
      error.retryAfter === 1000
    );
  });

  await t.test("long retry-after is surfaced without retrying early", async () => {
    let calls = 0;
    const service = makeService(async () => {
      calls += 1;
      return new Response(null, { status: 429, headers: { "retry-after": "3600" } });
    }, { retries: 1 });
    await assert.rejects(service.checkConnection(), (error) =>
      error.code === "upstream_rate_limited" &&
      error.retryAfter === 3600000
    );
    assert.equal(calls, 1);
  });
});

test("test case and test cycle reads use the documented project-scoped endpoints", async (t) => {
  await t.test("test case by key", async () => {
    let requestUrl;
    const service = makeService(async (url) => {
      requestUrl = url.toString();
      return jsonResponse({ key: "SCRUM-T1", name: "Existing case" });
    });
    const result = await service.getTestCase("SCRUM-T1");
    assert.equal(result.key, "SCRUM-T1");
    assert.equal(requestUrl, "https://api.zephyrscale.smartbear.com/v2/testcases/SCRUM-T1");
  });

  await t.test("test cycles", async () => {
    let requestUrl;
    const page = { values: [], startAt: 0, maxResults: 10, total: 0, isLast: true };
    const service = makeService(async (url) => {
      requestUrl = url.toString();
      return jsonResponse(page);
    });
    const result = await service.listTestCycles({ maxResults: 10 });
    assert.deepEqual(result, page);
    assert.equal(requestUrl, "https://api.zephyrscale.smartbear.com/v2/testcycles?projectKey=SCRUM&maxResults=10&startAt=0");
  });

  await t.test("not found status is preserved", async () => {
    const service = makeService(async () =>
      new Response(null, { status: 404 })
    );
    await assert.rejects(service.getTestCase("SCRUM-T99"), (error) =>
      error.statusCode === 404 && error.upstreamStatusCode === 404
    );
  });
});

test("test execution creation and status updates use documented fields", async (t) => {
  await t.test("create execution", async () => {
    let requestBody;
    const service = makeService(async (url, options) => {
      requestBody = JSON.parse(options.body);
      assert.equal(url.pathname, "/v2/testexecutions");
      assert.equal(options.method, "POST");
      return jsonResponse({ id: 7001 }, 201);
    });
    const created = await service.createTestExecution({
      projectKey: "SCRUM",
      testCaseKey: "SCRUM-T1",
      testCycleKey: "SCRUM-R2",
      statusName: "Not Executed",
      testScriptResults: [{
        statusName: "Pass",
        actualResult: "The expected screen was displayed."
      }]
    });
    assert.equal(created.id, 7001);
    assert.equal(requestBody.testCaseKey, "SCRUM-T1");
    assert.equal(requestBody.testCycleKey, "SCRUM-R2");
    assert.equal(requestBody.testScriptResults[0].actualResult, "The expected screen was displayed.");
  });

  await t.test("update execution comment and status", async () => {
    let requestBody;
    const service = makeService(async (url, options) => {
      requestBody = JSON.parse(options.body);
      assert.equal(url.pathname, "/v2/testexecutions/SCRUM-E9");
      assert.equal(options.method, "PUT");
      return jsonResponse({ key: "SCRUM-E9" });
    });
    const updated = await service.updateTestExecution("SCRUM-E9", {
      statusName: "Pass",
      comment: "Observed expected response."
    });
    assert.equal(updated.key, "SCRUM-E9");
    assert.deepEqual(requestBody, {
      statusName: "Pass",
      comment: "Observed expected response."
    });
  });
});

test("execution evidence uses the documented binary upload contract", async () => {
  let uploadedContent;
  const service = makeService(async (url, options) => {
    uploadedContent = {
      path: url.pathname,
      method: options.method,
      contentType: options.headers["Content-Type"],
      body: options.body
    };
    return new Response(null, { status: 200 });
  });
  const file = Buffer.from("mock-evidence");

  const result = await service.uploadTestExecutionAttachment(
    "SCRUM-E9",
    "trace.zip",
    file
  );

  assert.equal(result, null);
  assert.equal(uploadedContent.path, "/v2/testexecutions/SCRUM-E9/attachments/trace.zip");
  assert.equal(uploadedContent.method, "PUT");
  assert.equal(uploadedContent.contentType, "application/octet-stream");
  assert.deepEqual(uploadedContent.body, file);
});

test("invalid create payloads are rejected before contacting Zephyr", async () => {
  let fetchCalls = 0;
  const service = makeService(async () => {
    fetchCalls += 1;
    return jsonResponse(EMPTY_PAGE);
  });
  const invoke = makeRouteHarness(service);

  const response = await invoke("/api/zephyr/testcases", "POST", {
    projectKey: "OTHER",
    name: "Should not be forwarded"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "invalid_request");
  assert.equal(fetchCalls, 0);
});

test("unsupported pagination and foreign-project keys are rejected locally", async () => {
  let fetchCalls = 0;
  const service = makeService(async () => {
    fetchCalls += 1;
    return jsonResponse(EMPTY_PAGE);
  });
  await assert.rejects(service.listTestCases({ projectKey: "OTHER" }), { statusCode: 400 });
  await assert.rejects(service.getTestCase("OTHER-T1"), { statusCode: 400 });
  await assert.rejects(service.listTestCycles({ maxResults: 10, startAt: 1 }), { statusCode: 400 });
  assert.equal(fetchCalls, 0);
});

test("duplicate test case names are detected before creation", async () => {
  const requestUrls = [];
  const service = makeService(async (url) => {
    requestUrls.push(url.toString());
    const startAtId = Number(url.searchParams.get("startAtId"));
    return startAtId === 0
      ? jsonResponse({
        values: [{ key: "SCRUM-T43", name: "Another case" }],
        limit: 1000,
        nextStartAtId: 25
      })
      : jsonResponse({
        values: [{ key: "SCRUM-T44", name: "Existing Regression Case" }],
        limit: 1000,
        nextStartAtId: null
      });
  });

  await assert.rejects(service.createTestCase({
    projectKey: "SCRUM",
    name: " existing   regression case "
  }), (error) =>
    error.code === "duplicate_test_case" &&
    error.statusCode === 409 &&
    error.message.includes("SCRUM-T44")
  );
  assert.equal(requestUrls.length, 2);
  assert.match(requestUrls[0], /\/testcases\/nextgen\?/);
  assert.equal(new URL(requestUrls[1]).searchParams.get("startAtId"), "25");
});

test("test case creation uses a read-before-write duplicate check and returns the generated key", async () => {
  const calls = [];
  const service = makeService(async (url, options) => {
    calls.push({ url: url.toString(), method: options.method });
    if (url.pathname.endsWith("/testcases/nextgen")) {
      return jsonResponse({ values: [], limit: 1000, nextStartAtId: null });
    }
    return jsonResponse({ key: "SCRUM-T45" }, 201);
  });

  const created = await service.createTestCase({
    projectKey: "SCRUM",
    name: "A new case"
  });

  assert.equal(created.key, "SCRUM-T45");
  assert.deepEqual(calls.map(({ method }) => method), ["GET", "POST"]);
});
