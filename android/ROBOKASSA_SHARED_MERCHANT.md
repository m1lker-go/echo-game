# ECHO payments through the EXISTING Cat Fighting Robokassa merchant

**Staged on branch `apk`. No second Robokassa store, account or merchant ID is required.**

## How it works

1. ECHO server creates an authenticated order for one premium pack (250.00 RUB), sets an invoice ID in a reserved numeric range and signs its checkout link with the **same Cat Fighting Robokassa Password #1** plus the fixed `Shp_type=echo_premium_pack` marker.
2. The Robokassa cabinet retains its **existing Cat Fighting ResultURL**. We do not change its settings.
3. A minimal relay added to `m1lker-go/fight-club` branch `echo-robokassa-relay` recognizes `Shp_type=echo_premium_pack`. It verifies the same Password #2 signature, validates the amount and forwards the receipt to ECHO's endpoint. All other Cat Fighting order types go to their original unchanged handler.
4. ECHO independently checks that signature, the amount, invoice, its own pending order and mode. It issues five premium-pack cards into `echo_hero_collection` and increments pack quest progress **in one transaction**. Duplicate callbacks are acknowledged without double-granting.
5. The APK keeps the Shop alive behind an in-app Robokassa payment WebView, polls the account-scoped order status and plays the existing premium-pack opening animation after confirmation.

## Server configuration

Use the existing Cat Fighting merchant identifier and passwords, but make their values available to the **ECHO server process** as environment variables (the ECHO process cannot automatically read Cat Fighting's ENV):

```dotenv
MERCHANT_LOGIN=<same existing Cat Fighting Robokassa MerchantLogin>
PASSWORD1=<same existing Cat Fighting Robokassa password 1>
PASSWORD2=<same existing Cat Fighting Robokassa password 2>
IS_TEST=false
```

`IS_TEST=false` corresponds to real payments as in Cat Fighting. Keep `IS_TEST=true` during verification. Optional `ECHO_ROBO_*` override names remain supported but are not required. **Never put these values into GitHub, Android variables, APK or client JS.**

## Deployment order (important)

1. Deploy ECHO server changes from `echo-game` branch `apk` to its server process, including its `server/index.js` router and `server/robokassa-payments.js`, and configure the shared merchant ENV. Run `node --test` for ECHO server. Confirm its `GET /echo/api/payments/robokassa/` health endpoint. No money will be charged merely by deploying its routes.
2. Merge and deploy **only the reviewed callback relay** from `fight-club` branch `echo-robokassa-relay` to Cat Fighting. This is a separate repository and is **not deployed** merely by editing its branch.
3. Deploy the adjusted `client/pack-animation.js` from ECHO `apk` to the actual served ECHO website when ready. The app currently fetches website JS from `cat-fight.ru/echo`, so Git Pull/APK rebuild **alone** cannot deploy this checkout code.
4. Create a test invoice and complete a verification transaction, checking `echo_robokassa_orders.status='paid'`, the five granted cards, unchanged Cat Fighting purchases and no duplicate grants on callback retries. After review, enable real payments using the existing live credentials and `IS_TEST=false`.

## ECHO API paths

- `POST /echo/api/payments/robokassa/create` — authenticated, fixed 250 RUB, checkout URL.
- `GET /echo/api/payments/robokassa/status/:invoiceId` — authenticated, owner-bound status.
- `POST /echo/api/payments/robokassa/result` — signed notification **only through Cat Fighting's relay**, returns `OK{InvId}`.
- Return/help pages `/echo/api/payments/robokassa/return` and `/fail` do **not** grant rewards.

## Safety

One ECHO premium product only; no client-supplied amount, login, userId or cards. Fixed signed game marker, independent server verification, transactional idempotent grant. Cat Fighting's existing `ResultURL`, receipt settings, payments and database remain unchanged until the relay branch is deliberately merged.

Note: this is a technical routing solution using one merchant. Check your existing Robokassa terms and fiscal/receipt settings for selling ECHO digital goods as an additional sales channel. Robokassa's `ResultUrl2` is another documented option, but that is a **JWS** notification requiring its own verification; this solution intentionally reuses the existing signed ResultURL instead.
