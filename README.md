# 流し見単語帳（個人用）

「単語は覚えた／覚えてないの2択ではなく、出会った回数で覚えている度合いが上がる」という学習法
（YouTube「唯一かつ最強の単語学習【英検1級・通訳者】」）をもとにした英単語アプリ。

- 単語と意味だけを 1〜2 秒ずつ流し見する
- 一瞬で意味が出たら ✓、7日以上あけてもう一度 ✓ で ◎（チェック丸）→ 以後は出題しない
- 流し見の前に発音チェック（ブラウザの読み上げ機能）
- AI が作った単語帳（JSON / 「英語 | 日本語」形式）を貼り付けて継ぎ足し。重複は確認画面で処理
- 検索・非表示・ゴミ箱・重複整理・JSON バックアップ

## 起動（開発用）

Node.js などのインストールは不要。ビルドもなし（素の HTML/CSS/JS）。

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

→ http://localhost:5173/ を開く。

## 構成

| ファイル | 役割 |
|---|---|
| `js/store.js` | IndexedDB への保存・読み込み、バックアップ |
| `js/text.js` | 重複判定用の正規化、取り込みテキストの解析 |
| `js/importer.js` | 重複チェック（新規 / 同じ意味 / 意味違い）と反映 |
| `js/speech.js` | 読み上げ |
| `js/views/*.js` | 各画面（流し見・発音・一覧・追加・設定） |
| `sw.js` | オフライン対応（ネットワーク優先） |

## 取り込み形式

```json
{"source":"曲名 / アーティスト","tags":["song"],"items":[{"term":"have to be","meaning":"〜でなければならない","note":"歌詞では have to been"}]}
```

または 1 行 1 件：`英語 | 日本語 | メモ(任意)`

## 同期（Firebase）

- 設定 → 「Google でログイン」。保存場所は Firestore の `users/{uid}/items/{id}`
- 変更した単語だけを送信し、前回以降にサーバーへ書かれた単語だけを受信（`syncedAt` はサーバー時刻）
- 同じ単語は `updatedAt` が新しい方を残す。削除は墓標（`purged`）として同期
- Firebase SDK は gstatic から読み込み（`js/firebase-config.js` でバージョン指定）
- Firestore ルールで自分のメールアドレスの UID 以外は読み書き不可

## 今後

- 公開：GitHub Pages（公開ドメインを Authentication の「承認済みドメイン」に追加する）
