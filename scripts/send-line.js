(async () => {
  const REPO     = process.env.GITHUB_REPOSITORY;
  const ts       = Date.now();
  const imageUrl = `https://raw.githubusercontent.com/${REPO}/main/report.png?t=${ts}`;

  console.log('LINE に送信する画像URL:', imageUrl);

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.LINE_TOKEN,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      to: process.env.LINE_USER_ID,
      messages: [{
        type:                'image',
        originalContentUrl:  imageUrl,
        previewImageUrl:     imageUrl
      }]
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE API エラー: ${res.status} ${body}`);
  }

  console.log('LINE への送信が完了しました。');
})();
