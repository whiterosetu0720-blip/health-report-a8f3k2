const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 評価ラベルに対応する信号機の色（点灯=明るい色、消灯=暗い色）
function signalColors(label) {
  if (label === 'ryoko')   return { r: '#4a1515', y: '#3d3000', g: '#22c55e' };
  if (label === 'chui')    return { r: '#4a1515', y: '#fbbf24', g: '#0a2e18' };
  if (label === 'taisaku') return { r: '#ef4444', y: '#3d3000', g: '#0a2e18' };
  return { r: '#4a1515', y: '#3d3000', g: '#0a2e18' };
}

// 評価ラベルを日本語テキストに変換
function labelText(label) {
  if (label === 'ryoko')   return '良好';
  if (label === 'chui')    return '注意';
  if (label === 'taisaku') return '要対策';
  return '対象外';
}

// 総評コメントのアイコンHTML（ラベルに応じた色とアイコン形状）
function iconHtml(label) {
  const cls = label === 'ryoko'   ? 'c-icon-ryoko'
            : label === 'chui'    ? 'c-icon-chui'
            : 'c-icon-taisaku';
  const stroke = label === 'ryoko'   ? '#16a34a'
               : label === 'chui'    ? '#a16207'
               : '#b91c1c';
  const iconId = label === 'ryoko'   ? 'ic-check'
               : label === 'chui'    ? 'ic-excl'
               : 'ic-cross';
  return `<span class="c-icon ${cls}"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><use href="#${iconId}"/></svg></span>`;
}

// 睡眠評価コメント
function commentSleep(label) {
  if (label === 'ryoko')   return '睡眠リズムは安定しています。この調子を維持しましょう。';
  if (label === 'chui')    return '就寝・起床時刻のばらつきが見られます。一定のリズムを心がけましょう。';
  if (label === 'taisaku') return '睡眠リズムが大きく乱れています。早急な改善が必要です。';
  return '';
}

// リラックス評価コメント
function commentRelax(label, rate) {
  if (label === 'ryoko')   return `リラックス法を${rate}実施できています。継続しましょう。`;
  if (label === 'chui')    return `リラックス法の実施率が${rate}です。できる日を増やしましょう。`;
  if (label === 'taisaku') return `リラックス法がほとんど実施できていません（${rate}）。優先して取り組みましょう。`;
  return '';
}

// 行動量評価コメント
function commentOver(label, days) {
  if (label === 'ryoko')   return '行動量は体力の範囲内に収まっています。';
  if (label === 'chui')    return `${days}日間、体力をやや超える行動量がありました。休息を意識しましょう。`;
  if (label === 'taisaku') return `${days}日間、体力を大きく超える行動量がありました。休養が必要です。`;
  return '';
}

(async () => {
  const sleep = process.env.SLEEP_LABEL  || 'ryoko';
  const relax = process.env.RELAX_LABEL  || 'ryoko';
  const over  = process.env.OVER_LABEL   || 'ryoko';
  const rate  = process.env.RELAX_RATE   || '0';
  const days  = process.env.OVER_DAYS    || '0';

  // 総評：いずれかが taisaku なら taisaku、chui なら chui、それ以外は ryoko
  const allLabels = [sleep, relax, over];
  const overall   = allLabels.includes('taisaku') ? 'taisaku'
                  : allLabels.includes('chui')    ? 'chui'
                  :                                 'ryoko';

  const overallColor = overall === 'taisaku' ? '#ef4444'
                     : overall === 'chui'    ? '#d97706'
                     :                         '#16a34a';

  const sc  = signalColors;
  const tmpl = path.join(__dirname, '..', 'report-template-inline.html');
  let html  = fs.readFileSync(tmpl, 'utf8');

  const rateWithPct = rate + '%';

  const params = {
    PERIOD:            process.env.PERIOD || '',
    OVERALL_LABEL:     labelText(overall),
    OVERALL_COLOR:     overallColor,
    OVERALL_R:         sc(overall).r,
    OVERALL_Y:         sc(overall).y,
    OVERALL_G:         sc(overall).g,

    SLEEP_LABEL:       labelText(sleep),
    SLEEP_CLASS:       sleep,
    SLEEP_R:           sc(sleep).r,
    SLEEP_Y:           sc(sleep).y,
    SLEEP_G:           sc(sleep).g,

    RELAX_LABEL:       labelText(relax),
    RELAX_CLASS:       relax,
    RELAX_RATE:        rateWithPct,
    RELAX_R:           sc(relax).r,
    RELAX_Y:           sc(relax).y,
    RELAX_G:           sc(relax).g,

    OVER_LABEL:        labelText(over),
    OVER_CLASS:        over,
    OVER_DAYS:         days,
    OVER_R:            sc(over).r,
    OVER_Y:            sc(over).y,
    OVER_G:            sc(over).g,

    COMMENT_SLEEP:     commentSleep(sleep),
    COMMENT_RELAX:     commentRelax(relax, rateWithPct),
    COMMENT_OVER:      commentOver(over, days),
    COMMENT_SLEEP_ICON: iconHtml(sleep),
    COMMENT_RELAX_ICON: iconHtml(relax),
    COMMENT_OVER_ICON:  iconHtml(over),
  };

  // プレースホルダーを一括置換
  Object.keys(params).forEach(k => {
    html = html.split('{{' + k + '}}').join(params[k]);
  });

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
