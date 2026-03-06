# QuickBooks + Wayl backend

Node.js **API-only** backend that connects your Intuit Developer app to **QuickBooks** (via `node-quickbooks` and `intuit-oauth`) and **Wayl** (`api.thewayl.com`) so users can send payment links in their invoices.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   Copy `.env.example` to `.env` and set:

   - **Intuit** (from [developer.intuit.com](https://developer.intuit.com) → your app → Keys & OAuth):
     - `INTUIT_CLIENT_ID`
     - `INTUIT_CLIENT_SECRET`
     - `INTUIT_REDIRECT_URI` — must match the redirect URL in the Intuit app (e.g. `http://localhost:8000/callback`)
     - `INTUIT_ENVIRONMENT` — `sandbox` or `production`

   - **Wayl** ([api.thewayl.com/reference](https://api.thewayl.com/reference)):
     - `WAYL_API_BASE` — `https://api.thewayl.com` (optional)
     - Merchants provide their **own Wayl API key** via **POST /api/settings/wayl** (body: `{ realmId, apiKey }`). Get the key from the Wayl merchant dashboard.
     - Optional server-wide: `WAYL_WEBHOOK_URL`, `WAYL_WEBHOOK_SECRET`, `WAYL_REDIRECTION_URL` for new links

3. **Run**

   ```bash
   npm start
   ```

   Or with auto-reload:

   ```bash
   npm run dev
   ```

## OAuth (intuit-oauth)

- **Connect QuickBooks:** open `GET /auth`. User is redirected to Intuit, then back to `/callback`. Tokens are stored in memory by `realmId`.
- **Callback URL** in your Intuit app must match `INTUIT_REDIRECT_URI` exactly (e.g. `http://localhost:8000/callback`).

## API

- **GET /api/invoices?realmId=...** — List invoices for the connected company.
- **GET /api/invoices/:id?realmId=...** — Get one invoice.
- **GET /api/settings/wayl?realmId=...** — Check if the merchant has set a Wayl API key (`{ configured: true|false }`; never returns the key).
- **POST /api/settings/wayl** — Store the merchant’s Wayl API key. Body: `{ realmId, apiKey }`. Query `?verify=true` to verify the key with Wayl before saving. Send empty `apiKey` to clear.
- **POST /api/invoices/:id/payment-link** — Create a Wayl payment link for the invoice (uses the merchant’s stored Wayl key).  
  Body or query: `realmId`. Optional body: `totalIQD` (use when the invoice is not in IQD; Wayl only supports IQD, min 1000).  
  Response includes `paymentLink` (URL), `referenceId`, and Wayl response. Line items are sent to Wayl when the invoice has lines that sum to the total.
- **GET /api/wayl/verify** — Verify a Wayl API key. Query `?realmId=...` to verify the stored key for that merchant; omit to use a global key from env (if set).
- **GET /api/intuit/urls** — Returns the URLs to configure in the Intuit Developer portal (see below).

All invoice endpoints require the company to be connected (user has completed `/auth` and we have tokens for that `realmId`).

## Intuit Developer portal URLs

In your app’s **Keys & OAuth** (or App URLs) section, set:

| Field | Description | Example |
|-------|-------------|---------|
| **Host domain** | Customer-facing domain, no `https://` | `myapp.com` or `localhost:8000` |
| **Launch URL** | Where users go after authenticating | `https://myapp.com/app` |
| **Disconnect URL** | Where users go when disconnecting | `https://myapp.com/disconnected` |
| **Connect/Reconnect URL** | Where users go to connect or reconnect | `https://myapp.com/auth` |

Set `APP_BASE_URL` in `.env` to your public base URL (e.g. `https://myapp.com`). Then **GET /api/intuit/urls** returns the exact values to paste into the Intuit Developer portal.

## QuickBooks webhooks (new invoices, etc.)

To have Intuit notify your backend when merchants create or update invoices (or other entities):

1. **Webhook URL** — In [developer.intuit.com](https://developer.intuit.com) → your app → **Webhooks**, set the endpoint to your **backend** base URL + `/api/webhook/intuit`:
   - **Production:** `https://web-14387-3febee06-albhe8gy.onporter.run/api/webhook/intuit` (replace with your own backend URL if different).
   - **Local:** `https://your-ngrok-url.ngrok.io/api/webhook/intuit` (Intuit must reach your machine; localhost is not enough).

2. **Verifier token** — On the same Webhooks page, copy the **Verifier Token**. In your backend environment (e.g. Porter), set:
   - `INTUIT_WEBHOOK_VERIFIER_TOKEN` (or `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`) to that value.  
   The backend uses it to verify the `intuit-signature` header on each POST so only Intuit can trigger the handler.

3. **Subscribe to events** — In the portal, enable the events you care about (e.g. **Invoice** created/updated). Save.

The backend logs incoming webhook payloads and Invoice events; you can extend `src/routes/webhook-intuit.js` to enqueue jobs or call your own logic when an invoice is created or updated.

## Frontend (QuickBooks users)

The app includes a small frontend (Wayl-styled) that QuickBooks users see when they launch the app:

- **/** and **/app** — Main app: connect QuickBooks, add Wayl API key, list invoices, create payment links. Uses `realmId` from the URL (set after OAuth callback).
- **/disconnected** — Shown when the user has disconnected; link to connect again.

Static files are in `public/` (HTML, CSS, JS). After connecting via **/auth**, users are redirected to **/app?realmId=...** so the app can call the API with their company id.

## Wayl integration

`src/wayl.js` uses the [Wayl API](https://api.thewayl.com/reference): **POST /api/v1/links** to create payment links, with **X-WAYL-AUTHENTICATION** for auth. Amounts are in **IQD** (minimum 1000). The module also exposes `verifyAuth()`, `getLink(referenceId)`, and `invalidateLink(referenceId)`. Use `waylRequest(method, path, body)` for other endpoints (channels, products, refunds, etc.).

## Token storage

Tokens are stored **in memory** in `src/store.js`. For production, replace this with a database or Redis keyed by `realmId`.
