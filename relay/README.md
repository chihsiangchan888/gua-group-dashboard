# 儀表板中繼服務（Cloudflare Worker + Google Sheets API）

取代 Apps Script 的 `/exec`。瀏覽器改打這個 Worker，Worker 直接用 Google Sheets API 讀寫試算表：
每次呼叫約 0.3～1 秒，沒有 Apps Script 那一跳 404／斷線／重複執行的問題。

API 契約與 Apps Script 完全相同（`GET /`、`GET /?action=readAB`、`GET /?payload=<json>`、`POST /` JSON），
前端只需要把 `CONFIG.APPS_SCRIPT_URL` 換成 Worker 網址。多回一個 `caps.relay = "sheets-api"` 供辨識。

## 檔案
- `src/sheets.js`　Sheets API 客戶端（服務帳號 JWT 換 token、讀寫、刪列、建分頁）
- `src/actions.js`　25 個動作，一對一移植自 `apps-script/程式碼.gs`
- `src/worker.js`　入口：CORS、GET/POST 解析、寫入密鑰、reqId 去重（KV）
- `test/`　離線測試：用假的 Sheets API 跑過每個動作，不需要任何憑證　→ `node test/run.js`

## 第一次部署（只做一次，需要你本人操作的地方標了 ★）

### 1. Google 服務帳號 ★
1. https://console.cloud.google.com → 建立（或選一個）專案。
2. 「API 和服務」→「啟用 API」→ 搜尋 **Google Sheets API** → 啟用。
3. 「IAM 與管理」→「服務帳號」→ 建立服務帳號（名稱隨意，例如 `dashboard-relay`），不用給任何角色。
4. 進入該服務帳號 →「金鑰」→ 新增金鑰 → JSON → 下載，檔案例如 `dashboard-relay.json`。
5. 打開試算表（SHEET_ID 那份）→ 共用 → 把服務帳號的 email（`xxx@xxx.iam.gserviceaccount.com`）加為**編輯者**。

金鑰 JSON 不要放進 git、不要貼到對話。

### 2. Cloudflare ★
1. https://dash.cloudflare.com 註冊免費帳號。
2. 這台電腦：`npm i -g wrangler`，然後 `wrangler login`（會開瀏覽器授權）。

### 3. 建 KV 與放密鑰 ★（在 `relay/` 目錄）
```powershell
wrangler kv namespace create DEDUP        # 把印出來的 id 貼進 wrangler.toml 的 id
wrangler secret put GOOGLE_SA_JSON        # 貼上整個金鑰 JSON 的內容（一行），Enter
wrangler secret put WRITE_KEY             # 貼上寫入密鑰（跟 Apps Script 用同一串即可）
```

### 4. 部署
```powershell
wrangler deploy
```
印出的網址形如 `https://gua-dashboard-relay.<帳號>.workers.dev`。
驗證：瀏覽器開 `https://.../?action=caps` 應看到 `{"success":true,"caps":{"reqId":true,"writeKey":true,"relay":"sheets-api"}}`，
開 `https://.../` 應看到完整資料。

### 5. 切換前端
`project-timeline.html` 的 `CONFIG.APPS_SCRIPT_URL` 改成 Worker 網址，commit、push。
Apps Script 先不要刪，留著當備援（前端只要把網址改回去就切回）。

## 本機開發
`relay/.dev.vars`（git 會忽略）：
```
GOOGLE_SA_JSON={"type":"service_account",...整個 JSON 一行...}
WRITE_KEY=你的密鑰
```
然後 `wrangler dev` → http://localhost:8787 。預覽伺服器可把 API 指到這裡做端對端測試。

## 之後改程式
`node test/run.js` 全綠 → `wrangler deploy`。密鑰要換：`wrangler secret put WRITE_KEY` 重貼即可，不用重新部署。
