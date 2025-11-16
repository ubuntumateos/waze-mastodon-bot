// bot.js - Waze RSS → Mastodon 24時間自動投稿
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const RSS_URL = "https://blog.google/waze/rss/";
const RSS2JSON_API = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(RSS_URL)}`;
const MASTODON_INSTANCE = process.env.MASTODON_INSTANCE;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const CHECK_INTERVAL = 5 * 60 * 1000;
const POSTED_FILE = '/tmp/posted.json';

let postedGuids = loadPostedGuids();

function loadPostedGuids() {
    if (fs.existsSync(POSTED_FILE)) {
        try { return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8')); }
        catch (e) { return []; }
    }
    return [];
}

function savePostedGuids() {
    fs.writeFileSync(POSTED_FILE, JSON.stringify(postedGuids, null, 2));
}

async function fetchRSS() {
    try {
        const res = await axios.get(RSS2JSON_API);
        return res.data.items || [];
    } catch (err) {
        console.error('RSS取得失敗:', err.message);
        return [];
    }
}

function extractImage(html) {
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : null;
}

async function postToMastodon(title, link, imageUrl = null) {
    const status = `${title}\n${link}`;
    const form = new FormData();
    form.append('status', status);

    if (imageUrl) {
        try {
            const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            form.append('media[]', Buffer.from(imgRes.data), {
                filename: 'waze.jpg',
                contentType: imgRes.headers['content-type'] || 'image/jpeg'
            });
        } catch (e) {
            console.warn('画像添付失敗:', e.message);
        }
    }

    try {
        const res = await axios.post(
            `https://${MASTODON_INSTANCE}/api/v1/statuses`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${ACCESS_TOKEN}`
                }
            }
        );
        console.log(`投稿成功: ${title}`);
        return true;
    } catch (err) {
        console.error('投稿失敗:', err.response?.data?.error || err.message);
        return false;
    }
}

async function checkAndPost() {
    console.log(`\n[${new Date().toLocaleString('ja-JP')}] チェック中...`);
    const items = await fetchRSS();
    if (items.length === 0) return;

    const latest = items[0];
    if (postedGuids.includes(latest.guid)) {
        console.log('新着なし');
        return;
    }

    console.log('新着発見！投稿中...');
    const imageUrl = extractImage(latest.description);
    const success = await postToMastodon(latest.title, latest.link, imageUrl);

    if (success) {
        postedGuids.unshift(latest.guid);
        postedGuids = postedGuids.slice(0, 100);
        savePostedGuids();
    }
}

if (!MASTODON_INSTANCE || !ACCESS_TOKEN) {
    console.error('エラー: 環境変数を設定してください！');
    process.exit(1);
}

checkAndPost();
setInterval(checkAndPost, CHECK_INTERVAL);

console.log('Waze → Mastodon ボット起動完了！');
