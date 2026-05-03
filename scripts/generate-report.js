const { chromium } = require('playwright');
const { google }   = require('googleapis');
const fs   = require('fs');
const path = require('path');

// ── スプレッドシートの列番号（0始まり） ────────────────────
const COL_DATE    = 1;   // 日付
const COL_WEEKDAY = 2;   // 曜日
const COL_BED     = 3;   // 就寝時間
const COL_WAKE    = 4;   // 起床時間
const COL_OVER    = 8;   // オーバー%
const COL_RELAX   = 9;   // リラックス法（〇 or 免除 or 空欄）

// ── Google スプレッドシートを読み込む ──────────────────────
async function readSheet() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Sheet1!A:J',
  });
  return res.data.values || [];
}

// ── 時刻文字列 → 分に変換（例: "23:15" → 1395） ──────────
// 深夜0〜5時は翌日扱いにして就寝時刻のズレを正しく計算する
function timeToMin(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let total = parseInt(m[1]) * 60 + parseInt(m[2]);
  if (total < 300) total += 1440; // 0〜4:59 は「翌日」として扱う
  return total;
}

// ── 標準偏差を計算する ────────────────────────────────────
function stddev(vals) {
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
}

// ── 睡眠リズムを評価する ──────────────────────────────────
// 就寝・起床の標準偏差が小さいほど規則的
function evaluateSleep(rows) {
  const beds  = rows.map(r => timeToMin(r[COL_BED])).filter(v => v !== null);
  const wakes = rows.map(r => timeToMin(r[COL_WAKE])).filter(v => v !== null);
  if (beds.length < 3) return 'ryoko'; // データ不足は評価不可のため良好扱い
  const maxSd = Math.max(stddev(beds), stddev(wakes));
  if (maxSd <= 30) return 'ryoko';
  if (maxSd <= 60) return 'chui';
  return 'taisaku';
}

// ── リラックス法の実施率を評価する ───────────────────────
function evaluateRelax(rows) {
  // '免除' の行は除外して計算する
  const targets = rows.filter(r => String(r[COL_RELAX] || '').trim() !== '免除');
  if (targets.length === 0) return { label: 'ryoko', rate: 100 }; // 全行免除
  // '〇'（U+3007 漢数字の零）を実施済みとみなす
  const done = targets.filter(r => String(r[COL_RELAX] || '').trim() === '\u3007').length;
  const rate = Math.round(done / targets.length * 100);
  const label = rate >= 80 ? 'ryoko' : rate >= 40 ? 'chui' : 'taisaku';
  return { label, rate };
}

// ── 行動量（オーバー%）を評価する ────────────────────────
function evaluateOver(rows) {
  const overRows = rows.filter(r => {
    const v = parseFloat(String(r[COL_OVER] || '').replace('%', ''));
    return !isNaN(v) && v > 100;
  });
  const days  = overRows.length;
  const label = days === 0 ? 'ryoko' : days <= 2 ? 'chui' : 'taisaku';
  return { label, days };
}

// ── 評価期間の文字列を作る（月曜実行 → 前週月〜日） ──────
function buildPeriod() {
  const DAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const fmt  = d => `${d.getMonth() + 1}/${d.getDate()}（${DAYS[d.getDay()]}）`;
  const now  = new Date();
  const end  = new Date(now); end.setDate(now.getDate() - 1);   // 昨日（日）
  const start = new Date(now); start.setDate(now.getDate() - 7); // 先週月曜
  return `${fmt(start)} 〜 ${fmt(end)}`;
}

// ── 信号機の色を返す ──────────────────────────────────────
function signalColors(label) {
  if (label === 'ryoko')   return { r: '#4a1515', y: '#3d3000', g: '#22c55e' };
  if (label === 'chui')    return { r: '#4a1515', y: '#fbbf24', g: '#0a2e18' };
  if (label === 'taisaku') return { r: '#ef4444', y: '#3d3000', g: '#0a2e18' };
  return { r: '#4a1515', y: '#3d3000', g: '#0a2e18' };
}

function labelText(label) {
  if (label === 'ryoko')   return '良好';
  if (label === 'chui')    return '注意';
  if (label === 'taisaku') return '要対策';
  return '対象外';
}

function iconHtml(label) {
  const cls    = label === 'ryoko' ? 'c-icon-ryoko' : label === 'chui' ? 'c-icon-chui' : 'c-icon-taisaku';
  const stroke = label === 'ryoko' ? '#16a34a'       : label === 'chui' ? '#a16207'      : '#b91c1c';
  const iconId = label === 'ryoko' ? 'ic-check'      : label === 'chui' ? 'ic-excl'      : 'ic-cross';
  return `<span class="c-icon ${cls}"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><use href="#${iconId}"/></svg></span>`;
}

