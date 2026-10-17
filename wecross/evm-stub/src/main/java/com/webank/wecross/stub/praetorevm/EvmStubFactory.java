package com.webank.wecross.stub.praetorevm;

import com.webank.wecross.stub.Account;
import com.webank.wecross.stub.Connection;
import com.webank.wecross.stub.Driver;
import com.webank.wecross.stub.Stub;
import com.webank.wecross.stub.StubFactory;
import com.webank.wecross.stub.WeCrossContext;
import io.praetor.wecross.evm.EvmAccount;
import io.praetor.wecross.evm.EvmConfig;
import io.praetor.wecross.evm.EvmConnection;
import io.praetor.wecross.evm.EvmDriver;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Entry point of Praetor's EVM stub. It lives under com.webank only because router 1.4.0 scans that package for
 * {@code @Stub} classes; the implementation is in io.praetor.wecross.evm.
 */
@Stub("EVM")
public class EvmStubFactory implements StubFactory {
    @Override
    public void init(WeCrossContext context) {}

    @Override
    public Driver newDriver() {
        return new EvmDriver();
    }

    @Override
    public Connection newConnection(String path) {
        try {
            return new EvmConnection(EvmConfig.load(path));
        } catch (Exception e) {
            throw new IllegalStateException("EVM stub: cannot load " + path + ": " + e.getMessage(), e);
        }
    }

    @Override
    public Account newAccount(Map<String, Object> properties) {
        return EvmAccount.fromProperties(properties);
    }

    @Override
    public void generateAccount(String path, String[] args) {
        // Accounts come from the account manager (WECROSS_BASE_KEY); nothing to generate.
    }

    /** add_chain.sh -t EVM -n <name>: a stub.toml template to fill in. */
    @Override
    public void generateConnection(String path, String[] args) {
        String name = new File(path).getName();
        String toml = "[common]\n    name = '" + name + "'\n    type = 'EVM'\n\n[chain]\n    rpcUrl = 'http://anvil:8545'\n    chainId = 84532\n\n"
                + "[proxy]\n    address = '0x0000000000000000000000000000000000000000'\n\n[[resources]]\n    name = 'inbox'\n    address = '0x0000000000000000000000000000000000000000'\n";
        try {
            new File(path).mkdirs();
            try (FileOutputStream out = new FileOutputStream(new File(path, "stub.toml"))) {
                out.write(toml.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            throw new IllegalStateException("EVM stub: cannot write " + path, e);
        }
    }
}
