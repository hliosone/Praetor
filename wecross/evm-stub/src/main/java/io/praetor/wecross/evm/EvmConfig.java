package io.praetor.wecross.evm;

import com.moandjiezana.toml.Toml;
import java.io.File;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A Base chain's stub.toml:
 * <pre>
 * [common]   name = 'base'  type = 'EVM'
 * [chain]    rpcUrl = 'http://anvil:8545'  chainId = 84532  genesisBlock = 48226008 (the deployment block)
 * [proxy]    address = '0x...'             (WeCrossProxyEVM)
 * [[resources]]  name = 'inbox'  address = '0x...'
 * </pre>
 */
public final class EvmConfig {
    public final String name;
    public final String rpcUrl;
    public final long chainId;
    public final String proxy;
    /** The block the router reads as "genesis" (chain identity): pruned nodes have no block 0 (default 0). */
    public final long genesisBlock;
    /** Resource name to address; the proxy routes by name (setPath on-chain). */
    public final Map<String, String> resources = new LinkedHashMap<>();

    EvmConfig(Toml t) {
        name = t.getString("common.name", "base");
        rpcUrl = required(t.getString("chain.rpcUrl"), "chain.rpcUrl");
        chainId = required(t.getLong("chain.chainId"), "chain.chainId");
        proxy = required(t.getString("proxy.address"), "proxy.address").toLowerCase();
        genesisBlock = t.getLong("chain.genesisBlock", 0L);
        List<Toml> rs = t.getTables("resources");
        if (rs != null) for (Toml r : rs) resources.put(required(r.getString("name"), "resources.name"), required(r.getString("address"), "resources.address").toLowerCase());
    }

    private static <T> T required(T v, String key) {
        if (v == null) throw new IllegalArgumentException("stub.toml: missing " + key);
        return v;
    }

    public static EvmConfig parse(String toml) {
        return new EvmConfig(new Toml().read(toml));
    }

    /** `path` is a chain directory, "classpath:chains/base/" or a filesystem path, holding stub.toml. */
    public static EvmConfig load(String path) throws Exception {
        String dir = path.endsWith("/") ? path : path + "/";
        if (dir.startsWith("classpath:")) {
            String rel = dir.substring("classpath:".length());
            try (InputStream in = Thread.currentThread().getContextClassLoader().getResourceAsStream(rel + "stub.toml")) {
                if (in == null) throw new IllegalArgumentException("no stub.toml in " + path);
                return new EvmConfig(new Toml().read(in));
            }
        }
        return new EvmConfig(new Toml().read(new File(dir + "stub.toml")));
    }
}
