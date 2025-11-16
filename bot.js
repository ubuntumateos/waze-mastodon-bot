// bot.js - Waze RSS → Mastodon 24時間自動投稿【重複投稿100%防止版】
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const http = require('http');

// ==== 設定 ====
const RSS_URL = "https://blog.google/waze/rss/";
const RSS2JSON_API = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(RSS_URL)}`;
const MASTODON_INSTANCE = process.env.MASTODON_INSTANCE;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const CHECK_INTERVAL = 30 * 60 * 1000;
const POSTED_FILE = '/tmp/posted.json';

// ==== 環境変数チェック ====
if (!MASTODON_INSTANCE || !ACCESS_TOKEN) {
    console.error('エラー: MASTODON_INSTANCE または ACCESS_TOKEN を設定してください！');
    process.exit(1);
}

// ==== 投稿済みデータ読み込み ====
let posted = loadPosted();

function loadPosted() {
    if (fs.existsSync(POSTED_FILE)) {
        try {
            const json = JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8'));
            return Array.isArray(json) ? json : [];
        } catch {
            return [];
        }
    }
    return [];
}

function savePosted() {
    fs.writeFileSync(POSTED_FILE, JSON.stringify(posted, null, 2));
}

// ==== RSS取得 ====
async function fetchRSS() {
    try {
        const res = await axios.get(RSS2JSON_API);
        return res.data.items || [];
    } catch (err) {
        console.error("RSS取得失敗:", err.message);
        return [];
    }
}

// ==== HTML から画像URL抽出 ====
function extractImage(html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return m ? m[1] : null;
}

// ==== Mastodon 投稿 ====
async function postToMastodon(title, link, imageUrl = null) {
    const status = `${title}\n${link}`;
    const form = new FormData();

    form.append("status", status);
    form.append("visibility", "unlisted");

    if (imageUrl) {
        try {
            const imgRes = await axios.get(imageUrl, { responseType: "arraybuffer" });
            form.append("media[]", Buffer.from(imgRes.data), {
                filename: "image.jpg",
                contentType: imgRes.headers["content-type"] || "image/jpeg"
            });
        } catch (e) {
            console.warn("画像添付失敗:", e.message);
        }
    }

    try {
        await axios.post(
            `https://${MASTODON_INSTANCE}/api/v1/statuses`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    "Authorization": `Bearer ${ACCESS_TOKEN}`
                }
            }
        );
        console.log(`投稿成功: ${title}`);
        return true;

    } catch (err) {
        console.error("投稿失敗:", err.response?.data?.error || err.message);
        return false;
    }
}

// ==== 新着チェック ====
async function checkAndPost() {
    console.log(`\n[${new Date().toLocaleString("ja-JP")}] チェック中...`);

    const items = await fetchRSS();
    if (items.length === 0) return;

    const latest = items[0];

    // =====================================
    // 🚫【重複チェック強化】GUID + LINK
    // =====================================
    const idKey = `${latest.guid}::${latest.link}`;

    if (posted.includes(idKey)) {
        console.log("新着なし（すでに投稿済み）");
        return;
    }

    console.log("新着記事を検出 → Mastodon投稿中...");

    const imageUrl = extractImage(latest.description);
    const success = await postToMastodon(latest.title, latest.link, imageUrl);

    if (success) {
        posted.unshift(idKey);
        posted = posted.slice(0, 200); // 過去200件保存
        savePosted();
    }
}

// ==== 初回実行 + 定期実行 ====
checkAndPost();
setInterval(checkAndPost, CHECK_INTERVAL);

// =========================================
// Render Web Service 停止対策：ポートを開く
// =========================================
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Mastodon Bot running\n");
}).listen(PORT, () => {
    console.log(`HTTPサーバー起動 (PORT=${PORT}) - Render用`);
});

