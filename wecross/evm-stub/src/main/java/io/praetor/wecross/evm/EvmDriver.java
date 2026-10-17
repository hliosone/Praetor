package io.praetor.wecross.evm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.webank.wecross.stub.Account;
import com.webank.wecross.stub.Block;
import com.webank.wecross.stub.BlockHeader;
import com.webank.wecross.stub.BlockManager;
import com.webank.wecross.stub.Connection;
import com.webank.wecross.stub.Driver;
import com.webank.wecross.stub.Path;
import com.webank.wecross.stub.Request;
import com.webank.wecross.stub.ResourceInfo;
import com.webank.wecross.stub.Response;
import com.webank.wecross.stub.StubConstant;
import com.webank.wecross.stub.Transaction;
import com.webank.wecross.stub.TransactionContext;
import com.webank.wecross.stub.TransactionException;
import com.webank.wecross.stub.TransactionRequest;
import com.webank.wecross.stub.TransactionResponse;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.apache.commons.lang3.tuple.ImmutablePair;

/**
 * Router calls on Base. Business resources follow WeCross's {@code string[] f(string[])} convention; with
 * {@code byProxy} they go through WeCrossProxy.sendTransaction / constantCall (the router's normal path), raw calls
 * reach the resource itself, and the proxy's getXATransactionState(string) is answered by the proxy contract.
 * Transactions are simulated first (Base receipts carry no return value), then signed (legacy, EIP-155), sent and
 * awaited. One sender thread, so the account's nonces never race.
 */
public final class EvmDriver implements Driver {
    public static final String PROXY = StubConstant.PROXY_NAME;
    static final int OK = 0;
    static final int CALL_REVERTED = 1;
    static final int TX_FAILED = 2;

