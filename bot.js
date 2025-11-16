// bot.js - Waze RSS → Mastodon（毎日19時・重複投稿なし）
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// ==== 設定 ====
const RSS_URL = "https://blog.google/waze/rss/";
const RSS2JSON_API = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(RSS_URL)}`;

// ⬅ GitHub Actions の Secrets に設定
const MASTODON_INSTANCE = process.env.MASTODON_INSTANCE;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

const POSTED_FILE = 'posted.json';

// ==== 環境変数チェック ====
if (!MASTODON_INSTANCE || !ACCESS_TOKEN) {
    console.error('エラー: MASTODON_INSTANCE または ACCESS_TOKEN がありません。');
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

// ==== ★ 修正: Mastodon メディアアップロード処理を分離 ====
async function uploadMedia(imageUrl) {
    try {
        // 画像をストリームとして取得
        const imgRes = await axios.get(imageUrl, { responseType: "stream" });
        const contentType = imgRes.headers["content-type"] || "image/jpeg";
        const filename = `image.${contentType.split('/')[1] || 'jpg'}`;

        const mediaForm = new FormData();
        // 画像ストリームを 'file' パラメータとして追加
        mediaForm.append("file", imgRes.data, { filename: filename, contentType: contentType });

        // /api/v1/media エンドポイントにアップロード
        const mediaRes = await axios.post(
            `https://${MASTODON_INSTANCE}/api/v1/media`,
            mediaForm,
            {
                headers: {
                    ...mediaForm.getHeaders(),
                    "Authorization": `Bearer ${ACCESS_TOKEN}`
                },
                timeout: 30000 
            }
        );
        
        // アップロード成功。メディアIDを返す
        return mediaRes.data.id; 

    } catch (err) {
        console.warn("画像アップロード失敗:", err.response?.data?.error || err.message);
        return null;
    }
}


// ==== Mastodon 投稿 (修正版) ====
async function postToMastodon(title, link, imageUrl = null) {
    const status = `${title}\n${link}`;
    const form = new FormData();

    form.append("status", status);
    form.append("visibility", "unlisted"); // 未収載

    let mediaId = null;
    if (imageUrl) {
        // 画像がある場合、まずアップロードする
        mediaId = await uploadMedia(imageUrl);
    }
    
    if (mediaId) {
        // 画像IDを取得できたら、ステータスフォームに media_ids[] として追加
        form.append("media_ids[]", mediaId);
    }

    try {
        // ステータス投稿時は form-data のヘッダーは不要
        await axios.post(
            `https://${MASTODON_INSTANCE}/api/v1/statuses`,
            form,
            {
                headers: {
                    // form-data のヘッダーは不要になったため削除（Authorizationのみ残す）
                    "Authorization": `Bearer ${ACCESS_TOKEN}`,
                    ...form.getHeaders() // 念のためform-dataのヘッダーも追加
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


// ==== ★ 1日1回・19時用チェック処理 ====
async function checkAndPost() {
    console.log(`\n[${new Date().toLocaleString("ja-JP")}] 毎日19時チェック開始`);

    const items = await fetchRSS();
    if (items.length === 0) {
        console.log("RSSが空です");
        return;
    }

    const latest = items[0];

    // **重複判定キー（GUID + Link）**
    const idKey = `${latest.guid}::${latest.link}`;

    if (posted.includes(idKey)) {
        console.log("新着なし（前回と同じ → 投稿しない）");
        return;
    }

    console.log("新着RSS → 投稿開始");

    const imageUrl = extractImage(latest.description);
    const success = await postToMastodon(latest.title, latest.link, imageUrl);

    if (success) {
        posted.unshift(idKey);
        posted = posted.slice(0, 200); // 過去200件保存
        savePosted();
    }
}

checkAndPost();
