import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import org.fisco.bcos.sdk.v3.crypto.CryptoSuite;
import org.fisco.bcos.sdk.v3.crypto.keypair.CryptoKeyPair;
import org.fisco.bcos.sdk.v3.crypto.signature.ECDSASignatureResult;
import org.fisco.bcos.sdk.v3.model.CryptoType;

/**
 * The Base side of an attestation, computed off-chain with keccak256 and secp256k1 (spec 02): an SM chain hashes with
 * SM3, so in the Guomi profile members build the EIP-712 digest here from the board's fields and the registry's
 * domainName and baseHook, never from the chain. `accepts` replays what MandateHook checks on Base.
 */
final class BaseDigest {
  static final long BASE_CHAIN_ID = 84532;
  static final String STATUS = "StatusAttestation(address account,uint8 status,uint64 nonce,uint64 deadline,bytes32 fiscoRef)";
  static final String ANCHOR = "AnchorAttestation(uint64 seq,bytes32 head,uint64 fiscoBlock,uint64 deadline)";
  private static final BigInteger HALF_N = new BigInteger("7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0", 16);

  final CryptoSuite ec = new CryptoSuite(CryptoType.ECDSA_TYPE);

  byte[] keccak(byte[] b) {
    return ec.hash(b);
  }

  byte[] keccak(String s) {
    return keccak(s.getBytes(StandardCharsets.UTF_8));
  }

  byte[] domainSeparator(String name, String hook) {
    byte[] typehash = keccak("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    return keccak(Abi.concat(typehash, keccak(name), keccak("1"), Abi.word(BASE_CHAIN_ID), Abi.word(hook)));
  }

  /** Every attestation the boards hold is a static tuple, so its struct hash is keccak(typehash || fields). */
  byte[] structHash(String encodeType, byte[] fields) {
    return keccak(Abi.concat(keccak(encodeType), fields));
  }

  byte[] digest(String name, String hook, String encodeType, byte[] fields) {
    return keccak(Abi.concat(new byte[] {0x19, 0x01}, domainSeparator(name, hook), structHash(encodeType, fields)));
  }

  /** r || s || v with v = 27 or 28, as Base (OpenZeppelin ECDSA) expects. */
  byte[] sign(CryptoKeyPair baseSigner, byte[] digest) {
    ECDSASignatureResult s = (ECDSASignatureResult) ec.sign(digest, baseSigner);
    return Abi.concat(s.getR(), s.getS(), new byte[] {(byte) (s.getV() + 27)});
  }

  String recover(byte[] digest, byte[] sig) {
    if (sig.length != 65 || (sig[64] != 27 && sig[64] != 28)) return null;
    ECDSASignatureResult r = new ECDSASignatureResult((byte) (sig[64] - 27), Arrays.copyOfRange(sig, 0, 32), Arrays.copyOfRange(sig, 32, 64));
    try {
      return ec.recoverAddress(digest, r);
    } catch (RuntimeException e) {
      return null;
    }
  }

  static boolean lowS(byte[] sig) {
    return new BigInteger(1, Arrays.copyOfRange(sig, 32, 64)).compareTo(HALF_N) <= 0;
  }

  /** What the hook checks: at least `required` low-s signatures, each from a member, signers strictly ascending. */
  boolean accepts(byte[] digest, List<byte[]> sigs, List<String> members, int required) {
    if (sigs.size() < required) return false;
    BigInteger last = BigInteger.valueOf(-1);
    for (byte[] sig : sigs) {
      String who = recover(digest, sig);
      if (who == null || !lowS(sig) || members.stream().noneMatch(m -> Abi.sameAddress(m, who))) return false;
      BigInteger a = new BigInteger(1, Abi.address(who));
      if (a.compareTo(last) <= 0) return false;
      last = a;
    }
    return true;
  }
}
