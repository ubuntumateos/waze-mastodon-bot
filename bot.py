import feedparser
from mastodon import Mastodon
import os
import time

# GitHub Secretsから安全に読み込み
MASTODON_URL = os.getenv('MASTODON_URL')
ACCESS_TOKEN = os.getenv('MASTODON_ACCESS_TOKEN')
RSS_URL = os.getenv('WAZE_RSS_URL')
LAST_RUN_FILE = "last_run.txt"

def run():
    # トークンが設定されているかチェック
    if not ACCESS_TOKEN or not MASTODON_URL:
        print("エラー: トークンまたはURLが設定されていません。")
        return

    # Mastodonクライアントの初期化
    mastodon = Mastodon(
        access_token=ACCESS_TOKEN,
        api_base_url=MASTODON_URL
    )

    # WazeのRSSフィードを取得
    feed = feedparser.parse(RSS_URL)
    
    # 前回の実行時刻を読み込み（重複投稿防止）
    last_time = 0
    if os.path.exists(LAST_RUN_FILE):
        with open(LAST_RUN_FILE, "r") as f:
            try:
                last_time = float(f.read().strip())
            except ValueError:
                last_time = 0

    new_items = []
    for entry in feed.entries:
        # 投稿時刻を取得
        pub_time = time.mktime(entry.published_parsed)
        if pub_time > last_time:
            new_items.append((pub_time, entry))

    # 古い順（時系列）にソート
    new_items.sort(key=lambda x: x[0])

    if not new_items:
        print("新着情報はありません。")
        return

    # Mastodonへ投稿
    for pub_time, entry in new_items:
        # メッセージ内容（必要に応じて調整してください）
        message = f"【Waze 交通情報】\n{entry.title}\n{entry.link}"
        
        try:
            mastodon.status_post(message)
            print(f"投稿成功: {entry.title}")
            last_time = pub_time
        except Exception as e:
            print(f"投稿失敗: {e}")

    # 最終実行時刻をファイルに記録
    with open(LAST_RUN_FILE, "w") as f:
        f.write(str(last_time))

if __name__ == "__main__":
    run()
  
