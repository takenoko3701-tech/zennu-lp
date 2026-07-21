// GSC・GA4のデータを取得してSEOレポートを生成するスクリプト。
// 週次スケジュールタスクから実行される。
//
// 前提:
//   - OAuthクライアント情報が ~/.zennu-lp-secrets/google-oauth-client.json にある
//   - 認証済みrefresh_tokenが ~/.zennu-lp-secrets/google-oauth-token.json にある
//     (初回のみ `node scripts/oauth-authorize.mjs` で取得)
//   - GA4のプロパティID(数値)を scripts/seo-config.json に設定済み
//
// 実行: node scripts/seo-report.mjs

import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const SECRETS_DIR = path.join(os.homedir(), ".zennu-lp-secrets");
const CLIENT_PATH = path.join(SECRETS_DIR, "google-oauth-client.json");
const TOKEN_PATH = path.join(SECRETS_DIR, "google-oauth-token.json");
const CONFIG_PATH = path.join(__dirname, "seo-config.json");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`設定ファイルが見つかりません: ${CONFIG_PATH}\nga4PropertyId と siteUrl を書いて作成してください。`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

async function getAuth() {
  if (!fs.existsSync(CLIENT_PATH)) {
    throw new Error(`OAuthクライアント情報が見つかりません: ${CLIENT_PATH}`);
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`認証トークンが見つかりません: ${TOKEN_PATH}\n先に node scripts/oauth-authorize.mjs を実行してください。`);
  }
  const { client_id, client_secret } = JSON.parse(fs.readFileSync(CLIENT_PATH, "utf-8"));
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

async function fetchSearchConsole(auth, siteUrl) {
  const searchconsole = google.searchconsole({ version: "v1", auth });
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 28);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const [byQuery, byPage] = await Promise.all([
    searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: fmt(startDate),
        endDate: fmt(endDate),
        dimensions: ["query"],
        rowLimit: 50,
      },
    }),
    searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: fmt(startDate),
        endDate: fmt(endDate),
        dimensions: ["page"],
        rowLimit: 50,
      },
    }),
  ]);

  return {
    period: { start: fmt(startDate), end: fmt(endDate) },
    queries: byQuery.data.rows || [],
    pages: byPage.data.rows || [],
  };
}

async function fetchGA4(auth, propertyId) {
  const analyticsdata = google.analyticsdata({ version: "v1beta", auth });

  // 同じGTMコンテナがhacomonoの予約ウィジェット側ドメインにも埋め込まれているため、
  // このプロパティにはLP以外(hacomono内部ページ)のヒットも混ざる。
  // SEO用のランディングページ分析はLPドメインだけに絞り込む。
  // (イベント集計は絞り込まない: reserve_completeなどのCVはhacomono側ドメインで
  //  発生するため、絞り込むとコンバージョン数が正しく見えなくなる)
  const LP_HOSTNAME = "lp.zennuwellnessdesign.jp";

  const [landingPages, events] = await Promise.all([
    analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "landingPage" }, { name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "engagementRate" }, { name: "conversions" }],
        dimensionFilter: {
          filter: {
            fieldName: "hostName",
            stringFilter: { matchType: "EXACT", value: LP_HOSTNAME },
          },
        },
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 50,
      },
    }),
    analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: 20,
      },
    }),
  ]);

  return {
    landingPages: landingPages.data.rows || [],
    events: events.data.rows || [],
  };
}

function buildMarkdown({ gsc, ga4, siteUrl }) {
  const lines = [];
  lines.push(`# SEOレポート (${gsc.period.start} 〜 ${gsc.period.end})`);
  lines.push("");
  lines.push("## Search Console: クエリ別（クリック数順）");
  lines.push("");
  lines.push("| クエリ | クリック数 | 表示回数 | CTR | 平均掲載順位 |");
  lines.push("|---|---|---|---|---|");
  for (const row of gsc.queries) {
    const [query] = row.keys;
    lines.push(`| ${query} | ${row.clicks} | ${row.impressions} | ${(row.ctr * 100).toFixed(1)}% | ${row.position.toFixed(1)} |`);
  }
  lines.push("");
  lines.push("## Search Console: ページ別（クリック数順）");
  lines.push("");
  lines.push("| ページ | クリック数 | 表示回数 | CTR | 平均掲載順位 |");
  lines.push("|---|---|---|---|---|");
  for (const row of gsc.pages) {
    const [pagePath] = row.keys;
    lines.push(`| ${pagePath.replace(siteUrl, "/")} | ${row.clicks} | ${row.impressions} | ${(row.ctr * 100).toFixed(1)}% | ${row.position.toFixed(1)} |`);
  }
  lines.push("");
  lines.push("## GA4: ランディングページ別セッション（過去28日）");
  lines.push("");
  lines.push("| ページ | 流入経路 | セッション数 | エンゲージメント率 | コンバージョン数 |");
  lines.push("|---|---|---|---|---|");
  for (const row of ga4.landingPages) {
    const [page, channel] = row.dimensionValues.map((v) => v.value);
    const [sessions, engagementRate, conversions] = row.metricValues.map((v) => v.value);
    lines.push(`| ${page || "(不明)"} | ${channel} | ${sessions} | ${(Number(engagementRate) * 100).toFixed(1)}% | ${conversions} |`);
  }
  lines.push("");
  lines.push("## GA4: イベント数（過去28日）");
  lines.push("");
  lines.push("| イベント名 | 回数 |");
  lines.push("|---|---|");
  for (const row of ga4.events) {
    const [eventName] = row.dimensionValues.map((v) => v.value);
    const [count] = row.metricValues.map((v) => v.value);
    lines.push(`| ${eventName} | ${count} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const config = loadConfig();
  const auth = await getAuth();

  const [gsc, ga4] = await Promise.all([
    fetchSearchConsole(auth, config.siteUrl),
    fetchGA4(auth, config.ga4PropertyId),
  ]);

  const markdown = buildMarkdown({ gsc, ga4, siteUrl: config.siteUrl });

  const today = new Date().toISOString().slice(0, 10);
  const outDir = path.join(REPO_ROOT, "docs", "seo-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${today}.md`);
  fs.writeFileSync(outPath, markdown, "utf-8");

  console.log(`レポートを書き出しました: ${outPath}`);
  console.log("");
  console.log(markdown);
}

main().catch((err) => {
  console.error("SEOレポート取得でエラーが発生しました:", err.message);
  process.exit(1);
});
