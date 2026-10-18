package io.praetor.wecross.evm;

import com.webank.wecross.stub.Connection;
import com.webank.wecross.stub.Request;
import com.webank.wecross.stub.ResourceInfo;
import com.webank.wecross.stub.Response;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** JSON-RPC over HTTP to the Base node. The only request type is a raw JSON-RPC body (type {@link #JSON_RPC}). */
public final class EvmConnection implements Connection {
    public static final int JSON_RPC = 1;

    private final EvmConfig config;

    public EvmConnection(EvmConfig config) {
        this.config = config;
    }

    public EvmConfig config() {
        return config;
    }

    @Override
    public void asyncSend(Request request, Callback callback) {
        Response response = new Response();
        try {
            if (request.getType() != JSON_RPC) throw new IllegalArgumentException("unknown request type " + request.getType());
            response.setData(post(request.getData()));
            response.setErrorCode(0);
        } catch (Exception e) {
            response.setErrorCode(1);
            response.setErrorMessage(e.getMessage());
        }
        callback.onResponse(response);
    }

    private byte[] post(byte[] body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(config.rpcUrl).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(10_000);
        c.setReadTimeout(60_000);
        c.setDoOutput(true);
        c.setRequestProperty("content-type", "application/json");
        // Cloudflare in front of the public Base Sepolia RPCs refuses Java's default "Java/1.8.0_x" (error 1010).
        c.setRequestProperty("user-agent", "praetor-evm-stub/1.0");
        try (OutputStream out = c.getOutputStream()) {
            out.write(body);
        }
        int status = c.getResponseCode();
        try (InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream()) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            for (int n; in != null && (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
            if (status >= 400) throw new IllegalStateException("HTTP " + status + ": " + new String(buf.toByteArray(), StandardCharsets.UTF_8));
            return buf.toByteArray();
        }
    }

    @Override
    public void setConnectionEventHandler(ConnectionEventHandler eventHandler) {
        // The resource list is static (stub.toml): nothing to push.
    }

    @Override
    public Map<String, String> getProperties() {
        Map<String, String> p = new HashMap<>();
        p.put("chainId", Long.toString(config.chainId));
        p.put("proxyAddress", config.proxy);
        return p;
    }

    /** WeCrossProxy and the business resources, as the router lists them. */
    public java.util.List<ResourceInfo> resources() {
        java.util.List<ResourceInfo> out = new java.util.ArrayList<>();
        out.add(info(EvmDriver.PROXY, config.proxy));
        for (Map.Entry<String, String> r : config.resources.entrySet()) out.add(info(r.getKey(), r.getValue()));
        return out;
    }

    private static ResourceInfo info(String name, String address) {
        ResourceInfo i = new ResourceInfo();
        i.setName(name);
        i.setStubType(EvmAccount.TYPE);
        Map<Object, Object> p = new HashMap<>();
        p.put("address", address);
        i.setProperties(p);
        i.setChecksum(address);
        return i;
    }
}
