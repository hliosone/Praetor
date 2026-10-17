# V7 MCP stdio client: starts ant-intl-alipayplus-mcp 1.0.1 and runs create_payment then query_payment.
import asyncio, json, os, sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Every variable is set: the server prints a warning to stdout for each missing one, which corrupts stdio.
env = {**os.environ,
       "GATEWAY_URL": "https://alipayplus-mock", "CLIENT_ID": "SANDBOX_PRAETOR_TEST",
       "MERCHANT_PRIVATE_KEY": os.environ["MERCHANT_PRIVATE_KEY"], "ALIPAY_PUBLIC_KEY": os.environ["GATEWAY_PUBLIC_KEY"],
       "PAYMENT_REDIRECT_URL": "https://praetor.localhost/", "PAYMENT_NOTIFY_URL": "https://praetor.localhost/notify",
       "SETTLEMENT_CURRENCY": "USD", "MERCHANT_NAME": "Kowloon Lettings (mock)", "MERCHANT_ID": "M0000000042",
       "MERCHANT_MCC": "6513", "MERCHANT_REGION": "HK"}
server = StdioServerParameters(command=sys.argv[1], args=sys.argv[2:], env=env)

async def main():
    async with stdio_client(server) as (r, w), ClientSession(r, w) as s:
        await s.initialize()
        tools = await s.list_tools()
        print("tools:", [t.name for t in tools.tools])
        rid = "praetor-pay-0001"
        for name, args in [("create_payment", {"payment_request_id": rid, "order_amount_currency": "USD", "order_amount_value": 120000, "order_description": "rent"}),
                           ("query_payment", {"payment_request_id": rid})]:
            res = await s.call_tool(name, args)
            print(f"{name} ->", res.content[0].text)

asyncio.run(main())
