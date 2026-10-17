import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.fisco.bcos.sdk.v3.utils.Hex;

/** The few ABI words the smoke builds and reads (selectors aside, ABI encoding is the same in both profiles). */
final class Abi {
  private Abi() {}

  static byte[] address(String a) {
    byte[] b = Hex.decode(a.replaceFirst("^0x", ""));
    if (b.length != 20) throw new IllegalArgumentException("not an address: " + a);
    return b;
  }

  static String hex(byte[] b) {
    return "0x" + Hex.toHexString(b);
  }

  static byte[] concat(byte[]... parts) {
    int n = 0;
    for (byte[] p : parts) n += p.length;
    byte[] out = new byte[n];
    int i = 0;
    for (byte[] p : parts) {
      System.arraycopy(p, 0, out, i, p.length);
      i += p.length;
    }
    return out;
  }

  static byte[] word(BigInteger v) {
    byte[] b = v.toByteArray();
    byte[] w = new byte[32];
    int len = Math.min(b.length, 32);
    System.arraycopy(b, b.length - len, w, 32 - len, len);
    return w;
  }

  static byte[] word(long v) {
    return word(BigInteger.valueOf(v));
  }

  static byte[] word(String address) {
    byte[] w = new byte[32];
    System.arraycopy(address(address), 0, w, 12, 20);
    return w;
  }

  static byte[] wordAt(byte[] data, int offset) {
    return Arrays.copyOfRange(data, offset, offset + 32);
  }

  static BigInteger uintAt(byte[] data, int offset) {
    return new BigInteger(1, wordAt(data, offset));
  }

  static String addressAt(byte[] data, int offset) {
    return hex(Arrays.copyOfRange(data, offset + 12, offset + 32));
  }

  /** Dynamic `bytes` whose length word sits at `offset`. */
  static byte[] bytesAt(byte[] data, int offset) {
    int len = uintAt(data, offset).intValueExact();
    return Arrays.copyOfRange(data, offset + 32, offset + 32 + len);
  }

  /** `bytes[]` whose length word sits at `offset`; element offsets are relative to the word after it. */
  static List<byte[]> bytesArrayAt(byte[] data, int offset) {
    int n = uintAt(data, offset).intValueExact();
    int base = offset + 32;
    List<byte[]> out = new ArrayList<>();
    for (int i = 0; i < n; i++) out.add(bytesAt(data, base + uintAt(data, base + 32 * i).intValueExact()));
    return out;
  }

  static List<String> addressArrayAt(byte[] data, int offset) {
    int n = uintAt(data, offset).intValueExact();
    List<String> out = new ArrayList<>();
    for (int i = 0; i < n; i++) out.add(addressAt(data, offset + 32 + 32 * i));
    return out;
  }

  static boolean sameAddress(String a, String b) {
    return Arrays.equals(address(a), address(b));
  }
}
