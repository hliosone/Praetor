package io.praetor.wecross.evm;

import com.webank.wecross.stub.Account;
import java.util.Map;

/** The router account on Base: a secp256k1 key handed over by the account manager (type "EVM", D42). */
public final class EvmAccount implements Account {
    public static final String TYPE = "EVM";

    private final String name;
    private final int keyID;
    private final boolean isDefault;
    private final Signer signer;

    public EvmAccount(String name, int keyID, boolean isDefault, Signer signer) {
        this.name = name;
        this.keyID = keyID;
        this.isDefault = isDefault;
        this.signer = signer;
    }

    /** From the properties the router builds out of the account manager's chain account. */
    public static EvmAccount fromProperties(Map<String, Object> p) {
        Object secKey = p.get("secKey");
        if (secKey == null) throw new IllegalArgumentException("EVM chain account without secKey");
        Object keyID = p.get("keyID");
        return new EvmAccount(String.valueOf(p.get("username")), keyID == null ? 0 : Integer.parseInt(String.valueOf(keyID)),
                Boolean.parseBoolean(String.valueOf(p.get("isDefault"))), signer(String.valueOf(secKey).trim()));
    }

    /** The account manager keeps keys as PEM; a bare hex key is accepted too. */
    private static Signer signer(String secKey) {
        return secKey.startsWith("-----BEGIN") ? Signer.fromPem(secKey) : Signer.fromPrivateKey(secKey);
    }

    public Signer signer() {
        return signer;
    }

    @Override
    public String getName() {
        return name;
    }

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    public String getIdentity() {
        return signer.address();
    }

    @Override
    public int getKeyID() {
        return keyID;
    }

    @Override
    public boolean isDefault() {
        return isDefault;
    }
}
