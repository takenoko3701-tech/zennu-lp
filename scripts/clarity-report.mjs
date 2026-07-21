// Microsoft Clarity Data Export APIからデータを取得してレポートを生成するスクリプト。
// 週次スケジュールタスクから実行される。
//
// 前提:
//   - Data Export APIトークンが ~/.zennu-lp-secrets/clarity-token.txt にある
//   - Clarityのプロジェクトを scripts/seo-config.json の clarityProjectId に設定済み
//
// API仕様上の制約:
//   - 直近3日分までしか取得できない(numOfDays=1〜3)
//   - 1プロジェクト1日10リクエストまで
//   - ヒートマップ画像・セッションリプレイ動画そのものはAPIで取得不可
//     (ダッシュボード https://clarity.microsoft.com で直接確認する必要がある)
//
// 実行: node scripts/clarity-report.mjs

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const SECRETS_DIR = path.join(os.homedir(), ".zennu-lp-secrets");
const TOKEN_PATH = path.join(SECRETS_DIR, "clarity-token.txt");
const CONFIG_PATH = path.join(__dirname, "seo-config.json");

// 本番ドメイン以外(localhost・Vercelプレビュー・hacomonoウィジェット等)のノイズを除外する
const PROD_HOST = "lp.zennuwellnessdesign.jp";

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`Clarity APIトークンが見つかりません: ${TOKEN_PATH}`);
  }
  return fs.readFileSync(TOKEN_PATH, "utf-8").trim();
}

function isProdUrl(url) {
  if (!url) return false;
  try {
    return new URL(url).hostname === PROD_HOST;
  } catch {
    return false;
  }
}

function metric(data, name) {
  return data.find((m) => m.metricName === name)?.information ?? [];
}

export async function fetchClarityInsights(numOfDays = 3) {
  const token = loadToken();
  const res = await fetch(
    `https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=${numOfDays}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`Clarity API取得失敗: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function buildReportMarkdown(data, numOfDays) {
  const today = new Date().toISOString().slice(0, 10);
  const traffic = metric(data, "Traffic")[0] ?? {};
  const engagement = metric(data, "EngagementTime")[0] ?? {};
  const scroll = metric(data, "ScrollDepth")[0] ?? {};
  const rageClick = metric(data, "RageClickCount")[0] ?? {};
  const deadClick = metric(data, "DeadClickCount")[0] ?? {};
  const quickback = metric(data, "QuickbackClick")[0] ?? {};

  const popularPages = metric(data, "PopularPages").filter((p) => isProdUrl(p.url));
  const referrers = metric(data, "ReferrerUrl").filter((r) => r.name);

  const lines = [];
  lines.push(`# Clarity週次レポート (${today})`);
  lines.push("");
  lines.push(`※ API仕様上、対象期間は直近${numOfDays}日間です(それ以前のデータは取得不可)。`);
  lines.push(`※ 数値は本番ドメイン(${PROD_HOST})以外のアクセス(開発・プレビュー環境等)も含む場合があります。`);
  lines.push("");
  lines.push("## サマリー");
  lines.push("");
  lines.push(`- セッション数: ${traffic.totalSessionCount ?? "-"}（うちBot: ${traffic.totalBotSessionCount ?? "-"}）`);
  lines.push(`- ユニークユーザー数: ${traffic.distinctUserCount ?? "-"}`);
  lines.push(`- 平均スクロール深度: ${scroll.averageScrollDepth ?? "-"}%`);
  lines.push(`- 平均滞在時間: ${engagement.totalTime ?? "-"}秒（アクティブ時間: ${engagement.activeTime ?? "-"}秒）`);
  lines.push("");
  lines.push("## UX上の気になる挙動");
  lines.push("");
  lines.push(`- Rage Click（同じ箇所を連打）が発生したセッション: ${rageClick.sessionsWithMetricPercentage ?? 0}%`);
  lines.push(`- Dead Click（反応しない箇所をクリック）が発生したセッション: ${deadClick.sessionsWithMetricPercentage ?? 0}%`);
  lines.push(`- Quickback（すぐ離脱して戻る）が発生したセッション: ${quickback.sessionsWithMetricPercentage ?? 0}%`);
  lines.push("");
  lines.push("## よく見られているページ（本番のみ）");
  lines.push("");
  if (popularPages.length) {
    for (const p of popularPages) lines.push(`- ${p.url}: ${p.visitsCount}件`);
  } else {
    lines.push("- 該当データなし");
  }
  lines.push("");
  lines.push("## 流入経路");
  lines.push("");
  for (const r of referrers) lines.push(`- ${r.name}: ${r.sessionsCount}件`);
  lines.push("");
  lines.push("## 所見・次のアクション");
  lines.push("");
  lines.push("- ヒートマップ・セッションリプレイ動画そのものはAPI取得対象外のため、詳細確認は下記ダッシュボードで行ってください。");
  lines.push("- https://clarity.microsoft.com/projects/view/" + loadConfig().clarityProjectId);
  lines.push("");

  return { today, markdown: lines.join("\n") };
}

async function main() {
  const config = loadConfig();
  const numOfDays = 3;
  const data = await fetchClarityInsights(numOfDays);
  const { today, markdown } = buildReportMarkdown(data, numOfDays);

  const outDir = path.join(REPO_ROOT, "docs", "seo-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, `clarity-${today}.md`);
  fs.writeFileSync(mdPath, markdown, "utf-8");
  console.log(`レポート生成: ${mdPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("失敗:", e.message);
    process.exit(1);
  });
}