function commentSleep(label) {
  if (label === 'ryoko')   return '睡眠リズムは安定しています。この調子を維持しましょう。';
  if (label === 'chui')    return '就寝・起床時刻のばらつきが見られます。一定のリズムを心がけましょう。';
  if (label === 'taisaku') return '睡眠リズムが大きく乱れています。早急な改善が必要です。';
  return '';
}

function commentRelax(label, rate) {
  if (label === 'ryoko')   return `リラックス法を${rate}実施できています。継続しましょう。`;
  if (label === 'chui')    return `リラックス法の実施率が${rate}です。できる日を増やしましょう。`;
  if (label === 'taisaku') return `リラックス法がほとんど実施できていません（${rate}）。優先して取り組みましょう。`;
  return '';
}

function commentOver(label, days) {
  if (label === 'ryoko')   return '行動量は体力の範囲内に収まっています。';
  if (label === 'chui')    return `${days}日間、体力をやや超える行動量がありました。休息を意識しましょう。`;
  if (label === 'taisaku') return `${days}日間、体力を大きく超える行動量がありました。休養が必要です。`;
  return '';
}

// ── メイン処理 ────────────────────────────────────────────
(async () => {
  // 1. スプレッドシートを読んで有効な直近7行を取得
  console.log('スプレッドシートを読み込んでいます...');
  const allRows = await readSheet();

  // 就寝時間（COL_BED）が入っている行だけを対象にする
  const validRows = allRows.filter(r => r && String(r[COL_BED] || '').trim() !== '');
  const lastRows  = validRows.slice(-7); // 直近7日分

  if (lastRows.length === 0) {
    throw new Error('有効なデータ行が見つかりませんでした。スプレッドシートの内容を確認してください。');
  }
  console.log(`有効データ ${lastRows.length} 行を評価します。`);

  // 2. 各項目を評価
  const sleepLabel = evaluateSleep(lastRows);
  const { label: relaxLabel, rate: relaxRate } = evaluateRelax(lastRows);
  const { label: overLabel,  days: overDays  } = evaluateOver(lastRows);
  const period = buildPeriod();

  console.log(`評価結果: 睡眠=${sleepLabel}, リラックス=${relaxLabel}(${relaxRate}%), 行動量=${overLabel}(${overDays}日超過)`);

  // 3. 総評を決定
  const allLabels  = [sleepLabel, relaxLabel, overLabel];
  const overall    = allLabels.includes('taisaku') ? 'taisaku'
                   : allLabels.includes('chui')    ? 'chui'
                   :                                 'ryoko';
  const overallColor = overall === 'taisaku' ? '#ef4444'
                     : overall === 'chui'    ? '#d97706'
                     :                         '#16a34a';

  // 4. HTMLテンプレートにデータを埋め込む
  const sc         = signalColors;
  const rateWithPct = relaxRate + '%';
  const tmpl       = path.join(__dirname, '..', 'report-template-inline.html');
  let html         = fs.readFileSync(tmpl, 'utf8');

  const params = {
    PERIOD:             period,
    OVERALL_LABEL:      labelText(overall),
    OVERALL_COLOR:      overallColor,
    OVERALL_R:          sc(overall).r, OVERALL_Y: sc(overall).y, OVERALL_G: sc(overall).g,

    SLEEP_LABEL:        labelText(sleepLabel),
    SLEEP_CLASS:        sleepLabel,
    SLEEP_R:            sc(sleepLabel).r, SLEEP_Y: sc(sleepLabel).y, SLEEP_G: sc(sleepLabel).g,

    RELAX_LABEL:        labelText(relaxLabel),
    RELAX_CLASS:        relaxLabel,
    RELAX_RATE:         rateWithPct,
    RELAX_R:            sc(relaxLabel).r, RELAX_Y: sc(relaxLabel).y, RELAX_G: sc(relaxLabel).g,

    OVER_LABEL:         labelText(overLabel),
    OVER_CLASS:         overLabel,
    OVER_DAYS:          String(overDays),
    OVER_R:             sc(overLabel).r, OVER_Y: sc(overLabel).y, OVER_G: sc(overLabel).g,

    COMMENT_SLEEP:      commentSleep(sleepLabel),
    COMMENT_RELAX:      commentRelax(relaxLabel, rateWithPct),
    COMMENT_OVER:       commentOver(overLabel, overDays),
    COMMENT_SLEEP_ICON: iconHtml(sleepLabel),
    COMMENT_RELAX_ICON: iconHtml(relaxLabel),
    COMMENT_OVER_ICON:  iconHtml(overLabel),
  };

  Object.keys(params).forEach(k => {
    html = html.split('{{' + k + '}}').join(params[k]);
  });

  // 5. Playwright でスクリーンショットを撮る
  console.log('report.png を生成しています...');
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 480, height: 640 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: 'report.png', type: 'png' });
    console.log('report.png を生成しました。');
  } finally {
    await browser.close();
  }
})();

