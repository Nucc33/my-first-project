# Wallet Tracker

A live dashboard showing every **buy** (and sell) from the traders you follow, read straight from the blockchain. It covers Solana, Base and BNB Chain.

- It runs on your own computer and opens in your browser at `http://localhost:3000`.
- It plays a sound when a trader you care about buys something over your minimum size.
- It is **read-only**. It never asks for, stores or uses private keys or seed phrases. The API keys below only let it *read* public blockchain data.

---

## One-time setup (about 15 minutes)

### Step 1: Install Node.js

1. Go to **https://nodejs.org** and download the **LTS** version (22 or newer).
2. Open the installer and click through with the default options.

### Step 2: Download this tracker

1. Open **https://github.com/nucc33/my-first-project**.
2. Switch to the branch **`claude/adoring-ritchie-kfdqym`** using the branch dropdown near the top left.
3. Click the green **Code** button, then **Download ZIP**.
4. Unzip it and move the folder somewhere easy to find, like your Desktop or Documents.

### Step 3: Get your free API keys

In the tracker folder, make a copy of the file **`.env.example`** and name the copy **`.env`**. Open `.env` with TextEdit (Mac) or Notepad (Windows). You'll paste each key after its `=` sign, with no spaces.

> **Mac tip:** Files starting with a dot are hidden in Finder. Press **Cmd + Shift + .** to show them.
> **Mac TextEdit:** Choose Format → *Make Plain Text* before saving.

**a) Helius (Solana), required**
1. Go to **https://dashboard.helius.dev** and sign up. Email or Google login is fine, and the free plan needs no card.
2. On the dashboard, open **API Keys** and copy your key. It looks like `a1b2c3d4-....`.
3. Paste it into `.env`: `HELIUS_API_KEY=a1b2c3d4-....`

**b) Alchemy (Base + BNB Chain), optional, one key covers both**
1. Go to **https://dashboard.alchemy.com** and sign up on the free plan.
2. Click **Create new app**. Give it any name, then under networks tick **Base Mainnet** and **BNB Smart Chain Mainnet**.
3. Open the app and copy the **API Key**.
4. Paste it into `.env`: `ALCHEMY_API_KEY=....`

**c) FomoScan (turns Fomo usernames into wallet addresses), free credits**
1. Go to **https://www.fomoscan.sh** and sign up. New accounts start with 25,000 free credits.
2. Find the **API** / **API keys** section and create a key.
3. Paste it into `.env`: `FOMOSCAN_API_KEY=....`

**d) FomoLens (optional, paid alternative)**

**FomoLens (turns Fomo usernames into wallet addresses), paid**
FomoLens's API is **not free**. Signing up gives no credits; you need a paid plan (paid in USDC on Solana) or a trial they approve by hand. A found wallet costs 10 credits and a miss costs 1, so all 75 traders cost at most ~750 credits, once.
1. Go to **https://fomolens.app**, sign up, and get a plan or trial.
2. Open **Dashboard → API keys** and create a key. A real key starts with `fl_live_` followed by 43 letters/numbers.
3. Paste it into `.env`: `FOMOLENS_API_KEY=fl_live_....`
4. *Optional backup:* a key from **https://getfomoapi.fun** goes in `FOMOAPI_KEY=....`.

No paid key? Skip this. You can paste addresses in by hand on the dashboard's Wallets page instead.

Save the `.env` file.

### Step 4: Look up your traders' wallets

Open a terminal in the tracker folder:
- **Mac:** Right-click the folder in Finder and choose **Services → New Terminal at Folder**. Or open Terminal, type `cd `, drag the folder into the window and press Enter.
- **Windows:** Open the folder, click the address bar, type `cmd` and press Enter.

Then run:

```
npm run resolve
```

