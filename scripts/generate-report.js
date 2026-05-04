const { chromium } = require('playwright');

const { google }   = require('googleapis');

const fs   = require('fs');

const path = require('path');

const core = require('./report-core');



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



(async () => {

  console.log('スプレッドシートを読み込んでいます...');

  const allRows = await readSheet();



  const validRows = allRows.filter(r => r && String(r[core.COL_BED] || '').trim() !== '');

  const lastRows  = validRows.slice(-7);



  if (lastRows.length === 0) {

    throw new Error('有効なデータ行が見つかりませんでした。スプレッドシートの内容を確認してください。');

  }

  console.log(`有効データ ${lastRows.length} 行を評価します。`);



  const sleepLabel = core.evaluateSleep(lastRows);

  const { label: relaxLabel, rate: relaxRate } = core.evaluateRelax(lastRows);

  const { label: overLabel,  days: overDays  } = core.evaluateOver(lastRows);

  const period = core.buildPeriodFromRows(lastRows);



  console.log(`評価結果: 睡眠=${sleepLabel}, リラックス=${relaxLabel}(${relaxRate}%), 行動量=${overLabel}(${overDays}日超過)`);



  const allLabels  = [sleepLabel, relaxLabel, overLabel];

  const overall    = allLabels.includes('taisaku') ? 'taisaku'

                   : allLabels.includes('chui')    ? 'chui'

                   :                                 'ryoko';

  const overallColor = overall === 'taisaku' ? '#ef4444'

                     : overall === 'chui'    ? '#d97706'

                     :                         '#16a34a';



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


