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
| **批次標記** | 頁碼（`{n}` / `{total}` 樣板、起始號、六個位置）、頁尾、斜向浮水印，可指定頁面範圍 `1-5,8` |

其他：復原／重做、拖曳移動任何標記、縮放與適寬、鍵盤快速鍵（`V` `E` `T` `P` `A` `H`、`⌘Z`、`⌘S`、方向鍵翻頁）、拖放開檔、未存檔離開會提醒。

中文會自動偵測並嵌入 Noto Sans TC（**子集化**，所以加一行中文頁尾大約只增加 5–8 KB，不是整包 7 MB）。

---

## 已知限制（請先讀這段）

- **「改字」是遮蓋重打，不是真的刪除。** 原本的文字仍留在 PDF 內部，`pdftotext`、搜尋、複製貼上都還抓得到。
  **不要用它做機密遮蔽（redaction）。** 真正的遮蔽必須重寫內容串流，這個工具沒有做。
- **字體不會完全一樣。** 改字後用的是 Helvetica／Times／Courier／Noto Sans TC，不是原檔嵌入的那套字體。
  字級和位置會對齊，字形會有差異。短字串（曲名、標題、數字）效果好，整段內文會看得出來。
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
  export.js         pdf-lib 壓平輸出、字體解析
  fontkit-compat.js 讓 pdf-lib 1.17 能用 fontkit 3（見檔案開頭註解）
  geom.js           共用幾何／字體常數，無 DOM 相依，可單獨測試
vendor/             所有第三方程式庫，見 vendor/VENDOR.md
test/               見 test/README.md
```

沒有 build step、沒有 npm 相依、沒有 CDN。clone 下來用任何靜態伺服器開即可。

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
insert text, and batch-apply page numbers / footers / watermarks. Files never
leave your device — no backend, works offline.

Read the 已知限制 section above before relying on it. The short version: the
"edit text" tool **covers and retypes**; the original text is still inside the
PDF and still extractable, so this is **not a redaction tool**. Replacement
glyphs come from standard fonts or Noto Sans TC, not the document's own
embedded face.

## 授權

程式碼 MIT。`vendor/` 內各程式庫維持原授權（pdf.js、pdf-lib、fontkit 皆為
Apache-2.0 / MIT），Noto Sans TC 為 SIL Open Font License 1.1。
