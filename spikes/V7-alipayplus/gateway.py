# V7 fake Alipay+ gateway: just enough of the ACQP API for ant-intl-alipayplus-mcp 1.0.1.
# The MCP client always speaks HTTPS to port 443 (it ignores the URL's scheme and port) and sends the
# absolute URL as the request target, so this listens on 443 with any certificate and parses the path.
import base64, json, os, ssl, sys, urllib.parse, uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

load_der = lambda b64: base64.b64decode(b64)
gw_priv = serialization.load_der_private_key(load_der(os.environ["GATEWAY_PRIVATE_KEY"]), None)
merchant_pub = serialization.load_der_public_key(load_der(os.environ["MERCHANT_PUBLIC_KEY"]))
payments = {}

def content(method, path, client_id, t, body):
    return f"{method} {path}\n{client_id}.{t}.{body}".encode()

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        body = self.rfile.read(int(self.headers["Content-Length"])).decode()
        client_id, t = self.headers["client-id"], self.headers["Request-Time"]
        sig = urllib.parse.unquote_plus(self.headers["Signature"].split("signature=")[1])
        merchant_pub.verify(base64.b64decode(sig), content("POST", path, client_id, t, body), padding.PKCS1v15(), hashes.SHA256())
        req = json.loads(body)
        rid = req.get("paymentRequestId")
        if path.endswith("/payments/pay"):
            payments[rid] = {"paymentId": uuid.uuid4().hex, "amount": req["paymentAmount"]}
            out = {"result": {"resultCode": "PAYMENT_IN_PROCESS", "resultStatus": "U", "resultMessage": "payment in process"},
                   "paymentId": payments[rid]["paymentId"], "paymentRequestId": rid}
        elif path.endswith("/payments/inquiryPayment"):
            p = payments.get(rid)
            out = ({"result": {"resultCode": "SUCCESS", "resultStatus": "S", "resultMessage": "success"},
                    "paymentStatus": "SUCCESS", "paymentRequestId": rid, "paymentId": p["paymentId"], "paymentAmount": p["amount"],
                    "paymentTime": datetime.now(timezone.utc).isoformat(timespec="seconds")}
                   if p else {"result": {"resultCode": "ORDER_NOT_EXIST", "resultStatus": "F", "resultMessage": "order not exist"}})
        else:
            out = {"result": {"resultCode": "UNKNOWN_EXCEPTION", "resultStatus": "U", "resultMessage": f"not mocked: {path}"}}
        rsp = json.dumps(out)
        rt = datetime.now(timezone.utc).isoformat(timespec="seconds")
        rsig = urllib.parse.quote_plus(base64.b64encode(gw_priv.sign(content("POST", path, client_id, rt, rsp), padding.PKCS1v15(), hashes.SHA256())).decode())
        print(f"gateway: {path} verified merchant signature, answered {out['result']['resultCode']}", file=sys.stderr, flush=True)
        self.send_response(200)
        # The client matches these header names exactly in lowercase.
        self.send_header("signature", f"algorithm=RSA256,keyVersion=1,signature={rsig}")
        self.send_header("response-time", rt)
        self.send_header("client-id", client_id)
        self.send_header("Content-Type", "application/json; charset=UTF-8")
        self.send_header("Content-Length", str(len(rsp.encode())))
        self.end_headers()
        self.wfile.write(rsp.encode())

srv = HTTPServer(("0.0.0.0", 443), H)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain("/certs/cert.pem", "/certs/key.pem")
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
srv.serve_forever()
