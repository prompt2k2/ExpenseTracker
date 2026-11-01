# Spend Log

A free, private expense tracker that logs spending against a monthly budget and shows what is left to spend.
It runs in the browser, works offline and installs on a phone. There is no account, no server and no build step.

## What it does

- **Left to spend**: day-to-day caps minus day-to-day spending, with a daily and weekly allowance for the rest of the month.
- **Per-category caps**: each category shows spent, cap and what is left. A thin line marks where an even spend would be today.
- **Fixed bills**: kept out of left to spend. Tap **Mark paid** when a bill goes out.
- **Safety margin** (optional): income, less savings, less every cap. Overspending a category reduces it.
- **Receipt scanning**: take a photo and the total, date and shop are read on the device (Tesseract.js). Check them before saving. Photos are not kept.
- **Category guessing**: it remembers what you chose for each shop and guesses new shops from the name.
- **Card rule** (optional): warns when a card is used for a category it should not be used for.
- **Advice**: warns when a category is over or heading over (compared with what you usually spend by this day), flags shops you are spending more at than usual, and after 2 to 3 months suggests raising a cap that keeps going over or lowering one that stays well under. Rules are in `advice.js`; nothing leaves the device.
- **Reports**: month (budget, spent and left per category, by card, top shops) and year to date (chart, category totals, category-by-month CSV).
- **Google Drive sync** (optional): keeps a copy in one Drive file and merges across devices.
- **Month tools**: **Copy totals** gives one number per category, in order, to paste into a spreadsheet column. **Export CSV** saves the month's entries.

## Using it

1. Open the site. On first run Setup opens with starter categories.
2. Change the categories and caps, or paste a saved setup (JSON) under **Paste a setup**.
3. Add it to your home screen (Safari: Share → Add to Home Screen; Chrome: Install app).
4. Download a backup from Setup now and then. Data lives only in this browser on this device.

Setup JSON format:

```json
{"income": 2000, "savings": 300,
 "categories": [{"n": "Rent", "cap": 700, "fixed": true}, {"n": "Groceries", "cap": 400}],
 "methods": ["Debit card", "Credit card", "Cash"],
 "cardRule": {"card": "Credit card", "allow": ["Groceries"], "text": "Credit card is for groceries only."}}
```

Do not commit your personal setup or backups to this public repo. `.gitignore` excludes the usual file names.

## Hosting on GitHub Pages

Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`. All paths are relative, so it works under `https://<user>.github.io/<repo>/`.

**On every release, change `VERSION` in `sw.js`**, or installed copies keep the old files.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Page and styles (light and dark) |
| `app.js` | App logic. Storage keys `spendlog.items.v1`, `spendlog.config.v1`. Money is integer pence. |
| `advice.js` | Spending advice rules. Also loads in Node for tests. |
| `sync.js` | Google Drive sync and merge |
| `parse.js` | Receipt text → total, date, shop. Also loads in Node for tests. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and install |
| `vendor/tesseract/` | Self-hosted Tesseract.js 5.1.1, LSTM cores and English `best_int` data (Apache-2.0) |

## Tests

```
npm install
npm test        # parser unit tests (Node only)
npm run e2e     # browser test with installed Edge; BROWSER_CHANNEL=chrome or "" to change
```