    private final ObjectMapper json = new ObjectMapper();
    private final ExecutorService sender = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "praetor-evm-sender"); t.setDaemon(true); return t; });
    private final ExecutorService reader = Executors.newFixedThreadPool(4, r -> { Thread t = new Thread(r, "praetor-evm-reader"); t.setDaemon(true); return t; });
    private final long receiptTimeoutMs;
    private final long pollMs;

    public EvmDriver() {
        this(120_000, 1_000);
    }

    EvmDriver(long receiptTimeoutMs, long pollMs) {
        this.receiptTimeoutMs = receiptTimeoutMs;
        this.pollMs = pollMs;
    }

    // ------------------------------------------------------------------ JSON-RPC

    JsonNode rpc(Connection c, String method, Object... params) throws Exception {
        ObjectNode body = json.createObjectNode();
        body.put("jsonrpc", "2.0");
        body.put("id", 1);
        body.put("method", method);
        ArrayNode ps = body.putArray("params");
        for (Object p : params) ps.add(json.valueToTree(p));
        CompletableFuture<Response> f = new CompletableFuture<>();
        Request req = new Request();
        req.setType(EvmConnection.JSON_RPC);
        req.setData(json.writeValueAsBytes(body));
        c.asyncSend(req, f::complete);
        Response r = f.get(90, TimeUnit.SECONDS);
        if (r.getErrorCode() != 0) throw new IllegalStateException(method + ": " + r.getErrorMessage());
        JsonNode out = json.readTree(r.getData());
        if (out.has("error")) throw new RpcError(method, out.get("error"));
        return out.get("result");
    }

    static final class RpcError extends Exception {
        RpcError(String method, JsonNode error) {
            super(method + ": " + error.path("message").asText() + (error.has("data") ? " " + error.get("data").asText() : ""));
        }
    }

    private static BigInteger quantity(JsonNode n) {
        return new BigInteger(n.asText().substring(2), 16);
    }

    private static String q(BigInteger v) {
        return "0x" + v.toString(16);
    }

    private static EvmConfig config(Connection c) {
        if (!(c instanceof EvmConnection)) throw new IllegalArgumentException("not an EVM connection");
        return ((EvmConnection) c).config();
    }

    // ------------------------------------------------------------------ calls and transactions

    /** The target address and calldata of a router request, and how to read its return value. */
    static final class Plan {
        final String to;
        final byte[] data;
        final boolean viaProxy;
        final boolean returnsString;

        Plan(String to, byte[] data, boolean viaProxy, boolean returnsString) {
            this.to = to;
            this.data = data;
            this.viaProxy = viaProxy;
            this.returnsString = returnsString;
        }

        String[] result(byte[] ret) {
            if (ret.length == 0) return new String[0];
            if (returnsString) return new String[] {Abi.decodeString(ret)};
            return Abi.decodeStringArray(viaProxy ? Abi.decodeBytes(ret) : ret);
        }
    }

    static Plan plan(EvmConfig cfg, String resource, TransactionRequest request, boolean byProxy, boolean send) {
        String[] args = request.getArgs() == null ? new String[0] : request.getArgs();
        if (PROXY.equals(resource) && "getXATransactionState".equals(request.getMethod())) {
            return new Plan(cfg.proxy, Abi.call("getXATransactionState(string)", Abi.string(args.length > 0 ? args[0] : "")), false, true);
        }
        byte[] inner = Abi.call(request.getMethod() + "(string[])", Abi.stringArray(args));
        if (byProxy) {
            if (send) {
                Object uid = request.getOptions().get(StubConstant.TRANSACTION_UNIQUE_ID);
                String id = uid == null ? UUID.randomUUID().toString().replace("-", "") : String.valueOf(uid);
                return new Plan(cfg.proxy, Abi.call("sendTransaction(string,string,bytes)", Abi.string(id), Abi.string(resource), Abi.bytes(inner)), true, false);
            }
            return new Plan(cfg.proxy, Abi.call("constantCall(string,bytes)", Abi.string(resource), Abi.bytes(inner)), true, false);
        }
        String address = PROXY.equals(resource) ? cfg.proxy : cfg.resources.get(resource);
        if (address == null) throw new IllegalArgumentException("unknown resource " + resource);
        return new Plan(address, inner, false, false);
    }

    private byte[] ethCall(Connection c, String from, Plan p) throws Exception {
        ObjectNode tx = json.createObjectNode();
        if (from != null) tx.put("from", from);
        tx.put("to", p.to);
        tx.put("data", Hex.encode(p.data));
        return Hex.decode(rpc(c, "eth_call", tx, "latest").asText());
    }

    private static TransactionResponse response(int code, String message, String[] result) {
        TransactionResponse r = new TransactionResponse();
        r.setErrorCode(code);
        r.setMessage(message);
        r.setResult(result);
        return r;
    }

    @Override
    public void asyncCall(TransactionContext context, TransactionRequest request, boolean byProxy, Connection connection, Callback callback) {
        reader.submit(() -> {
            try {
                Plan p = plan(config(connection), context.getPath().getResource(), request, byProxy, false);
                Account a = context.getAccount();
                String[] result = p.result(ethCall(connection, a == null ? null : a.getIdentity(), p));
                callback.onTransactionResponse(null, response(OK, "Success", result));
            } catch (RpcError e) {
                callback.onTransactionResponse(null, response(CALL_REVERTED, e.getMessage(), new String[0]));
            } catch (Exception e) {
                callback.onTransactionResponse(TransactionException.Builder.newInternalException(e.getMessage()), null);
            }
        });
    }

    @Override
    public void asyncSendTransaction(TransactionContext context, TransactionRequest request, boolean byProxy, Connection connection, Callback callback) {
        sender.submit(() -> {
            try {
                if (!(context.getAccount() instanceof EvmAccount)) throw new IllegalArgumentException("no EVM account for this transaction");
                EvmAccount account = (EvmAccount) context.getAccount();
                EvmConfig cfg = config(connection);
                Plan p = plan(cfg, context.getPath().getResource(), request, byProxy, true);
                String from = account.getIdentity();
                String[] result;
                try {
                    result = p.result(ethCall(connection, from, p));
                } catch (RpcError e) {
                    callback.onTransactionResponse(null, response(CALL_REVERTED, e.getMessage(), new String[0]));
                    return;
                }
                ObjectNode est = json.createObjectNode();
                est.put("from", from);
                est.put("to", p.to);
                est.put("data", Hex.encode(p.data));
                BigInteger gas = quantity(rpc(connection, "eth_estimateGas", est)).multiply(BigInteger.valueOf(13)).divide(BigInteger.TEN).add(BigInteger.valueOf(50_000));
                BigInteger gasPrice = quantity(rpc(connection, "eth_gasPrice")).multiply(BigInteger.valueOf(12)).divide(BigInteger.TEN).add(BigInteger.ONE);
                BigInteger nonce = quantity(rpc(connection, "eth_getTransactionCount", from, "pending"));
                byte[] raw = LegacyTx.sign(account.signer(), cfg.chainId, nonce, gasPrice, gas, p.to, BigInteger.ZERO, p.data);
                String hash = rpc(connection, "eth_sendRawTransaction", Hex.encode(raw)).asText();
                JsonNode receipt = awaitReceipt(connection, hash);
                boolean ok = "0x1".equals(receipt.path("status").asText());
                TransactionResponse r = response(ok ? OK : TX_FAILED, ok ? "Success" : "transaction reverted", ok ? result : new String[0]);
                r.setHash(hash);
                r.setBlockNumber(quantity(receipt.get("blockNumber")).longValue());
                callback.onTransactionResponse(null, r);
            } catch (Exception e) {
                callback.onTransactionResponse(TransactionException.Builder.newInternalException(e.getMessage()), null);
            }
        });
    }

    private JsonNode awaitReceipt(Connection c, String hash) throws Exception {
        long until = System.currentTimeMillis() + receiptTimeoutMs;
        while (System.currentTimeMillis() < until) {
            JsonNode r = rpc(c, "eth_getTransactionReceipt", hash);
            if (r != null && !r.isNull()) return r;
            Thread.sleep(pollMs);
        }
        throw new IllegalStateException("no receipt for " + hash);
    }

    // ------------------------------------------------------------------ chain data

    @Override
    public ImmutablePair<Boolean, TransactionRequest> decodeTransactionRequest(Request request) {
        // Only HTLC routines decode requests; Praetor does not use them.
        return new ImmutablePair<>(false, null);
    }

    @Override
    public List<ResourceInfo> getResources(Connection connection) {
        return ((EvmConnection) connection).resources();
    }

    @Override
    public void asyncGetBlockNumber(Connection connection, GetBlockNumberCallback callback) {
        reader.submit(() -> {
            try {
                callback.onResponse(null, quantity(rpc(connection, "eth_blockNumber")).longValue());
            } catch (Exception e) {
                callback.onResponse(e, -1);
            }
        });
    }

    @Override
    public void asyncGetBlock(long blockNumber, boolean onlyHeader, Connection connection, GetBlockCallback callback) {
        reader.submit(() -> {
            try {
                JsonNode b = rpc(connection, "eth_getBlockByNumber", q(BigInteger.valueOf(blockNumber)), false);
                if (b == null || b.isNull()) throw new IllegalStateException("no block " + blockNumber);
                BlockHeader h = new BlockHeader();
                h.setNumber(quantity(b.get("number")).longValue());
                h.setHash(b.get("hash").asText());
                h.setPrevHash(b.get("parentHash").asText());
                h.setStateRoot(b.get("stateRoot").asText());
                h.setTransactionRoot(b.get("transactionsRoot").asText());
                h.setReceiptRoot(b.get("receiptsRoot").asText());
                h.setTimestamp(quantity(b.get("timestamp")).longValue() * 1000);
                Block block = new Block();
                block.setBlockHeader(h);
                block.setRawBytes(json.writeValueAsBytes(b));
                List<String> hashes = new ArrayList<>();
                if (!onlyHeader) for (JsonNode t : b.path("transactions")) hashes.add(t.asText());
                block.setTransactionsHashes(hashes);
                callback.onResponse(null, block);
            } catch (Exception e) {
                callback.onResponse(e, null);
            }
        });
    }

    @Override
    public void asyncGetTransaction(String transactionHash, long blockNumber, BlockManager blockManager, boolean isVerified, Connection connection, GetTransactionCallback callback) {
        reader.submit(() -> {
            try {
                JsonNode tx = rpc(connection, "eth_getTransactionByHash", transactionHash);
                JsonNode receipt = rpc(connection, "eth_getTransactionReceipt", transactionHash);
                if (tx == null || tx.isNull() || receipt == null || receipt.isNull()) throw new IllegalStateException("unknown transaction " + transactionHash);
                Transaction t = new Transaction();
                t.setTxBytes(json.writeValueAsBytes(tx));
                t.setReceiptBytes(json.writeValueAsBytes(receipt));
                t.setAccountIdentity(tx.get("from").asText());
                t.setResource(tx.path("to").asText());
                TransactionResponse r = response("0x1".equals(receipt.path("status").asText()) ? OK : TX_FAILED, "", new String[0]);
                r.setHash(transactionHash);
                r.setBlockNumber(quantity(receipt.get("blockNumber")).longValue());
                t.setTransactionResponse(r);
                callback.onResponse(null, t);
            } catch (Exception e) {
                callback.onResponse(e, null);
            }
        });
    }

    @Override
    public void asyncCustomCommand(String command, Path path, Object[] args, Account account, BlockManager blockManager, Connection connection, CustomCommandCallback callback) {
        callback.onResponse(new UnsupportedOperationException("the EVM stub has no custom commands (" + command + ")"), null);
    }

    @Override
    public byte[] accountSign(Account account, byte[] message) {
        return ((EvmAccount) account).signer().signMessage(message);
    }

    @Override
    public boolean accountVerify(String identity, byte[] signBytes, byte[] message) {
        return Signer.verify(identity, signBytes, message);
    }

    static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }
}
