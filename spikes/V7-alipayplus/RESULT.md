# V7: ant-intl-alipayplus-mcp (exact HTTP paths and signing)

Run 2026-10-17 03:55 to 04:00 UTC. Source read from the PyPI sdist `ant_intl_alipayplus_mcp-1.0.1` (MIT, latest; also 1.0.0), unpacked in `spikes/V7-alipayplus/downloads/` (git-ignored). Reproduce with `spikes/V7-alipayplus/run.sh`.

## What the server is

- Console script `ant-intl-alipayplus-mcp` = `alipayplusmcp.main:main_cli`, FastMCP server named `alipayplus-mcp`, **stdio** transport only. Python >= 3.11; deps `cryptography==44.0.3`, `mcp[cli]>=1.11.1` (unpinned), `pycryptodome==3.22.0`, `rsa>=4.9.1`.
- Env vars read (default in brackets): `GATEWAY_URL` [https://open-sea-global.alipayplus.com], `CLIENT_ID` (required), `MERCHANT_PRIVATE_KEY` (required), `ALIPAY_PUBLIC_KEY` (required), `PAYMENT_REDIRECT_URL` [""], `PAYMENT_NOTIFY_URL` [http://localhost:8080/notify], `SETTLEMENT_CURRENCY` [""], `MERCHANT_NAME` [Alipayplus MCP], `MERCHANT_ID` [M0000000001], `MERCHANT_MCC` [5411], `MERCHANT_REGION` [CN]. A `CLIENT_ID` starting with `SANDBOX_` sets a sandbox flag that is never used afterwards.

## Tools (name: parameters) and HTTP path (POST, relative to GATEWAY_URL)

| Tool | Parameters | Path |
|---|---|---|
| `create_payment` | `payment_request_id: str, order_amount_currency: str, order_amount_value: int` (minor units), `order_description: str` | `/aps/api/v1/payments/pay` |
| `query_payment` | `payment_request_id: str` | `/aps/api/v1/payments/inquiryPayment` |
| `cancel_payment` | `payment_request_id: str` | `/aps/api/v1/payments/cancelPayment` |
| `create_refund` | `payment_request_id, refund_request_id: str, refund_amount_value: int, refund_currency: str` | `/aps/api/v1/payments/refund` |
| `customs_declare` | `payment_request_id, customs_declaration_request_id: str, declaration_amount_value: int, customs_code, merchant_customs_code, merchant_customs_name: str, is_split: bool, reference_order_id: str` | `/aps/api/v1/customs/declare` |
| `query_customs_declare` | `declaration_request_ids: list[str]` (max 10) | `/aps/api/v1/customs/inquireDeclarationRequests` |

Also defined but not exposed as tools: `/aps/api/v1/disputes/responseRetrieval`, `/aps/api/v1/disputes/responseEscalation`.

`create_payment` body: `paymentRequestId`, `paymentAmount {currency, value}`, `order {referenceOrderId = paymentRequestId, orderDescription, orderAmount, merchant {referenceMerchantId, merchantName, merchantDisplayName, merchantMCC, merchantAddress {region}}, buyer {referenceBuyerId = random uuid}, env {terminalType: WAP, osType: IOS}}`, `paymentFactor {isInStorePayment: false, isCashierPayment: true, presentmentMode: UNIFIED}`, `paymentRedirectUrl`, `paymentNotifyUrl`, `settlementStrategy {settlementCurrency}`, `paymentMethod {paymentMethodType: CONNECT_WALLET}` (JSON indented by 3).

## Signing (both directions)

- String to sign: `"POST " + path + "\n" + clientId + "." + time + "." + body` (UTF-8). `time` = ISO 8601 (`Request-Time` header on requests, `response-time` on responses).
- Algorithm: RSA PKCS#1 v1.5 with SHA-256, signature base64 then **URL-encoded** (`quote_plus`).
- Request headers: `Content-type: application/json; charset=UTF-8`, `Request-Time`, `client-id`, `Signature: algorithm=RSA256,keyVersion=1,signature=<urlencoded b64>`.
- Response: the client **requires** headers named exactly `signature` (value containing `signature=<urlencoded b64>`), `response-time` and `client-id` (lowercase, exact match on the names as sent), else it raises; it verifies the signature with `ALIPAY_PUBLIC_KEY` over the same string format with the response time and raw body. A wrong gateway key gives `response verify failed. Verification failed`.
- Key formats: `MERCHANT_PRIVATE_KEY` = base64 DER without PEM headers; the code wraps it in a `RSA PRIVATE KEY` label, but `cryptography` loads both **PKCS#1 and PKCS#8** content (both tested). `ALIPAY_PUBLIC_KEY` = base64 **SPKI** DER (wrapped as `PUBLIC KEY`). So our `.env` format (PKCS#8 private, SPKI public, base64 DER) works as is.

## Round trip seen (fake gateway `gateway.py`, real MCP server, MCP stdio client `client.py`)

```
tools: ['create_payment', 'query_payment', 'cancel_payment', 'create_refund', 'customs_declare', 'query_customs_declare']
create_payment -> {"result": {"resultCode": "PAYMENT_IN_PROCESS", "resultStatus": "U", ...}, "paymentId": "b4fe...", "paymentRequestId": "praetor-pay-0001"}
query_payment  -> {"result": {"resultCode": "SUCCESS", "resultStatus": "S", ...}, "paymentStatus": "SUCCESS", "paymentAmount": {"currency": "USD", "value": 120000}, ...}
gateway: /aps/api/v1/payments/pay verified merchant signature, answered PAYMENT_IN_PROCESS
gateway: /aps/api/v1/payments/inquiryPayment verified merchant signature, answered SUCCESS
```

## Verdict

**PASS** (the real MCP client runs against our mock; no fallback). Pins: `ant-intl-alipayplus-mcp==1.0.1` with `mcp[cli]==1.29.1` forced on the server side, client `mcp==1.29.1`, image `ghcr.io/astral-sh/uv:python3.12-bookworm-slim` (digest `sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58`, uv 0.9.30).

## Traps (for QUESTIONS.md)

1. **HTTPS on port 443 is hard-coded**: `do_post` always opens `HTTPSConnection(host, 443)` with certificate checks disabled, ignoring the scheme and port of `GATEWAY_URL`, and sends the absolute URL as the request target. Default: `alipayplus-mock` listens on 443 inside the Docker network with a self-signed cert (container port only, never published), parses the absolute URL, and `GATEWAY_URL=https://alipayplus-mock`.
2. **Unpinned `mcp` breaks the server**: `uvx ant-intl-alipayplus-mcp` today resolves a recent `mcp` + `pydantic 2.14` and crashes at import (`cannot import name 'eval_type_backport'`). Default: payout-partner launches it as `uvx --from ant-intl-alipayplus-mcp==1.0.1 --with 'mcp[cli]==1.29.1' ant-intl-alipayplus-mcp`, baked into the payout-partner image (no network at runtime).
3. Missing env vars make the server print warnings **to stdout**, which corrupts the stdio MCP stream. Default: payout-partner sets every one of the 11 variables.
4. Tool failures come back as a plain text result (e.g. `response verify failed...`), not as an MCP error, and a failed response verification does not mean the gateway did not act. Default: payout-partner parses the JSON, treats non-JSON as "unknown outcome" and resolves it with `query_payment` before calling `fail(id)` on the rail.
5. Response headers must be emitted in lowercase (`signature`, `response-time`, `client-id`). Default: the mock writes them exactly so; a contract test in alipayplus-mock pins it.
