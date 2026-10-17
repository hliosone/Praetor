package io.praetor.wecross.evm;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * The ABI subset the stub needs: calls whose parameters are strings, bytes and string arrays (WeCross's
 * {@code string[] f(string[])} convention, and the WeCrossProxy entry points), and their return values.
 */
public final class Abi {
    private Abi() {}

    /** One dynamic parameter: its tail encoding (length-prefixed, padded). */
    public static final class Param {
        final byte[] tail;

        Param(byte[] tail) {
            this.tail = tail;
        }
    }

    public static Param string(String s) {
        return bytes(s.getBytes(StandardCharsets.UTF_8));
    }

    public static Param bytes(byte[] b) {
        return new Param(concat(word(BigInteger.valueOf(b.length)), pad(b)));
    }

    public static Param stringArray(String[] items) {
        Param[] ps = new Param[items.length];
        for (int i = 0; i < items.length; i++) ps[i] = string(items[i]);
        return new Param(concat(word(BigInteger.valueOf(items.length)), tuple(ps)));
    }

    /** selector(signature) followed by the encoded parameters (all dynamic). */
    public static byte[] call(String signature, Param... params) {
        byte[] selector = Arrays.copyOf(Keccak.hash(signature.getBytes(StandardCharsets.UTF_8)), 4);
        return concat(selector, tuple(params));
    }

    /** The parameters alone (a return value), without a selector. */
    public static byte[] encode(Param... params) {
        return tuple(params);
    }

    private static byte[] tuple(Param[] params) {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        ByteArrayOutputStream tail = new ByteArrayOutputStream();
        long offset = 32L * params.length;
        for (Param p : params) {
            write(head, word(BigInteger.valueOf(offset)));
            write(tail, p.tail);
            offset += p.tail.length;
        }
        return concat(head.toByteArray(), tail.toByteArray());
    }

    public static String decodeString(byte[] data) {
        return new String(dynamicAt(data, 0), StandardCharsets.UTF_8);
    }

    public static byte[] decodeBytes(byte[] data) {
        return dynamicAt(data, 0);
    }

    public static String[] decodeStringArray(byte[] data) {
        int base = toInt(data, 0);
        int n = toInt(data, base);
        int start = base + 32;
        String[] out = new String[n];
        for (int i = 0; i < n; i++) {
            int at = start + toInt(data, start + 32 * i);
            int len = toInt(data, at);
            out[i] = new String(Arrays.copyOfRange(data, at + 32, at + 32 + len), StandardCharsets.UTF_8);
        }
        return out;
    }

    /** The bytes/string whose offset is the word at `headIndex`. */
    private static byte[] dynamicAt(byte[] data, int headIndex) {
        int at = toInt(data, headIndex);
        int len = toInt(data, at);
        return Arrays.copyOfRange(data, at + 32, at + 32 + len);
    }

    private static int toInt(byte[] data, int at) {
        if (at + 32 > data.length) throw new IllegalArgumentException("ABI data too short");
        BigInteger v = new BigInteger(1, Arrays.copyOfRange(data, at, at + 32));
        if (v.bitLength() > 31) throw new IllegalArgumentException("ABI offset or length out of range");
        return v.intValue();
    }

    static byte[] word(BigInteger v) {
        byte[] raw = v.toByteArray();
        byte[] out = new byte[32];
        int n = Math.min(raw.length, 32);
        System.arraycopy(raw, raw.length - n, out, 32 - n, n);
        return out;
    }

    private static byte[] pad(byte[] b) {
        return Arrays.copyOf(b, (b.length + 31) / 32 * 32);
    }

    static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parts) write(out, p);
        return out.toByteArray();
    }

    private static void write(ByteArrayOutputStream out, byte[] b) {
        out.write(b, 0, b.length);
    }
}
