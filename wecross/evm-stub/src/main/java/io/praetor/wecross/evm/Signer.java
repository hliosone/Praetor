package io.praetor.wecross.evm;

import java.math.BigInteger;
import java.util.Arrays;
import java.util.Base64;
import org.bouncycastle.asn1.ASN1Primitive;
import org.bouncycastle.asn1.ASN1Sequence;
import org.bouncycastle.asn1.pkcs.PrivateKeyInfo;
import org.bouncycastle.asn1.sec.ECPrivateKey;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.asn1.x9.X9IntegerConverter;
import org.bouncycastle.crypto.digests.SHA256Digest;
import org.bouncycastle.crypto.ec.CustomNamedCurves;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPrivateKeyParameters;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.bouncycastle.crypto.signers.HMacDSAKCalculator;
import org.bouncycastle.math.ec.ECAlgorithms;
import org.bouncycastle.math.ec.ECPoint;
import org.bouncycastle.math.ec.custom.sec.SecP256K1Curve;

/** A secp256k1 key: deterministic (RFC 6979) low-s signatures with their recovery id, Ethereum addresses. */
public final class Signer {
    private static final X9ECParameters PARAMS = CustomNamedCurves.getByName("secp256k1");
    private static final ECDomainParameters CURVE = new ECDomainParameters(PARAMS.getCurve(), PARAMS.getG(), PARAMS.getN(), PARAMS.getH());
    private static final BigInteger HALF_N = PARAMS.getN().shiftRight(1);

    private final BigInteger d;
    private final ECPoint q;

    private Signer(BigInteger d) {
        if (d.signum() <= 0 || d.compareTo(PARAMS.getN()) >= 0) throw new IllegalArgumentException("invalid secp256k1 key");
        this.d = d;
        this.q = PARAMS.getG().multiply(d).normalize();
    }

    public static Signer fromPrivateKey(String hex) {
        return new Signer(new BigInteger(1, Hex.decode(hex)));
    }

    /** A PEM private key as the account manager stores it: PKCS#8 ("PRIVATE KEY") or SEC 1 ("EC PRIVATE KEY"). */
    public static Signer fromPem(String pem) {
        String body = pem.replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
        byte[] der = Base64.getDecoder().decode(body);
        try {
            ASN1Sequence seq = ASN1Sequence.getInstance(ASN1Primitive.fromByteArray(der));
            ECPrivateKey ec = pem.contains("EC PRIVATE KEY")
                    ? ECPrivateKey.getInstance(seq)
                    : ECPrivateKey.getInstance(PrivateKeyInfo.getInstance(seq).parsePrivateKey());
            return new Signer(ec.getKey());
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("unreadable PEM private key", e);
        }
    }

    public String publicKeyHex() {
        return Hex.encode(q.getEncoded(false));
    }

    public String address() {
        return addressOf(q);
    }

    /** r, s (low) and the recovery id of a signature over a 32-byte hash. */
    public static final class Signature {
        public final BigInteger r;
        public final BigInteger s;
        public final int recId;

        Signature(BigInteger r, BigInteger s, int recId) {
            this.r = r;
            this.s = s;
            this.recId = recId;
        }
    }

    public Signature sign(byte[] hash) {
        ECDSASigner signer = new ECDSASigner(new HMacDSAKCalculator(new SHA256Digest()));
        signer.init(true, new ECPrivateKeyParameters(d, CURVE));
        BigInteger[] rs = signer.generateSignature(hash);
        BigInteger r = rs[0];
        BigInteger s = rs[1].compareTo(HALF_N) > 0 ? PARAMS.getN().subtract(rs[1]) : rs[1];
        for (int recId = 0; recId < 2; recId++) {
            ECPoint p = recover(recId, r, s, hash);
            if (p != null && p.equals(q)) return new Signature(r, s, recId);
        }
        throw new IllegalStateException("no recovery id matches the key");
    }

    /** 65 bytes r || s || v (27 or 28) over keccak256(message). */
    public byte[] signMessage(byte[] message) {
        Signature sig = sign(Keccak.hash(message));
        return Abi.concat(Abi.word(sig.r), Abi.word(sig.s), new byte[] {(byte) (27 + sig.recId)});
    }

    public static boolean verify(String address, byte[] sig, byte[] message) {
        if (sig.length != 65) return false;
        int v = sig[64] & 0xff;
        int recId = v >= 27 ? v - 27 : v;
        if (recId < 0 || recId > 1) return false;
        ECPoint p = recover(recId, new BigInteger(1, Arrays.copyOfRange(sig, 0, 32)), new BigInteger(1, Arrays.copyOfRange(sig, 32, 64)), Keccak.hash(message));
        return p != null && addressOf(p).equalsIgnoreCase(address);
    }

    private static String addressOf(ECPoint p) {
        byte[] enc = p.getEncoded(false);
        byte[] h = Keccak.hash(Arrays.copyOfRange(enc, 1, enc.length));
        return Hex.encode(Arrays.copyOfRange(h, 12, 32));
    }

    /** SEC 1 section 4.1.6 public key recovery (as in Ethereum clients). */
    private static ECPoint recover(int recId, BigInteger r, BigInteger s, byte[] hash) {
        BigInteger n = PARAMS.getN();
        BigInteger prime = SecP256K1Curve.q;
        if (r.signum() <= 0 || r.compareTo(n) >= 0 || s.signum() <= 0 || s.compareTo(n) >= 0) return null;
        if (r.compareTo(prime) >= 0) return null;
        X9IntegerConverter x9 = new X9IntegerConverter();
        byte[] compressed = x9.integerToBytes(r, 1 + x9.getByteLength(CURVE.getCurve()));
        compressed[0] = (byte) ((recId & 1) == 1 ? 0x03 : 0x02);
        ECPoint R = CURVE.getCurve().decodePoint(compressed);
        if (!R.multiply(n).isInfinity()) return null;
        BigInteger e = new BigInteger(1, hash);
        BigInteger rInv = r.modInverse(n);
        BigInteger u1 = e.negate().mod(n).multiply(rInv).mod(n);
        BigInteger u2 = s.multiply(rInv).mod(n);
        return ECAlgorithms.sumOfTwoMultiplies(CURVE.getG(), u1, R, u2).normalize();
    }
}
