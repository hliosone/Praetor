package io.praetor.wecross.evm;

import org.bouncycastle.crypto.digests.KeccakDigest;

/** Ethereum's keccak256 (not SHA3-256). */
public final class Keccak {
    private Keccak() {}

    public static byte[] hash(byte[] in) {
        KeccakDigest d = new KeccakDigest(256);
        d.update(in, 0, in.length);
        byte[] out = new byte[32];
        d.doFinal(out, 0);
        return out;
    }
}
