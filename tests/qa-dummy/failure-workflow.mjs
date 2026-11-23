/**
 * Controlled intentional FAIL for QA automation workflow validation.
 * Does not modify application source. Uses approved admin/admin credentials.
 *
 * Jira Bug post-create checklist (agents): after creating a failure Bug, follow
 * `.cursor/rules/jira-qa-failure-bug.mdc` — upload this screenshot to the Bug
 * Attachments (uploadAttachmentToJiraIssue two-phase), set Parent (story or its
 * Epic), set Start date (execution YYYY-MM-DD), and assign the active Sprint.
 * Do not treat a description path as an attachment substitute.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.env.STRIDE_BASE_URL || "http://127.0.0.1:4173";
const TEST_CASE_KEY = process.env.STRIDE_DUMMY_TC || "SCRUM-T54";
const OUT_DIR =
  process.env.STRIDE_DUMMY_OUT ||
  path.join(os.tmpdir(), "stride-dummy-failure-evidence");
const EXPECTED_DUMMY = "DUMMY_FAILURE_EXPECTED_MESSAGE";

fs.mkdirSync(OUT_DIR, { recursive: true });

const screenshotPath = path.join(OUT_DIR, `${TEST_CASE_KEY}-failure.png`);
const resultPath = path.join(OUT_DIR, `${TEST_CASE_KEY}-result.json`);

const result = {
  testCaseKey: TEST_CASE_KEY,
  expected: EXPECTED_DUMMY,
  actual: null,
  status: "FAIL",
  failureReason:
    "Intentional assertion mismatch for QA workflow validation.",
  screenshotPath: null,
  durationMs: 0,
  baseUrl: BASE
};

const started = Date.now();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "admin");
  await page.click("button.login-submit");
  await page.waitForSelector("#app-shell:not([hidden])", { timeout: 15000 });

  const shellVisible = await page.locator("#app-shell").evaluate((el) => !el.hidden);
  const bodyText = await page.locator("body").innerText();
  const hasDummy = bodyText.includes(EXPECTED_DUMMY);

  result.actual = shellVisible
    ? "Application displayed its normal authenticated application shell after admin/admin login."
    : "App shell was not visible after login.";

  await page.screenshot({ path: screenshotPath, fullPage: true });
  result.screenshotPath = screenshotPath;

  if (hasDummy) {
    result.status = "UNEXPECTED_PASS";
    result.failureReason =
      "Dummy expected text was unexpectedly present; controlled FAIL workflow invalid.";
  } else {
    // Intentional controlled assertion failure
    throw new Error(
      `Expected page to contain "${EXPECTED_DUMMY}" but authenticated shell was shown without that text.`
    );
  }
} catch (err) {
  result.status = "FAIL";
  result.error = String(err?.message || err);
  if (!result.screenshotPath) {
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      result.screenshotPath = screenshotPath;
    } catch {
      /* ignore secondary screenshot errors */
    }
  }
  if (!result.actual) {
    result.actual =
      "Application displayed its actual authenticated application shell (or login state at failure).";
  }
} finally {
  result.durationMs = Date.now() - started;
  await browser.close();
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "FAIL") process.exit(2);
  process.exit(1); // intentional FAIL exit code
}
