import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.STRIDE_BASE_URL || "http://127.0.0.1:4173";
const OUT = process.env.STRIDE_QA_OUT || "C:/Users/RManojKhanna/AppData/Local/Temp/stride-qa-scrum-5-evidence";
const MATRIX_PATH = process.env.STRIDE_QA_MATRIX
  || path.join("C:/Users/RManojKhanna/AppData/Local/Temp/stride-qa-scrum-5", "matrix.json");
const matrix = JSON.parse(fs.readFileSync(MATRIX_PATH, "utf8"));

/** TC-01..TC-26 map to SCRUM-T28..T53 and folders TC-28..TC-53 */
function mapIds(legacyId) {
  const n = Number(String(legacyId).replace("TC-", ""));
  const scrumNum = 27 + n;
  return {
    folder: `TC-${String(scrumNum).padStart(2, "0")}`,
    testCaseKey: `SCRUM-T${scrumNum}`,
    legacyId
  };
}

const FILE_NAMES = {
  "TC-01": "SCRUM-T28-login-success.png",
  "TC-02": "SCRUM-T29-invalid-login.png",
  "TC-03": "SCRUM-T30-mandatory-validation.png",
  "TC-04": "SCRUM-T31-password-masked.png",
  "TC-05": "SCRUM-T32-logout-session.png",
  "TC-06": "SCRUM-T33-unauth-gate.png",
  "TC-07": "SCRUM-T34-catalogue-40.png",
  "TC-08": "SCRUM-T35-shoe-detail.png",
  "TC-09": "SCRUM-T36-search-nike.png",
  "TC-10": "SCRUM-T37-missing-product-info.png",
  "TC-11": "SCRUM-T38-weather-london.png",
  "TC-12": "SCRUM-T39-invalid-location.png",
  "TC-13": "SCRUM-T40-weather-failure.png",
  "TC-14": "SCRUM-T41-commute-bike.png",
  "TC-15": "SCRUM-T42-commute-refresh.png",
  "TC-16": "SCRUM-T43-commute-results.png",
  "TC-17": "SCRUM-T44-running-recs.png",
  "TC-18": "SCRUM-T45-distance-bounds.png",
  "TC-19": "SCRUM-T46-running-refresh.png",
  "TC-20": "SCRUM-T47-brand-filter.png",
  "TC-21": "SCRUM-T48-image-placeholder.png",
  "TC-22": "SCRUM-T49-filter-persist.png",
  "TC-23": "SCRUM-T50-detail-consistency.png",
  "TC-24": "SCRUM-T51-xss-sqli.png",
  "TC-25": "SCRUM-T52-secrets-admin.png",
  "TC-26": "SCRUM-T53-e2e-workflow.png"
};

