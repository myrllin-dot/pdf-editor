# PDF Editor

純瀏覽器的 PDF 編輯器：改寫原有文字、手繪、箭頭、螢光筆、插入文字，以及批次加頁碼／頁尾／浮水印。

**檔案完全不會上傳。** 所有處理都在你自己的瀏覽器裡完成，沒有後端、沒有追蹤、關掉網路也能用。

👉 **[開啟編輯器](https://myrllin-dot.github.io/pdf-editor/)**

---

## 功能

| 工具 | 說明 |
|---|---|
| **改字** | 點 PDF 上原有的文字直接修改。會先用「吸取到的紙張底色」蓋住原字，再疊上新字 |
| **加字** | 在任意位置插入文字，支援多行與中文 |
| **手繪** | 壓感無關的平滑筆跡，可調粗細顏色 |
| **箭頭** | 拖曳畫出實心箭頭 |
| **螢光筆** | 色彩增值（multiply），蓋住的字依然看得見 |
| **直線／矩形／橢圓** | 可設外框粗細與填滿顏色。粗細設 0 就只有填滿。按住 Shift 鎖定正方形／正圓／45 度 |
| **文字樣式** | 粗體、斜體、底線、字距、行距、對齊、錨點、文字框（設寬度就自動換行，中文也會斷行）|
| **文字效果** | 外框 Outline、鏤空 Hollow、回聲 Echo，可調粗細、顏色、重複次數 |
| **出血框線** | 裁切線、安全範圍、中心線疊在頁面上，拖曳時會吸附。**只在畫面上，不會印出也不會存進 PDF** |
| **圖層與透明度** | 每個標記都能調前後順序和不透明度 |
| **批次標記** | 頁碼（`{n}` / `{total}` 樣板、起始號、六個位置）、頁尾、斜向浮水印，可指定頁面範圍 `1-5,8` |
| **文字辨識 OCR** | 辨識掃描頁面上的文字，讓「改字」能用在掃描檔上。繁中／英文／中英混合，可只做一頁或全部 |
| **頁面縮圖** | 左側縮圖列，點選跳頁，有標記的頁面會顯示藍點。捲到才算繪，幾百頁也不卡 |

其他：復原／重做、拖曳移動任何標記、縮放與適寬、拖放開檔、未存檔離開會提醒。

快速鍵（按 <kbd>?</kbd> 隨時叫出對照表）：

| | | | |
|---|---|---|---|
| `V` 選取 | `A` 加字 | `E` 改字 | `P` 手繪 |
| `W` 箭頭 | `L` 直線 | `R` 矩形 | `O` 橢圓 |
| `H` 螢光 | `G` 出血框線 | `F` 縮圖列 | `?` 快捷鍵表 |
| `⌘Z` 復原 | `⌘⇧Z` 重做 | `⌘S` 另存 | `Delete` 刪除 |
| `]` 往前一層 | `[` 往後一層 | `⌥]` 最前 | `⌥[` 最後 |

`T` 仍然是加字（和 `A` 一樣）。箭頭從 `A` 移到 `W`，因為 `A` 讓給加字了。

中文會自動偵測並嵌入 Noto Sans TC（**子集化**，所以加一行中文頁尾大約只增加 5–8 KB，不是整包 7 MB）。

---

## 文字辨識（OCR）怎麼用

掃描的 PDF 只有圖片、沒有文字圖層，「改字」點下去會沒反應——它會直接告訴你這一頁是掃描的。
按右上角「文字辨識…」跑 OCR 之後，辨識到的每一行就會變成可以點選修改的對象，
字級和位置都已經對好，你只要改內容。

**語言要選對。** 測過同一張中文掃描：

| 設定 | 標題辨識結果 |
|---|---|
| `繁體中文` | 長身練習曲第三號 ← 只錯一個字 |
| `中英混合` | REBARE HE 第三號 ← 整個壞掉 |

Tesseract 同時載入中英文時，中文正確率會嚴重下降。**中文文件就選「繁體中文」**，
它一樣讀得出文件裡夾雜的英文。只有真的大量中英夾雜才用混合模式。

**掃描解析度決定成敗。** 同一段文字，來源解析度不同結果差很多：

| 來源解析度 | 「長笛練習曲 第三號」辨識結果 |
|---|---|
| 約 200 DPI | 長身練習曲第三號 ← 錯 1 字 |
| 約 145 DPI | 長由練沂曲弟三號 ← 錯 3 字 |

工具內部一律用 300 DPI 去算繪頁面，但原始掃描只有 150 DPI 的話，放大也只是放大模糊。
**掃描時請用 300 DPI 以上**，這比換語言、換模型都有效。

OCR 的定位是「把文字和位置先填好給你改」，**不是可靠的謄寫**。
上面那個例子裡「長笛」被讀成「長身」——這很正常，你本來就要核對。
另外它只認文字，**不認五線譜**。

第一次執行會下載約 6 MB 的辨識引擎加語言資料（實測含下載約 40 秒），
之後瀏覽器會快取，同一份文件後續每頁約 1–5 秒。

## 給著色本的出血框線

右上角 ◧ 或按 <kbd>G</kbd>。預設是 KDP／Lulu 常用的 **0.125 吋出血、距裁切線 0.25 吋安全範圍**，
可以改成 mm 或 pt。

- **紅色虛線 = 裁切線**，外面那一圈會被裁掉
- **藍色虛線 = 安全範圍**，文字和重要線條要留在裡面
- **灰色點線 = 中心線**

拖曳物件時會吸附到這些線和頁面中心，**按住 Alt 暫時不吸附**。
這些線只是參考，**輸出的 PDF 裡沒有它們**。

## 選取後的快捷列

選到任何標記，它上方會浮出一條工具列：置中（水平／垂直）、大小、
圖層前後、不透明度、刪除。文字顯示「字級」，方框顯示「寬／高」。

選到文字時還會畫出**基準線**（橘色虛線），每一行都有，方便對齊。
可以在出血框線面板裡關掉。

## 文字樣式與效果

選到一個文字框時，左側面板的設定會**直接套用到那一個文字框**（可以復原）；
沒選到任何東西時，設定的是「下一個新文字」的預設值。

- **文字框**：寬設 0 = 隨文字長度自動。設寬度之後才會自動換行，中文沒有空白也會斷。
- **錨點**：決定 (x, y) 指的是文字框的哪個角。預設「基線」保持舊行為，
  也就是你點下去的位置就是第一行的基線左端。
- **外框／鏤空**：用 PDF 的文字算繪模式（`Tr 1` / `Tr 2`），是真正的描邊，不是畫兩層。
- **字距**：用 PDF 的 `Tc`，輸出的文字仍然可以選取、複製、搜尋。
- **斜體**：標準字體用真正的 Oblique 字檔；內建／本機字體沒有斜體檔，用傾斜 12° 模擬。
- **粗體**：標準字體用真正的 Bold 字檔；其他字體把文字畫兩次模擬。

畫面預覽和輸出走同一套排版程式（`js/textlayout.js`），所以換行、對齊、間距都會一致。
唯一的小差異：瀏覽器算字寬時會做 kerning，PDF 不會，所以很長的一行偶爾會差一個斷行點。

## 加自己的字體

字體分兩種放法，**依授權決定**，不要放錯。

### 1. 內建字體（會進 repo，所有人都看得到）

適用：可以自由散布的字體（OFL、Apache 等）。

```
1. 把 .ttf / .otf 放進 vendor/fonts/
2. 打開 vendor/fonts/fonts.json，加一筆：

   { "key": "huninn", "label": "粉圓體 jf open 粉圓",
     "file": "jf-openhuninn-2.1.ttf", "cjk": true }

3. commit、push。沒有其他地方要改。
```

| 欄位 | 說明 |
|---|---|
| `key` | 唯一代號，會存進標記資料裡，**之後不要改名** |
| `label` | 字體下拉選單顯示的名稱 |
| `file` | `vendor/fonts/` 裡的檔名 |
| `cjk` | 有中文字就設 `true`。標準字體編碼不了的文字會自動改用其中一個 `cjk` 字體 |

目前內建：Noto Sans TC、jf open 粉圓（justfont，OFL 1.1）。
輸出時字體會**子集化**，所以加一行粉圓體大概只增加幾 KB，不是整包 4.9 MB。

### 2. 本機字體（只留在你的瀏覽器）

適用：**你有授權用、但不能散布的字體** — 商用字體、品牌字體、客戶指定的字體。

字體下拉選單 → **「＋ 從這台電腦加入字體…」** → 選檔案。

存在瀏覽器的 IndexedDB 裡，重新整理後仍然在。不會上傳、不會進 repo、別人打開這個網站看不到。
輸出的 PDF 會嵌入它（這是 PDF 一定要做的事），所以**散布那份 PDF 前請確認你的字體授權允許嵌入**。

> ⚠️ 你 `Downloads/Typeface` 裡的 Canva Sans 屬於第 2 類。
> 它的授權寫明 *"To be utilised by Canva Pty Ltd and associated partners ONLY on brand projects"*，
> 放進公開 repo 會違反授權。請用「從這台電腦加入字體」。

### 字體與粗體

每個字體檔只載一個字重。勾「粗體」時，標準字體會用真正的 Bold 字檔；
內建／本機字體則是把文字畫兩次做出假粗體。要真正的 Bold 字重，就把 Bold 檔案當成另一個字體加進去。

## 已知限制（請先讀這段）

- **「改字」是遮蓋重打，不是真的刪除。** 原本的文字仍留在 PDF 內部，`pdftotext`、搜尋、複製貼上都還抓得到。
  掃描檔也一樣：蓋住只是蓋住，原本的文字像素還在那張圖裡面。
  **不要用它做機密遮蔽（redaction）。** 真正的遮蔽必須重寫內容串流或重新編碼圖片，這個工具沒有做。
- **OCR 一定有錯**，尤其是中文。它是給你一個起點去修改，不是正確答案。細節見上一節。
- **字體不會完全一樣。** 改字後用的是 Helvetica／Times／Courier／Noto Sans TC，不是原檔嵌入的那套字體。
  字級和位置會對齊，字形會有差異。短字串（曲名、標題、數字）效果好，整段內文會看得出來。
- **「改字」以一整行為單位。** PDF 內部沒有「行」這種東西，一個標題常常被拆成好幾段
  文字指令，所以本工具會把同一條基線上、間距合理的片段合併成一行再給你編輯。
  如果某個檔案的切法太特殊導致只蓋住一部分（左右還留著原字），那是這個合併規則沒涵蓋到，
  請把該檔案給我。
- **掃描的 PDF 沒有文字層**，「改字」會告訴你這裡沒有可編輯的文字。請改用「加字」覆蓋。本工具不含 OCR。
- **不支援加密／有密碼的 PDF**，請先解除密碼。
- 畫面預覽用系統字體、輸出用嵌入字體，兩者字寬有極小差異，置中的頁尾可能差幾個 point。
- 文字是整個「文字區塊（text run）」為單位編輯，不是單一字元；PDF 怎麼切分區塊由產生它的軟體決定。

---

## 運作方式

```
PDF ──▶ pdf.js ──▶ <canvas> 顯示
                   <canvas> 疊加層 ──▶ 標記（以 PDF point 儲存）
                                        │
原始位元組 ───────────────────────────▶ pdf-lib ──▶ 輸出 PDF
```

關鍵約定寫在 `js/state.js` 最上面：**每一個標記都以 PDF 使用者座標（point、左下原點、未旋轉頁面）儲存**。
螢幕與 PDF 座標的轉換只發生在最外層（`js/viewer.js`），所以縮放、`/Rotate` 旋轉頁都不需要下游程式操心。
`js/overlay.js`（畫到螢幕）和 `js/export.js`（寫進 PDF）刻意互相對照，共用的幾何常數放在 `js/geom.js`——
所見即所得就是靠這個。

```
js/
  state.js          狀態與復原堆疊、座標約定
  viewer.js         pdf.js 載入、算繪、文字抽取、座標轉換
  overlay.js        把標記畫到螢幕、hit-test、搬移
  tools.js          指標操作：選取／改字／加字／手繪／箭頭／螢光
  stamps.js         批次頁碼／頁尾／浮水印
  fonts.js          字體登錄表：標準 14 種 / 內建 / 本機三類來源
  textlayout.js     排版：斷行、對齊、錨點、字距行距。預覽與輸出共用，確保一致
  guides.js         出血／安全／中心線、基準線、拖曳吸附（全部只在畫面上）
  selbar.js         選取後浮出的快捷列
  ocr.js            Tesseract 文字辨識，輸出與原生文字圖層同形狀的資料
  thumbs.js         頁面縮圖列（lazy render + 標記合成）
  export.js         pdf-lib 壓平輸出、字體解析
  fontkit-compat.js 讓 pdf-lib 1.17 能用 fontkit 3（見檔案開頭註解）
  geom.js           共用幾何／字體常數，無 DOM 相依，可單獨測試
vendor/             所有第三方程式庫，見 vendor/VENDOR.md
test/               見 test/README.md
```

沒有 build step、沒有 npm 相依、沒有 CDN。clone 下來用任何靜態伺服器開即可。

repo 大約 35 MB，其中 16 MB 是 OCR 引擎與語言資料、12 MB 是兩套中文字體。
這些都是**用到才載**——不碰 OCR 就不會下載那 6 MB，不打中文就不會下載字體。

---

## 本機執行

```bash
git clone https://github.com/myrllin-dot/pdf-editor.git
cd pdf-editor
python3 -m http.server 8777
# 開 http://localhost:8777
```

需要用伺服器開（不能直接雙擊 `index.html`），因為用了 ES modules 和 Web Worker，`file://` 會被 CORS 擋掉。

## 測試

見 [`test/README.md`](test/README.md)。輸出的 PDF 要用眼睛看過——
字體子集化壞掉的時候，文字抽取是正常的，只有算繪出來是空白。

---

## English

A browser-only PDF editor: rewrite existing text, draw, add arrows, highlight,
insert text, draw shapes, OCR scanned pages, and batch-apply page numbers /
footers / watermarks, with a page-thumbnail rail. Files never leave your
device — no backend, works offline.

Read the 已知限制 section above before relying on it. The short version: the
"edit text" tool **covers and retypes**; the original text is still inside the
PDF and still extractable, so this is **not a redaction tool**. Replacement
glyphs come from standard fonts or Noto Sans TC, not the document's own
embedded face. OCR gives you a *starting point to correct*, not a reliable
transcription — and pick a single language, because loading Chinese and
English together measurably wrecks Chinese accuracy.

To add a font: redistributable ones go in `vendor/fonts/` plus an entry in
`vendor/fonts/fonts.json`; anything you're licensed to use but not to
redistribute goes in through 字體 → 從這台電腦加入字體, which keeps it in your
browser and out of the repo. See 加自己的字體 above.

## 授權

程式碼 MIT。`vendor/` 內各程式庫維持原授權（pdf.js、pdf-lib、fontkit、tesseract.js
為 Apache-2.0 / MIT），Noto Sans TC 為 SIL Open Font License 1.1，
Tesseract 語言資料為 Apache-2.0。
