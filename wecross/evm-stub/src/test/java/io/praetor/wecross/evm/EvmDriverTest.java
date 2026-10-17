package io.praetor.wecross.evm;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import com.webank.wecross.stub.Block;
import com.webank.wecross.stub.Path;
import com.webank.wecross.stub.StubConstant;
import com.webank.wecross.stub.TransactionContext;
import com.webank.wecross.stub.TransactionException;
import com.webank.wecross.stub.TransactionRequest;
import com.webank.wecross.stub.TransactionResponse;
import com.webank.wecross.stub.praetorevm.EvmStubFactory;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** The driver against a fake Base node (JSON-RPC over HTTP). */
public class EvmDriverTest {
    private static final String PROXY = "0x00000000000000000000000000000000000000a1";
    private static final String INBOX = "0x00000000000000000000000000000000000000b2";
    private final ObjectMapper json = new ObjectMapper();
    private final List<String> methods = new ArrayList<>();
    private final List<String> sentRaw = new ArrayList<>();
    private final List<String> blockRequests = new ArrayList<>();
    private HttpServer server;
    private boolean revert;
    private EvmConfig config;

    @Before
    public void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            JsonNode req;
            try (InputStream in = ex.getRequestBody()) {
                req = json.readTree(in);
            }
            String m = req.get("method").asText();
            methods.add(m);
            ObjectNode out = json.createObjectNode();
            out.put("jsonrpc", "2.0");
            out.put("id", 1);
            switch (m) {
                case "eth_call":
                    if (revert) out.putObject("error").put("message", "execution reverted");
                    else if (req.get("params").get(0).get("data").asText().startsWith(Hex.encode(Abi.call("getXATransactionState(string)", Abi.string("x"))).substring(0, 10)))
                        out.put("result", Hex.encode(Abi.encode(Abi.string("null"))));
                    else out.put("result", Hex.encode(Abi.encode(Abi.bytes(Abi.encode(Abi.stringArray(new String[] {"ok", "7"}))))));
                    break;
                case "eth_estimateGas": out.put("result", "0x5208"); break;
                case "eth_gasPrice": out.put("result", "0x3b9aca00"); break;
                case "eth_getTransactionCount": out.put("result", "0x7"); break;
                case "eth_sendRawTransaction":
                    String raw = req.get("params").get(0).asText();
                    sentRaw.add(raw);
                    out.put("result", Hex.encode(Keccak.hash(Hex.decode(raw))));
                    break;
                case "eth_getTransactionReceipt": out.putObject("result").put("status", "0x1").put("blockNumber", "0x2a"); break;
                case "eth_blockNumber": out.put("result", "0x2a"); break;
                case "eth_getBlockByNumber":
                    blockRequests.add(req.get("params").get(0).asText());
                    ObjectNode b = out.putObject("result");
                    b.put("number", "0x2a").put("hash", "0xbb").put("parentHash", "0xaa").put("stateRoot", "0x01").put("transactionsRoot", "0x02").put("receiptsRoot", "0x03").put("timestamp", "0x10");
                    b.putArray("transactions").add("0xt1");
                    break;
                default: out.putObject("error").put("message", "unexpected " + m);
            }
            byte[] body = json.writeValueAsBytes(out);
            ex.sendResponseHeaders(200, body.length);
            try (OutputStream o = ex.getResponseBody()) {
                o.write(body);
            }
        });
        server.start();
        config = EvmConfig.parse("[common]\nname = 'base'\n[chain]\nrpcUrl = 'http://127.0.0.1:" + server.getAddress().getPort() + "'\nchainId = 84532\n"
                + "[proxy]\naddress = '" + PROXY + "'\n[[resources]]\nname = 'inbox'\naddress = '" + INBOX + "'\n");
    }

    @After
    public void stop() {
        server.stop(0);
    }

    private static Signer signer() {
        return Signer.fromPrivateKey(Hex.encode(Keccak.hash("praetor-wecross-evm-stub-test".getBytes(StandardCharsets.UTF_8))));
    }

    private TransactionContext context(String resource) throws Exception {
        return new TransactionContext(new EvmAccount("router", 0, true, signer()), Path.decode("payment.base." + resource), null, null);
    }

    private TransactionResponse await(java.util.function.Consumer<com.webank.wecross.stub.Driver.Callback> call) throws Exception {
        CompletableFuture<TransactionResponse> f = new CompletableFuture<>();
        call.accept((TransactionException e, TransactionResponse r) -> {
            if (e != null && !e.isSuccess()) f.completeExceptionally(e);
            else f.complete(r);
        });
        return f.get(10, TimeUnit.SECONDS);
    }

    @Test
    public void routesThroughTheProxyByNameAndReadsTheRawProxyState() {
        TransactionRequest deliver = new TransactionRequest("deliver", new String[] {"Status", "0xabcd", "7"});
        deliver.getOptions().put(StubConstant.TRANSACTION_UNIQUE_ID, "uid-1");
        byte[] inner = Abi.call("deliver(string[])", Abi.stringArray(deliver.getArgs()));
        EvmDriver.Plan send = EvmDriver.plan(config, "inbox", deliver, true, true);
        assertEquals(PROXY, send.to);
        assertArrayEquals(Abi.call("sendTransaction(string,string,bytes)", Abi.string("uid-1"), Abi.string("inbox"), Abi.bytes(inner)), send.data);
        assertArrayEquals(Abi.call("constantCall(string,bytes)", Abi.string("inbox"), Abi.bytes(inner)), EvmDriver.plan(config, "inbox", deliver, true, false).data);
        EvmDriver.Plan raw = EvmDriver.plan(config, "inbox", deliver, false, true);
        assertEquals(INBOX, raw.to);
        assertArrayEquals(inner, raw.data);
        EvmDriver.Plan xa = EvmDriver.plan(config, EvmDriver.PROXY, new TransactionRequest("getXATransactionState", new String[] {"payment.base.inbox"}), false, false);
        assertEquals(PROXY, xa.to);
        assertTrue(xa.returnsString);
    }

    @Test
    public void baseHasNoHub_theRoutersPollGetsNoRequestsWithoutAnyCall() throws Exception {
        TransactionResponse r = await((cb) -> {
            try {
                new EvmDriver().asyncCall(context(StubConstant.HUB_NAME), new TransactionRequest("getInterchainRequests", new String[] {"16"}), true, new EvmConnection(config), cb);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        assertArrayEquals(new String[] {"null"}, r.getResult());
        assertTrue(methods.isEmpty());
    }

    @Test
    public void aStringArrayParameterArrivesAsOneJsonArgument_asTheRouterSendsInterchainRequests() {
        String[] items = {"Status", "0xabcd", "35"};
        TransactionRequest fromRouter = new TransactionRequest("deliver", new String[] {"[\"Status\",\"0xabcd\",\"35\"]"});
        assertArrayEquals(Abi.call("deliver(string[])", Abi.stringArray(items)), EvmDriver.plan(config, "inbox", fromRouter, false, true).data);
        // Separate strings (a console call) stay the array's items.
        assertArrayEquals(Abi.call("deliver(string[])", Abi.stringArray(items)), EvmDriver.plan(config, "inbox", new TransactionRequest("deliver", items), false, true).data);
    }

    @Test(expected = IllegalArgumentException.class)
    public void refusesAnUnknownResource() {
        EvmDriver.plan(config, "nope", new TransactionRequest("f", new String[0]), false, false);
    }

    @Test
    public void sendsThroughTheProxy_simulatedResultSignedTransactionAndReceipt() throws Exception {
        EvmDriver d = new EvmDriver(5_000, 50);
        EvmConnection c = new EvmConnection(config);
        TransactionResponse r = await((cb) -> {
            try {
                d.asyncSendTransaction(context("inbox"), new TransactionRequest("deliver", new String[] {"Status", "0xab"}), true, c, cb);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        assertEquals(0L, (long) r.getErrorCode());
        // WeCross's convention: one result per output, an array as JSON (the router passes it to the FISCO callback).
        assertArrayEquals(new String[] {"[\"ok\",\"7\"]"}, r.getResult());
        assertEquals(42L, r.getBlockNumber());
        assertEquals(1, sentRaw.size());
        assertEquals(Hex.encode(Keccak.hash(Hex.decode(sentRaw.get(0)))), r.getHash());
        assertEquals(java.util.Arrays.asList("eth_call", "eth_estimateGas", "eth_gasPrice", "eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionReceipt"), methods);
    }

    @Test
    public void aRevertingSimulationIsAnErrorAndNothingIsSent() throws Exception {
        revert = true;
        EvmDriver d = new EvmDriver(5_000, 50);
        TransactionResponse r = await((cb) -> {
            try {
                d.asyncSendTransaction(context("inbox"), new TransactionRequest("deliver", new String[] {"x"}), true, new EvmConnection(config), cb);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        assertEquals((long) EvmDriver.CALL_REVERTED, (long) r.getErrorCode());
        assertTrue(sentRaw.isEmpty());
    }

    @Test
    public void readsBlocksForTheRoutersBlockManager() throws Exception {
        CompletableFuture<Block> f = new CompletableFuture<>();
        new EvmDriver().asyncGetBlock(42, false, new EvmConnection(config), (e, b) -> { if (e != null) f.completeExceptionally(e); else f.complete(b); });
        Block b = f.get(10, TimeUnit.SECONDS);
        assertEquals(42L, b.getBlockHeader().getNumber());
        assertEquals("0xaa", b.getBlockHeader().getPrevHash());
        assertEquals(16_000L, b.getBlockHeader().getTimestamp());
        assertEquals(java.util.Collections.singletonList("0xt1"), b.getTransactionsHashes());
    }

    @Test
    public void answersTheGenesisRequestWithTheConfiguredReferenceBlock_prunedNodesHaveNoBlockZero() throws Exception {
        EvmConfig pruned = EvmConfig.parse("[chain]\nrpcUrl = 'http://127.0.0.1:" + server.getAddress().getPort() + "'\nchainId = 84532\ngenesisBlock = 42\n[proxy]\naddress = '" + PROXY + "'\n");
        CompletableFuture<Block> f = new CompletableFuture<>();
        new EvmDriver().asyncGetBlock(0, true, new EvmConnection(pruned), (e, b) -> { if (e != null) f.completeExceptionally(e); else f.complete(b); });
        assertEquals(42L, f.get(10, TimeUnit.SECONDS).getBlockHeader().getNumber());
        assertEquals(java.util.Collections.singletonList("0x2a"), blockRequests);
    }

    @Test
    public void factoryLoadsStubTomlAndBuildsTheAccountFromTheAccountManager() throws Exception {
        File dir = Files.createTempDirectory("evm-stub").toFile();
        EvmStubFactory f = new EvmStubFactory();
        f.generateConnection(new File(dir, "base").getPath(), new String[0]);
        EvmConnection c = (EvmConnection) f.newConnection(new File(dir, "base").getPath());
        assertEquals(84532L, c.config().chainId);
        assertEquals(2, c.resources().size());
        Map<String, Object> props = new HashMap<>();
        props.put("username", "praetor");
        props.put("keyID", 3);
        props.put("isDefault", true);
        props.put("secKey", Hex.encode(Keccak.hash("praetor-wecross-evm-stub-test".getBytes(StandardCharsets.UTF_8))));
        EvmAccount a = (EvmAccount) f.newAccount(props);
        assertEquals("EVM", a.getType());
        assertEquals(signer().address(), a.getIdentity());
        assertEquals(3, a.getKeyID());
    }
}
