// サイトのコンテンツデータ。
// 基本は lib/content-defaults.json（=これまでの site.json）を使い、
// microCMS にデータがあればその項目だけ上書きする。
// MICROCMS_API_KEY が未設定でも必ずデフォルトで動く（ビルドは壊れない）。

const path = require("path");
const defaults = require(path.join(__dirname, "..", "..", "lib", "content-defaults.json"));

const DOMAIN = "zennuwellness"; // microCMS サービスID

async function mc(endpoint, query = "") {
  const res = await fetch(
    `https://${DOMAIN}.microcms.io/api/v1/${endpoint}${query}`,
    { headers: { "X-MICROCMS-API-KEY": process.env.MICROCMS_API_KEY } }
  );
  if (!res.ok) throw new Error(`${endpoint} -> HTTP ${res.status}`);
  return res.json();
}

module.exports = async function () {
  // ディープコピー（デフォルトを壊さない）
  const data = JSON.parse(JSON.stringify(defaults));

  // APIキーが無い（ローカル開発・未設定）ならデフォルトのまま
  if (!process.env.MICROCMS_API_KEY) {
    console.log("[microCMS] APIキー未設定のためデフォルト(content-defaults.json)を使用");
    return data;
  }

  // ── サイト設定（オブジェクト形式 API: "settings"）──
  try {
    const s = await mc("settings");
    if (s.remaining != null && s.remaining !== "") data.campaign.remaining = s.remaining;
    if (s.bandText) data.campaign.bandText = s.bandText;
    if (s.heroJp) data.hero.jp = s.heroJp;
    if (s.heroDesc) data.hero.desc = s.heroDesc;
    if (s.lineUrl) data.contact.lineUrl = s.lineUrl;
    if (s.tel) {
      data.contact.telDisplay = s.tel;
      data.contact.tel = String(s.tel).replace(/[^0-9]/g, "");
    }
    console.log("[microCMS] settings 反映");
  } catch (e) {
    console.warn("[microCMS] settings スキップ:", e.message);
  }

  return data;
};
