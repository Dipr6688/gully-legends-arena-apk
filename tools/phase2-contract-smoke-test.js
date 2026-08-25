const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "app/src/main/assets/index.html"), "utf8");
const manifest = fs.readFileSync(path.join(root, "app/src/main/AndroidManifest.xml"), "utf8");
const buildGradle = fs.readFileSync(path.join(root, "app/build.gradle"), "utf8");
const gradleProperties = fs.readFileSync(path.join(root, "gradle.properties"), "utf8");
const mainActivity = fs.readFileSync(
  path.join(root, "app/src/main/java/com/gullylegends/arena/MainActivity.java"),
  "utf8",
);
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function functionBody(name) {
  const start = indexHtml.indexOf(`function ${name}`);
  assert(start >= 0, `${name} is missing`);
  const next = indexHtml.indexOf("\nfunction ", start + 1);
  return indexHtml.slice(start, next >= 0 ? next : indexHtml.length);
}

const convertMatch = functionBody("convertMatch");
assert(convertMatch.includes("offlineMatchId"), "app-sync payload must include offlineMatchId");
assert(convertMatch.includes("syncVersion"), "app-sync payload must include syncVersion");
assert(convertMatch.includes("isDemo"), "app-sync payload must include isDemo");
assert(convertMatch.includes("matchDate"), "app-sync payload must include explicit matchDate");
assert(convertMatch.includes("pomRecommendationPlayerId"), "app-sync payload must include recommendation-only POM field");
assert(convertMatch.includes("computeXP(m)"), "POM recommendation must reuse the APK match XP preview");
assert(convertMatch.includes("xp.recommended||null"), "POM recommendation should send null when there is no unique recommendation");
assert(convertMatch.includes("startedAt"), "app-sync payload must include startedAt");
assert(convertMatch.includes("completedAt"), "app-sync payload must include completedAt");
["matchNumber", "selectedPlayerOfMatchId", "playerOfMatchId", "officialPOM", "expectedUpdatedAt"].forEach((field) => {
  assert(!convertMatch.includes(field), `app-sync payload must not send ${field}`);
});

assert(!indexHtml.includes("LBW"), "LBW must be removed from live/editor UI");
assert(!indexHtml.includes("id=\"rWide\""), "Wide toggle must be removed");
assert(!indexHtml.includes("id=\"rNb\""), "No-ball toggle must be removed");
assert(indexHtml.includes("extraType='wide'") || indexHtml.includes("extraType=\"wide\""), "wide event conversion is missing");
assert(indexHtml.includes("extraType='no_ball'") || indexHtml.includes("extraType=\"no_ball\""), "no-ball event conversion is missing");
assert(indexHtml.includes("kind==='stumped'"), "stumped UI/replay handling is missing");
assert(indexHtml.includes("type:kindMap[wkKind]"), "wicket kind mapping is missing");
assert(indexHtml.includes("syncState='pending_sync'"), "pending_sync state is missing");
assert(indexHtml.includes("pending_review"), "pending_review state is missing");
assert(indexHtml.includes("correction_pending"), "correction_pending state is missing");
assert(indexHtml.includes("ALLOW_SERVER_EDIT=false"), "release server must be locked");
assert(indexHtml.includes("lastUploadedSyncVersion"), "uploaded-version tracking is missing");
assert(indexHtml.includes("arena_legacy_migration=1"), "legacy localStorage handoff is missing");
assert(indexHtml.includes("gla_skip_auto_sync_once"), "migrated data must skip first auto-sync");
assert(indexHtml.includes("function apiUrl(path)"), "same-origin API URL helper is missing");
assert(indexHtml.includes("return path;"), "same-origin API requests should use relative /api paths");
assert(indexHtml.includes("describeApiError"), "network diagnostics helper is missing");

assert(manifest.includes('android:allowBackup="false"'), "Android backup must be disabled");
assert(!buildGradle.includes('storePassword "'), "Gradle must not hardcode storePassword");
assert(!buildGradle.includes('keyPassword "'), "Gradle must not hardcode keyPassword");
assert(buildGradle.includes("signing.properties"), "Gradle must read local signing.properties");
assert(buildGradle.includes("androidx.webkit:webkit:1.16.0"), "AndroidX WebKit dependency is missing");
assert(buildGradle.includes("versionCode 4"), "versionCode must be incremented to 4");
assert(buildGradle.includes('versionName "1.1.2"'), "versionName must be 1.1.2");
assert(gradleProperties.includes("android.useAndroidX=true"), "AndroidX must be enabled");
assert(gitignore.includes("signing.properties"), "signing.properties must be ignored");
assert(gitignore.includes("*.keystore"), "keystore files must be ignored");

assert(mainActivity.includes("WebViewAssetLoader"), "MainActivity must use WebViewAssetLoader");
assert(mainActivity.includes('APP_DOMAIN = "www.gullylegends.eu"'), "asset domain must be www.gullylegends.eu");
assert(mainActivity.includes('ASSET_PREFIX = "/__arena_assets__/"'), "asset path prefix must be /__arena_assets__/");
assert(
  mainActivity.includes('ASSET_APP_URL = "https://" + APP_DOMAIN + ASSET_PREFIX + "index.html"'),
  "normal app URL must be HTTPS asset-loader URL",
);
assert(mainActivity.includes("assetLoader.shouldInterceptRequest(url)"), "asset URLs must be served by asset loader");
assert(mainActivity.includes('startsWith("/api/app-sync/")'), "/api/app-sync/* must be recognized as network-backed");
assert(mainActivity.includes("return null;"), "non-asset requests must not be intercepted");
assert(!mainActivity.includes('webView.loadUrl("file:///android_asset/index.html")'), "normal app load must not use file://");
assert(mainActivity.includes("s.setAllowFileAccess(false)"), "file access must be disabled for normal operation");
assert(mainActivity.includes("s.setAllowFileAccessFromFileURLs(false)"), "file URL access must stay disabled");
assert(mainActivity.includes("s.setAllowUniversalAccessFromFileURLs(false)"), "universal file URL access must stay disabled");
assert(!mainActivity.includes("setAllowUniversalAccessFromFileURLs(true)"), "universal file access must not be enabled");
assert(mainActivity.includes("LegacyStorageBridge"), "legacy localStorage bridge is missing");
assert(mainActivity.includes("gla_skip_auto_sync_once"), "native migration must prevent immediate auto-sync");
assert(!indexHtml.includes("if(!ids.length)ids=bowl.ids;"), "previous-over bowler must not be reintroduced as a fallback");
assert(indexHtml.includes("id!==st.lastOverBowler"), "live next-over picker must exclude the previous over bowler");
assert(indexHtml.includes("id!==prevBowler&&id!==nextBowler"), "editor over-bowler picker must prevent adjacent repeated bowlers");

console.log("Phase 2 APK contract smoke test passed.");
