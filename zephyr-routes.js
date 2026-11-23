"use strict";

const {
  PROJECT_KEY,
  ZephyrScaleService,
  ZephyrServiceError
} = require("./zephyr-service");

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/json",
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain"
]);

function routeError(message, statusCode = 400) {
  return new ZephyrServiceError(message, { code: "invalid_request", statusCode });
}

function decodeParam(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw routeError(`${label} is invalid.`);
  }
}

function positiveIntegerParam(value, name, defaultValue, maximum) {
  if (value === null) return defaultValue;
  if (!/^\d+$/.test(value)) throw routeError(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw routeError(`${name} is outside the supported range.`);
  }
  return parsed;
}

function readProjectKey(searchParams) {
  const projectKey = searchParams.get("projectKey") || PROJECT_KEY;
  if (projectKey !== PROJECT_KEY) {
    throw routeError(`Only the ${PROJECT_KEY} Jira project is enabled for this integration.`);
  }
  return projectKey;
}

async function readBinary(request) {
  const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
    throw routeError("Attachment content type is not supported.", 415);
  }
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES) {
    throw routeError("Attachment exceeds the 10 MB limit.", 413);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += data.length;
    if (length > MAX_ATTACHMENT_BYTES) {
      request.resume?.();
      throw routeError("Attachment exceeds the 10 MB limit.", 413);
    }
    chunks.push(data);
  }
  if (length === 0) throw routeError("Attachment content cannot be empty.");
  return { content: Buffer.concat(chunks, length) };
}

