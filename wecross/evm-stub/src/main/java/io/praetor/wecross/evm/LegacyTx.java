package io.praetor.wecross.evm;

import java.math.BigInteger;

/** A signed legacy (type 0) transaction with EIP-155 replay protection, as Base accepts it. */
public final class LegacyTx {
    private LegacyTx() {}

    public static byte[] sign(Signer signer, long chainId, BigInteger nonce, BigInteger gasPrice, BigInteger gas, String to, BigInteger value, byte[] data) {
        BigInteger id = BigInteger.valueOf(chainId);
        byte[] toBytes = Hex.decode(to);
        byte[] unsigned = Rlp.list(Rlp.integer(nonce), Rlp.integer(gasPrice), Rlp.integer(gas), Rlp.bytes(toBytes), Rlp.integer(value), Rlp.bytes(data),
                Rlp.integer(id), Rlp.integer(BigInteger.ZERO), Rlp.integer(BigInteger.ZERO));
        Signer.Signature sig = signer.sign(Keccak.hash(unsigned));
        BigInteger v = BigInteger.valueOf(sig.recId).add(id.shiftLeft(1)).add(BigInteger.valueOf(35));
        return Rlp.list(Rlp.integer(nonce), Rlp.integer(gasPrice), Rlp.integer(gas), Rlp.bytes(toBytes), Rlp.integer(value), Rlp.bytes(data),
                Rlp.integer(v), Rlp.integer(sig.r), Rlp.integer(sig.s));
    }
}
