import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.fisco.bcos.sdk.v3.crypto.CryptoSuite;
import org.fisco.bcos.sdk.v3.crypto.keypair.CryptoKeyPair;
import org.fisco.bcos.sdk.v3.crypto.signature.SignatureResult;
import org.fisco.bcos.sdk.v3.utils.Hex;

/**
 * The member's SM2 binding (spec 04, Guomi profile): its FISCO account signs "Praetor member binding" followed by the
 * 20-byte Base signer address, so the secp256k1 key Base trusts is tied to the SM2 identity on the consortium.
 * The SM2 signature covers SM3(message), the convention of FISCO transaction signatures, and is stored as
 * r || s || publicKey (128 bytes, FISCO's SM2 signature encoding): anyone can re-derive the signing FISCO address
 * (SM3(publicKey)[12..32]) and check it against the registered account. Checked before submission (this class) and
 * again after reading the registry back.
 */
final class Binding {
  static final byte[] PREFIX = "Praetor member binding".getBytes(StandardCharsets.UTF_8);

  private Binding() {}

  static byte[] message(String baseSigner) {
    byte[] addr = Abi.address(baseSigner);
    byte[] m = Arrays.copyOf(PREFIX, PREFIX.length + 20);
    System.arraycopy(addr, 0, m, PREFIX.length, 20);
    return m;
  }

  static byte[] sign(CryptoSuite sm, CryptoKeyPair member, String baseSigner) {
    SignatureResult s = sm.sign(sm.hash(message(baseSigner)), member);
    return Abi.concat(s.getR(), s.getS(), s.getPub());
  }

  /** True when the binding is a valid SM2 signature over this Base signer by exactly this FISCO account. */
  static boolean verify(CryptoSuite sm, byte[] binding, String fiscoAccount, String baseSigner) {
    if (binding == null || binding.length != 128) return false;
    byte[] rs = Arrays.copyOfRange(binding, 0, 64);
    byte[] pub = Arrays.copyOfRange(binding, 64, 128);
    if (!Arrays.equals(signerAddress(sm, binding), Abi.address(fiscoAccount))) return false;
    return sm.verify(Hex.toHexString(pub), sm.hash(message(baseSigner)), rs);
  }

  static byte[] signerAddress(CryptoSuite sm, byte[] binding) {
    return Arrays.copyOfRange(sm.hash(Arrays.copyOfRange(binding, 64, 128)), 12, 32);
  }
}