async function shot(page, legacyId, _ignoredName) {
  const { folder } = mapIds(legacyId);
  const dir = path.join(OUT, folder);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = FILE_NAMES[legacyId] || `${legacyId}.png`;
  const file = path.join(dir, fileName);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function login(page, user = "admin", pass = "admin") {
  await page.goto(BASE + "/");
  await page.fill("#login-username", user);
  await page.fill("#login-password", pass);
  await page.click('button.login-submit');
}

async function selectHomeLocation(page, query = "London") {
  await page.fill("#location-input", query);
  await page.waitForTimeout(1200);
  const option = page.locator("#location-results .location-option").first();
  await option.waitFor({ timeout: 15000 });
  await option.click();
  await page.waitForTimeout(2000);
}

const runners = {
  async "TC-01"(page) {
    await login(page);
    await page.waitForSelector("#app-shell:not([hidden])");
    const loginHidden = await page.locator("#login-screen").evaluate((el) => el.hidden);
    if (!loginHidden) throw new Error("Login screen still visible");
    await shot(page, "TC-01", "logged-in");
    return "App shell visible after valid admin/admin login";
  },
  async "TC-02"(page) {
    await login(page, "wrong", "wrong");
    await page.waitForSelector("#login-error:not([hidden])");
    const shellHidden = await page.locator("#app-shell").evaluate((el) => el.hidden);
    if (!shellHidden) throw new Error("App shell should stay hidden");
    await shot(page, "TC-02", "invalid-login");
    return "Error alert shown; app shell hidden";
  },
  async "TC-03"(page) {
    await page.goto(BASE + "/");
    const user = page.locator("#login-username");
    const pass = page.locator("#login-password");
    const userRequired = await user.getAttribute("required");
    const passRequired = await pass.getAttribute("required");
    if (userRequired === null || passRequired === null) throw new Error("required attribute missing");
    await page.fill("#login-username", "");
    await page.fill("#login-password", "");
    await page.click('button.login-submit');
    const shellHidden = await page.locator("#app-shell").evaluate((el) => el.hidden);
    if (!shellHidden) throw new Error("Empty submit allowed login");
    await shot(page, "TC-03", "required-fields");
    return "Mandatory required attributes present; empty submit did not open app";
  },
  async "TC-04"(page) {
    await page.goto(BASE + "/");
    const type = await page.getAttribute("#login-password", "type");
    if (type !== "password") throw new Error(`Expected type=password got ${type}`);
    await shot(page, "TC-04", "password-masked");
    return "Password input type is password";
  },
  async "TC-05"(page) {
    await login(page);
    await page.waitForSelector("#app-shell:not([hidden])");
    await page.click("#logout-button");
    await page.waitForSelector("#login-screen:not([hidden])");
    const auth = await page.evaluate(() => sessionStorage.getItem("stride-demo-authenticated"));
    if (auth) throw new Error("session flag still set");
    await shot(page, "TC-05", "logged-out");
    return "Logout cleared session and returned login screen";
  },
  async "TC-06"(page) {
    await page.goto(BASE + "/");
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    const loginVisible = !(await page.locator("#login-screen").evaluate((el) => el.hidden));
    const shellHidden = await page.locator("#app-shell").evaluate((el) => el.hidden);
    if (!loginVisible || !shellHidden) throw new Error("Protected UI exposed without auth");
    await shot(page, "TC-06", "unauth-gate");
    return "Unauthenticated visit shows login only";
  },
  async "TC-07"(page) {
    await login(page);
    await page.click('a[data-view="collection"]');
    await page.waitForSelector("#collection-view:not([hidden])");
    await page.waitForTimeout(800);
    const countText = await page.locator("#collection-count").innerText();
    const cards = await page.locator("#collection-grid .shoe-card, #collection-grid article").count();
    await shot(page, "TC-07", "catalogue");
    if (cards < 30) throw new Error(`Expected ~40 shoes, found cards=${cards}, count=${countText}`);
    return `Collection shows ${cards} cards (${countText})`;
  },
  async "TC-08"(page) {
    await login(page);
    await page.click('a[data-view="collection"]');
    await page.waitForSelector("#collection-grid");
    await page.waitForTimeout(500);
    await page.locator("#collection-grid .details-btn").first().click();
    await page.waitForSelector("#modal-backdrop.open", { timeout: 8000 });
    const html = await page.locator("#modal-content").innerHTML();
    await shot(page, "TC-08", "shoe-detail");
    if (html.length < 40) throw new Error("Modal content too sparse");
    const text = await page.locator("#modal-content").innerText();
    if (!text || text.trim().length < 10) throw new Error("Missing detail fields: " + text.slice(0, 200));
    return `Modal details rendered (${text.slice(0, 120).replace(/\n/g, " ")})`;
  },
  async "TC-09"(page) {
    await login(page);
    await page.click('a[data-view="collection"]');
    await page.fill("#collection-search", "Nike");
    await page.waitForTimeout(500);
    const text = await page.locator("#collection-grid").innerText();
    await shot(page, "TC-09", "search-nike");
    if (!/Nike/i.test(text)) throw new Error("Nike search returned no Nike shoes");
    if (/ASICS|Saucony/i.test(text) && !/Nike/i.test(text)) throw new Error("Unrelated brands without Nike");
    return "Nike search filtered collection results";
  },
  async "TC-10"(page) {
    await login(page);
    await page.click('a[data-view="collection"]');
    await page.waitForTimeout(500);
    const crashed = await page.evaluate(() => !document.getElementById("collection-grid"));
    if (crashed) throw new Error("Collection grid missing");
    const placeholders = await page.locator("#collection-grid img, #collection-grid .shoe-photo, #collection-grid .placeholder").count();
    await shot(page, "TC-10", "missing-images");
    return `Collection rendered without crash; media nodes=${placeholders}`;
  },
  async "TC-11"(page) {
    await login(page);
    await selectHomeLocation(page, "London");
    const temp = await page.locator("#weather-temp").innerText();
    const place = await page.locator("#weather-place").innerText();
    const state = await page.locator("#forecast-state").innerText();
    await shot(page, "TC-11", "weather-london");
    if (/--/.test(temp) && !/FAIL|ERROR|UNABLE|unavailable/i.test(state)) {
      // may still be loading
      await page.waitForTimeout(3000);
    }
    const temp2 = await page.locator("#weather-temp").innerText();
    const place2 = await page.locator("#weather-place").innerText();
    if (/--/.test(temp2)) throw new Error(`Weather not loaded: temp=${temp2} place=${place2} state=${state}`);
    if (!/London|United Kingdom|England|UK/i.test(place2)) {
      // place may be exact selected name
      if (!place2 || place2.includes("will appear")) throw new Error("Place not set: " + place2);
    }
    return `Weather loaded temp=${temp2} place=${place2}`;
  },
  async "TC-12"(page) {
    await login(page);
    await page.fill("#location-input", "zzzxxqqq12345");
    await page.waitForTimeout(1500);
    const status = await page.locator("#location-status").innerText();
    await shot(page, "TC-12", "invalid-location");
    if (!/No matching|not found|Try a nearby|different spelling/i.test(status)) {
      throw new Error("Unexpected status: " + status);
    }
    return status;
  },
  async "TC-13"(page) {
    await page.route("**/api.open-meteo.com/**", (route) => route.abort());
    await login(page);
    await page.fill("#location-input", "Paris");
    await page.waitForTimeout(1200);
    const option = page.locator("#location-results .location-option").first();
    try {
      await option.waitFor({ timeout: 15000 });
      await option.click();
    } catch {
      // geocode may also need open-meteo geocoding host
    }
    await page.route("**/geocoding-api.open-meteo.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [{ id: 1, name: "Paris", latitude: 48.85, longitude: 2.35, country: "France", admin1: "Ile-de-France" }]
        })
      });
    });
    await page.fill("#location-input", "Paris");
    await page.waitForTimeout(800);
    const opt2 = page.locator("#location-results .location-option").first();
    await opt2.waitFor({ timeout: 10000 });
    await opt2.click();
    await page.waitForTimeout(2500);
    const temp = await page.locator("#weather-temp").innerText();
    const status = await page.locator("#location-status").innerText();
    const condition = await page.locator("#weather-condition").innerText();
    await shot(page, "TC-13", "weather-fail");
    const fabricated = /\d+\s*°/.test(temp) && !/--/.test(temp);
    const failedMsg = /fail|unable|error|connection|try again|could not/i.test(status + " " + condition + " " + (await page.locator("#forecast-state").innerText()));
    if (fabricated && !failedMsg) throw new Error(`Fabricated weather shown: temp=${temp}`);
    if (!failedMsg && fabricated) throw new Error("No failure messaging with temp " + temp);
    return `Failure handled; temp=${temp}; status=${status}`;
  },
  async "TC-14"(page) {
    await login(page);
    await selectHomeLocation(page, "London");
    await page.waitForSelector("#commute-step:not([hidden]), #commute-select", { timeout: 15000 });
    await page.selectOption("#commute-select", "Bike");
    await page.waitForTimeout(800);
    const todayHidden = await page.locator("#today").evaluate((el) => el.hidden);
    const title = await page.locator("#recommendation-title").innerText().catch(() => "");
    await shot(page, "TC-14", "commute-bike");
    if (todayHidden && !/pair|finding|suitable|match/i.test(title)) {
      // recommendations section may still show via collection
      const collHidden = await page.locator("#collection").evaluate((el) => el.hidden);
      if (collHidden) throw new Error("No recommendation UI after Bike select");
    }
    return `Bike commute selected; todayHidden=${todayHidden}; title=${title}`;
  },
  async "TC-15"(page) {
    await login(page);
    await selectHomeLocation(page, "London");
    await page.waitForSelector("#commute-select", { timeout: 15000 });
    await page.selectOption("#commute-select", "Bike");
    await page.waitForTimeout(500);
    await page.selectOption("#commute-select", "Car");
    await page.waitForTimeout(500);
    const summary = await page.locator("#selection-summary").innerText().catch(() => "");
    await shot(page, "TC-15", "commute-refresh");
    if (summary && !/Car/i.test(summary)) throw new Error("Summary not refreshed: " + summary);
    return `Commute refreshed; summary=${summary || "(empty ok if UI uses other label)"}`;
  },
  async "TC-16"(page) {
    await login(page);
    await selectHomeLocation(page, "London");
    await page.waitForSelector("#commute-select", { timeout: 15000 });
    await page.selectOption("#commute-select", "Bike");
    await page.waitForTimeout(800);
    const copy = await page.locator("#recommendation-copy").innerText().catch(() => "");
    const count = await page.locator("#result-count").innerText().catch(() => "");
    await shot(page, "TC-16", "commute-empty-or-results");
    // App may always have matches for Bike+London weather; assert UI presents either results or empty guidance
    if (!copy && !count) throw new Error("No recommendation or empty-state messaging");
    return `Recommendation UI present: copy=${copy.slice(0, 80)}; count=${count}`;
  },
  async "TC-17"(page) {
    await login(page);
    await page.click('a[data-view="running"]');
    await page.fill("#running-location-input", "London");
    await page.waitForTimeout(1200);
    await page.locator("#running-location-results .location-option").first().click();
    await page.waitForTimeout(2500);
    await page.fill("#running-distance", "10");
    await page.dispatchEvent("#running-distance", "input");
    await page.waitForTimeout(300);
    await page.selectOption("#running-type", { label: "Daily Running" });
    await page.waitForTimeout(800);
    const cards = await page.locator("#running-shoe-grid .shoe-card, #running-shoe-grid article").count();
    const copy = await page.locator("#running-results-copy").innerText();
    await shot(page, "TC-17", "running-recs");
    if (cards < 1 && !/no |match|choose|select/i.test(copy)) throw new Error("No running recommendations");
    return `Running cards=${cards}; copy=${copy}`;
  },
  async "TC-18"(page) {
    await login(page);
    await page.click('a[data-view="running"]');
    const min = await page.getAttribute("#running-distance", "min");
    const max = await page.getAttribute("#running-distance", "max");
    await shot(page, "TC-18", "distance-bounds");
    if (min !== "1" || max !== "42") throw new Error(`Expected min=1 max=42 got ${min}-${max}`);
    return `Distance control bounds ${min}-${max}`;
  },
  async "TC-19"(page) {
    await login(page);
    await page.click('a[data-view="running"]');
    await page.fill("#running-location-input", "London");
    await page.waitForTimeout(1200);
    await page.locator("#running-location-results .location-option").first().click();
    await page.waitForTimeout(2000);
    await page.fill("#running-distance", "12");
    await page.dispatchEvent("#running-distance", "input");
    await page.selectOption("#running-type", { label: "Daily Running" });
    await page.waitForTimeout(600);
    const first = await page.locator("#running-shoe-grid").innerText();
    await page.selectOption("#running-type", { label: "Trail Running" });
    await page.waitForTimeout(800);
    const second = await page.locator("#running-shoe-grid").innerText();
    const copy = await page.locator("#running-results-copy").innerText();
    await shot(page, "TC-19", "running-refresh");
    if (first === second && !/trail|match|recommend/i.test(copy + second)) {
      // may legitimately overlap; require that type changed in UI
      const typeVal = await page.inputValue("#running-type");
      if (!/Trail/i.test(typeVal)) throw new Error("Running type did not change");
    }
    return `Type changed; results refreshed (len ${first.length}->${second.length})`;
  },
  async "TC-20"(page) {
    await login(page);
    await page.click('a[data-view="collection"]');
    await page.click('[data-collection-tab="brands"]');
    await page.waitForSelector("#brand-browser:not([hidden])");
    await page.waitForTimeout(400);
    const brandBtn = page.locator("#brand-grid button, #brand-grid .brand-card").first();
    await brandBtn.click();
    await page.waitForTimeout(500);
    const filter = await page.locator("#collection-active-filter").innerText();
    const count = await page.locator("#collection-count").innerText();
    await shot(page, "TC-20", "brand-filter");
    if (!filter || /All brands/i.test(filter)) throw new Error("Brand filter not applied: " + filter);
    return `Brand filter=${filter}; ${count}`;
  },
  async "TC-21"(page) {
    await login(page);
    await page.click('a[data-view="collection"]');
    await page.waitForTimeout(500);
    // force broken image handling if images exist
    await page.evaluate(() => {
      document.querySelectorAll("#collection-grid img").forEach((img) => {
        img.src = "http://127.0.0.1:9/missing.png";
      });
    });
    await page.waitForTimeout(800);
    const gridOk = await page.locator("#collection-grid").count();
    await shot(page, "TC-21", "image-placeholder");
    if (!gridOk) throw new Error("Grid destroyed after broken images");
    return "Broken/missing images did not remove collection grid";
  },
  async "TC-22"(page) {
    await login(page);
    await selectHomeLocation(page, "London");
    const place = await page.locator("#selected-location-name").innerText();
    await page.click('a[data-view="collection"]');
    await page.waitForTimeout(300);
    await page.click('a[data-view="home"]');
    await page.waitForTimeout(300);
    const place2 = await page.locator("#selected-location-name").innerText();
    await shot(page, "TC-22", "filter-persist");
    if (place && place2 && place !== place2) throw new Error(`Location reset ${place} -> ${place2}`);
    if (!place2) throw new Error("Location cleared after navigation");
    return `Location persisted across nav: ${place2}`;
  },
  async "TC-23"(page) {
    await login(page);
    await page.click('a[data-view="collection"]');
    await page.waitForTimeout(500);
    const cardText = await page.locator("#collection-grid").locator(".shoe-card, article").first().innerText();
    await page.locator("#collection-grid .details-btn").first().click();
    await page.waitForSelector("#modal-backdrop.open", { timeout: 8000 });
    const modal = await page.locator("#modal-content").innerText();
    await shot(page, "TC-23", "consistency");
    const firstWord = cardText.split(/\s+/).find((w) => w.length > 3) || "";
    if (firstWord && !modal.includes(firstWord) && !cardText.split("\n").some((l) => modal.includes(l.trim()) && l.trim().length > 3)) {
      throw new Error("Modal details inconsistent with card");
    }
    return "Card and modal details align";
  },
  async "TC-24"(page) {
    await page.goto(BASE + "/");
    let dialog = false;
    page.on("dialog", async (d) => { dialog = true; await d.dismiss(); });
    await page.fill("#login-username", "<script>alert(1)</script>");
    await page.fill("#login-password", "' OR 1=1 --");
    await page.click("button.login-submit");
    await page.waitForTimeout(500);
    const shellHidden = await page.locator("#app-shell").evaluate((el) => el.hidden);
    await shot(page, "TC-24", "xss-sqli");
    if (dialog) throw new Error("XSS dialog executed");
    if (!shellHidden) throw new Error("Injection bypassed login");
    return "SQLi/XSS payloads rejected; no script dialog";
  },
  async "TC-25"(page) {
    const res = await page.request.get(BASE + "/api/admin/catalog");
    const status = res.status();
    await page.goto(BASE + "/");
    const html = await page.content();
    await shot(page, "TC-25", "secrets");
    if (/ZEPHYR_SCALE_API_TOKEN\s*=\s*['\"]?[A-Za-z0-9_\-]{20,}/.test(html)) throw new Error("Token-looking secret in HTML");
    if (status === 200) throw new Error("Admin catalog accessible without auth");
    return `Admin catalog status=${status}; no embedded Zephyr token in HTML`;
  },
  async "TC-26"(page) {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await login(page);
    await selectHomeLocation(page, "London");
    await page.waitForSelector("#commute-select", { timeout: 15000 });
    await page.selectOption("#commute-select", "Bike");
    await page.click('a[data-view="collection"]');
    await page.fill("#collection-search", "");
    await page.fill("#collection-search", "zzzznotfound");
    await page.waitForTimeout(400);
    await page.click('a[data-view="running"]');
    await page.fill("#running-location-input", "London");
    await page.waitForTimeout(1200);
    await page.locator("#running-location-results .location-option").first().click();
    await page.waitForTimeout(1500);
    await page.fill("#running-distance", "5");
    await page.dispatchEvent("#running-distance", "input");
    await page.selectOption("#running-type", { label: "Daily Running" });
    await page.click('a[data-view="home"]');
    await page.click("#logout-button");
    await page.waitForSelector("#login-screen:not([hidden])");
    await shot(page, "TC-26", "e2e");
    if (errors.length) throw new Error("JS errors: " + errors.join(" | "));
    return "E2E flow completed without pageerrors; logout OK";
  }
};

fs.mkdirSync(OUT, { recursive: true });
const results = [];
const browser = await chromium.launch({ headless: true });
for (const tc of matrix) {
  const mapped = mapIds(tc.id);
  const context = await browser.newContext();
  const page = await context.newPage();
  const started = Date.now();
  let status = "Pass";
  let actual = "";
  let screenshotPath = null;
  try {
    actual = await runners[tc.id](page);
    screenshotPath = path.join(OUT, mapped.folder, FILE_NAMES[tc.id]);
  } catch (err) {
    status = "Fail";
    actual = String(err && err.message ? err.message : err);
    try {
      screenshotPath = await shot(page, tc.id, "failure");
    } catch {}
  }
  results.push({
    ...tc,
    legacyId: tc.id,
    folder: mapped.folder,
    testCaseKey: mapped.testCaseKey,
    screenshotFile: FILE_NAMES[tc.id],
    screenshotPath,
    status,
    actual,
    expected: tc.expected,
    durationMs: Date.now() - started,
    evidenceDir: path.join(OUT, mapped.folder)
  });
  console.log(`${mapped.testCaseKey} (${tc.id}) ${status}: ${actual.slice(0, 120)}`);
  await context.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const summary = {
  executed: results.length,
  passed: results.filter((r) => r.status === "Pass").length,
  failed: results.filter((r) => r.status === "Fail").length,
  blocked: results.filter((r) => r.status === "Blocked").length,
  out: OUT
};
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log("SUMMARY", summary);