It goes through all 75 usernames slowly (about 8 minutes, to stay inside FomoLens's trial limit of 10 lookups a minute) and prints what it found. Anyone it can't find is listed at the end and marked **NOT FOUND** on the dashboard's Wallets page. You can also run the lookup later from the dashboard with **Look up wallets from Fomo**.

---

## Start it (every time)

In the terminal inside the tracker folder, type:

```
npm start
```

Then open **http://localhost:3000** in your browser. **Click once anywhere on the page** so the browser allows sound.

Shortcuts, if you prefer double-clicking:
- **Mac:** Double-click `start.command`. The first time, right-click it and choose **Open**, because macOS blocks downloaded scripts. If it says it isn't executable, run `chmod +x start.command` once in Terminal.
- **Windows:** Double-click `start.bat`.

Both shortcuts open the dashboard for you.

### Keeping it running while you trade

- **Leave the terminal window open.** You can minimise it, but closing it stops the tracker. To stop it on purpose, press **Ctrl + C** in that window.
- **Don't let the computer sleep.**
  - **Mac:** `start.command` already keeps the Mac awake while it runs. If you use `npm start` instead, run `caffeinate -i npm start`.
  - **Windows:** In Settings → System → Power, set "Sleep" to *Never* while plugged in.
- **The browser tab can be in the background.** Sounds still play and the tab title shows `(3) Wallet Tracker` for unseen buys. You can also turn on desktop pop-ups under Wallets → Alerts.
- **If your internet drops, the tracker reconnects by itself.** Every 10 minutes it also double-checks for anything it missed.
- **Your feed, settings and wallet list are saved.** Restarting keeps everything.

---

## Using the dashboard

**Feed page**
- **Buys / Sells / All:** Buys is the default view. Sells have a red edge.
- **Chain filter and search:** Filter by chain, or search by trader or token name.
- **Each row:** Shows the trader (with Top 1 / Top 3 / Top 100 badge), the token name, ticker and market cap, and the amount spent in USD and in SOL/ETH/BNB. It also shows how long ago it happened, the chain, and **Chart** (Dexscreener) and **Tx** (Solscan/Basescan/BscScan) links.
- **"Sound only for buys over $…":** Buys below this amount stay silent. Tick *Hide smaller buys* to hide them completely.
- **"≈" before a dollar amount:** The dollar value was estimated from the token price, for example when a trader paid with another token.

**Wallets page**
- **Sound switch:** Turns sound on or off per trader. By default it's on for your Top 1/3/100 traders and off for the rest. Top 1 and Top 3 buys play a longer, higher chime.
- **Adding a trader:** Use the **Add a trader** form. A trader's Base and BNB address is the same `0x...` address.
- **Edit / Remove:** Change a trader's addresses or remove them from the list.
- **Status column:** Found / Added by you / NOT FOUND / Not looked up.

Your list is also saved in `wallets.json`, which you can edit by hand while the tracker is stopped.

---

## Free-tier limits (you shouldn't hit them)

| Service | Used for | Free allowance |
|---|---|---|
| Helius | Solana live feed + transaction details | 1M credits/month. Live listening is free; each trade costs ~1 credit, and the 10-minute safety check costs about 300k/month for 75 wallets. |
| Alchemy | Base + BNB live feed | Generous monthly compute units, more than enough for this. |
| Dexscreener | Token names, prices, charts | Free, no key. |
| FomoLens | Username → wallet lookup | Only used when you run a lookup. |

If you ever get close to the Helius limit, set `SAFETY_POLL_MINUTES=30` in `.env`.

## Troubleshooting

- **"Port 3000 is already in use":** The tracker is already running in another window, so just open http://localhost:3000.
- **A chain shows "off" in the top right:** That chain's key is missing from `.env`. Add it and restart.
- **A chain shows "error" or stays "connecting":** Hover over it for details. Usually the key is wrong or has a typo.
- **No sound:** Click once on the page. Also check the 🔔 button, that trader's Sound switch, and your minimum buy size.
- **The resolver says the key was rejected:** Check the key in `.env`. FomoScan, FomoLens and getfomoapi.fun are unofficial services not run by Fomo. Only the username is sent to them.

## For the curious

`src/solana.js` and `src/evm.js` listen for any transaction touching your wallets. They read what went in and out of the wallet and call it a **buy** when the wallet received a token and paid SOL/ETH/BNB, a stablecoin or another token. Plain transfers and airdrops are ignored. Run `npm test` to check the parsing logic.
