package io.praetor.wecross.evm;

/** 0x-prefixed lower-case hex. */
public final class Hex {
    private static final char[] DIGITS = "0123456789abcdef".toCharArray();

    private Hex() {}

    public static String encode(byte[] b) {
        char[] out = new char[2 + b.length * 2];
        out[0] = '0';
        out[1] = 'x';
        for (int i = 0; i < b.length; i++) {
            out[2 + 2 * i] = DIGITS[(b[i] >> 4) & 0xf];
            out[3 + 2 * i] = DIGITS[b[i] & 0xf];
        }
        return new String(out);
    }

    public static byte[] decode(String s) {
        String h = s.startsWith("0x") || s.startsWith("0X") ? s.substring(2) : s;
        if (h.length() % 2 != 0) h = "0" + h;
        byte[] out = new byte[h.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16);
        return out;
    }
}