function sendResult(response, status, value, sendJson) {
  if (value === null) {
    response.writeHead(status === 201 ? 204 : status, {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    response.end();
    return;
  }
  sendJson(response, status, value);
}

function createZephyrApiHandler({
  service = new ZephyrScaleService(),
  authorize,
  readJson,
  sendJson,
  logger = console
} = {}) {
  if (typeof authorize !== "function" || typeof readJson !== "function" || typeof sendJson !== "function") {
    throw new TypeError("Zephyr route authorization, JSON reader, and response writer are required.");
  }

  return async function handleZephyrApi(request, response, requestUrl) {
    const { pathname, searchParams } = requestUrl;
    if (!pathname.startsWith("/api/zephyr/")) return false;
    if (!authorize(request, response)) return true;

    const caseLink = pathname.match(/^\/api\/zephyr\/testcases\/([^/]+)\/link$/);
    const testCase = pathname.match(/^\/api\/zephyr\/testcases\/([^/]+)$/);
    const cycle = pathname.match(/^\/api\/zephyr\/testcycles\/([^/]+)$/);
    const executionAttachment = pathname.match(/^\/api\/zephyr\/testexecutions\/([^/]+)\/attachments\/([^/]+)$/);
    const executionLink = pathname.match(/^\/api\/zephyr\/testexecutions\/([^/]+)\/link$/);
    const execution = pathname.match(/^\/api\/zephyr\/testexecutions\/([^/]+)$/);

    try {
      if (pathname === "/api/zephyr/health") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed.", allowedMethods: ["GET"] });
        const { result, upstreamStatus } = await service.checkConnection(PROJECT_KEY);
        return sendJson(response, 200, {
          configured: true,
          connected: true,
          region: "US",
          upstreamStatus,
          testCasesReturned: result.values.length
        });
      }

      if (pathname === "/api/zephyr/testcases") {
        if (request.method === "GET") {
          return sendJson(response, 200, await service.listTestCases({
            projectKey: readProjectKey(searchParams),
            maxResults: positiveIntegerParam(searchParams.get("maxResults"), "maxResults", 100, 1000),
            startAt: positiveIntegerParam(searchParams.get("startAt"), "startAt", 0, 1000000)
          }));
        }
        if (request.method === "POST") {
          return sendJson(response, 201, await service.createTestCase(await readJson(request)));
        }
        return sendJson(response, 405, { error: "Method not allowed.", allowedMethods: ["GET", "POST"] });
      }

      if (caseLink) {
        if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed.", allowedMethods: ["POST"] });
        const payload = await readJson(request);
        return sendResult(response, 201, await service.linkTestCaseToIssue(
          decodeParam(caseLink[1], "Test case key"),
          payload?.issueId
        ), sendJson);
      }

      if (testCase) {
        const key = decodeParam(testCase[1], "Test case key");
        if (request.method === "GET") return sendJson(response, 200, await service.getTestCase(key));
        if (request.method === "PUT") {
          return sendResult(response, 200, await service.updateTestCase(key, await readJson(request)), sendJson);
        }
        return sendJson(response, 405, { error: "Method not allowed.", allowedMethods: ["GET", "PUT"] });
      }

      if (pathname === "/api/zephyr/testcycles") {
        if (request.method === "GET") {
          return sendJson(response, 200, await service.listTestCycles({
            projectKey: readProjectKey(searchParams),
            maxResults: positiveIntegerParam(searchParams.get("maxResults"), "maxResults", 100, 1000),
            startAt: positiveIntegerParam(searchParams.get("startAt"), "startAt", 0, 1000000)
          }));
        }
        if (request.method === "POST") {
          return sendJson(response, 201, await service.createTestCycle(await readJson(request)));
        }
        return sendJson(response, 405, { error: "Method not allowed.", allowedMethods: ["GET", "POST"] });
      }

      if (cycle) {
        const idOrKey = decodeParam(cycle[1], "Test cycle ID or key");
        if (request.method === "GET") return sendJson(response, 200, await service.getTestCycle(idOrKey));
        if (request.method === "PUT") {
          return sendResult(response, 200, await service.updateTestCycle(idOrKey, await readJson(request)), sendJson);
        }
        return sendJson(response, 405, { error: "Method not allowed.", allowedMethods: ["GET", "PUT"] });
      }

      if (pathname === "/api/zephyr/testexecutions") {
        if (request.method === "GET") {
          const testCycle = searchParams.get("testCycle") || undefined;
          const testCase = searchParams.get("testCase") || undefined;
          return sendJson(response, 200, await service.listTestExecutions({
            projectKey: readProjectKey(searchParams),
            testCycle,
            testCase,
            maxResults: positiveIntegerParam(searchParams.get("maxResults"), "maxResults", 100, 1000),
            startAt: positiveIntegerParam(searchParams.get("startAt"), "startAt", 0, 1000000)
          }));
        }
        if (request.method === "POST") {
          return sendJson(response, 201, await service.createTestExecution(await readJson(request)));
        }
        return sendJson(response, 405, { error: "Method not allowed.", allowedMethods: ["GET", "POST"] });
      }

      if (executionAttachment) {
        if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed.", allowedMethods: ["POST"] });
        const key = decodeParam(executionAttachment[1], "Test execution ID or key");
        const fileName = decodeParam(executionAttachment[2], "Attachment file name");
        const { content } = await readBinary(request);
        return sendResult(response, 201, await service.uploadTestExecutionAttachment(
          key,
          fileName,
          content
        ), sendJson);
      }

      if (executionLink) {
        if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed.", allowedMethods: ["POST"] });
        const payload = await readJson(request);
        return sendResult(response, 201, await service.linkTestExecutionToIssue(
          decodeParam(executionLink[1], "Test execution ID or key"),
          payload?.issueId
        ), sendJson);
      }

      if (execution) {
        const idOrKey = decodeParam(execution[1], "Test execution ID or key");
        if (request.method === "GET") return sendJson(response, 200, await service.getTestExecution(idOrKey));
        if (request.method === "PUT") {
          return sendResult(response, 200, await service.updateTestExecution(idOrKey, await readJson(request)), sendJson);
        }
        return sendJson(response, 405, { error: "Method not allowed.", allowedMethods: ["GET", "PUT"] });
      }

      return sendJson(response, 404, { error: "Zephyr API route not found." });
    } catch (error) {
      if (!(error instanceof ZephyrServiceError)) {
        logger.error?.(JSON.stringify({
          event: "zephyr_route_error",
          method: request.method,
          path: pathname,
          errorType: error?.name || "Error"
        }));
      }
      const isServiceError = error instanceof ZephyrServiceError;
      const status = isServiceError ? error.statusCode : (Number.isInteger(error?.status) ? error.status : 500);
      const message = isServiceError
        ? error.message
        : status < 500 ? error.message : "The Zephyr integration could not complete the request.";
      const result = {
        error: message,
        code: isServiceError ? error.code : "zephyr_internal_error"
      };
      if (isServiceError && error.upstreamStatusCode !== undefined) result.upstreamStatus = error.upstreamStatusCode;
      if (isServiceError && error.retryAfter !== undefined) result.retryAfterMs = error.retryAfter;
      if (pathname === "/api/zephyr/health") {
        result.configured = isServiceError &&
          !["configuration_missing", "invalid_configuration"].includes(error.code);
        result.connected = false;
        if (isServiceError && error.upstreamStatusCode !== undefined) {
          result.upstreamStatus = error.upstreamStatusCode;
        }
      }
      return sendJson(response, status, result);
    }
  };
}

module.exports = {
  createZephyrApiHandler,
  readBinary
};
