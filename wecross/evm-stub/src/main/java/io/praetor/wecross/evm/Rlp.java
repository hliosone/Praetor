package io.praetor.wecross.evm;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;

/** Recursive Length Prefix encoding of byte strings and lists. */
public final class Rlp {
    private Rlp() {}

    public static byte[] bytes(byte[] b) {
        if (b.length == 1 && (b[0] & 0xff) < 0x80) return b;
        return Abi.concat(prefix(0x80, b.length), b);
    }

    /** A non-negative integer: big-endian, no leading zeros (zero is the empty string). */
    public static byte[] integer(BigInteger v) {
        if (v.signum() == 0) return bytes(new byte[0]);
        byte[] raw = v.toByteArray();
        int skip = raw[0] == 0 ? 1 : 0;
        byte[] out = new byte[raw.length - skip];
        System.arraycopy(raw, skip, out, 0, out.length);
        return bytes(out);
    }

    public static byte[] list(byte[]... encodedItems) {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        for (byte[] i : encodedItems) body.write(i, 0, i.length);
        byte[] b = body.toByteArray();
        return Abi.concat(prefix(0xc0, b.length), b);
    }

    private static byte[] prefix(int offset, int length) {
        if (length < 56) return new byte[] {(byte) (offset + length)};
        byte[] len = BigInteger.valueOf(length).toByteArray();
        int skip = len[0] == 0 ? 1 : 0;
        byte[] out = new byte[1 + len.length - skip];
        out[0] = (byte) (offset + 55 + len.length - skip);
        System.arraycopy(len, skip, out, 1, len.length - skip);
        return out;
    }
}
