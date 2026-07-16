// GSC・GA4のデータを取得してSEOレポートを生成するスクリプト。
// 週次スケジュールタスクから実行される。
//
// 前提:
//   - サービスアカウントの鍵JSONが ~/.zennu-lp-secrets/google-service-account.json にある
//   - そのサービスアカウントがGA4プロパティ・GSCプロパティに閲覧権限を持っている
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

const KEY_PATH = path.join(os.homedir(), ".zennu-lp-secrets", "google-service-account.json");
const CONFIG_PATH = path.join(__dirname, "seo-config.json");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`設定ファイルが見つかりません: ${CONFIG_PATH}\nga4PropertyId と siteUrl を書いて作成してください。`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

async function getAuth() {
  if (!fs.existsSync(KEY_PATH)) {
    throw new Error(`サービスアカウント鍵が見つかりません: ${KEY_PATH}`);
  }
  return new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: [
      "https://www.googleapis.com/auth/webmasters.readonly",
      "https://www.googleapis.com/auth/analytics.readonly",
    ],
  });
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

  const [landingPages, events] = await Promise.all([
    analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "landingPagePlusQueryString" }, { name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "engagementRate" }, { name: "conversions" }],
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
    lines.push(`| ${page} | ${channel} | ${sessions} | ${(Number(engagementRate) * 100).toFixed(1)}% | ${conversions} |`);
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
