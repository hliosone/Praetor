import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.fisco.bcos.sdk.v3.BcosSDK;
import org.fisco.bcos.sdk.v3.client.Client;
import org.fisco.bcos.sdk.v3.client.protocol.request.Transaction;
import org.fisco.bcos.sdk.v3.client.protocol.response.Call;
import org.fisco.bcos.sdk.v3.codec.ContractCodec;
import org.fisco.bcos.sdk.v3.crypto.CryptoSuite;
import org.fisco.bcos.sdk.v3.crypto.keypair.CryptoKeyPair;
import org.fisco.bcos.sdk.v3.model.TransactionReceipt;
import org.fisco.bcos.sdk.v3.transaction.manager.AssembleTransactionProcessor;
import org.fisco.bcos.sdk.v3.transaction.manager.TransactionProcessorFactory;
import org.fisco.bcos.sdk.v3.transaction.model.dto.TransactionResponse;
import org.fisco.bcos.sdk.v3.utils.Hex;

/**
 * FISCO Java SDK 3.8.0 on the SM chain: SM-TLS to the node, SM2-signed transactions, SM3 selectors (the client's
 * crypto suite encodes every call). Contracts come from the SM solc build (`<Name>.abi`, `<Name>.bin`).
 */
final class Chain implements AutoCloseable {
  final BcosSDK sdk;
  final Client client;
  final CryptoSuite sm;
  final ContractCodec codec;
  private final Path contracts;
  private final Map<String, AssembleTransactionProcessor> processors = new HashMap<>();

  Chain(Path config, Path contracts) {
    this.sdk = BcosSDK.build(config.toString());
    this.client = sdk.getClient("group0");
    this.sm = client.getCryptoSuite();
    this.codec = new ContractCodec(sm, false);
    this.contracts = contracts;
  }

  /** An SM2 key pair from its hex scalar, without touching the suite's default account. */
  CryptoKeyPair key(String hex) {
    return sm.getKeyPairFactory().createKeyPair(hex);
  }

  String abi(String contract) {
    return read(contract + ".abi");
  }

  String bin(String contract) {
    return read(contract + ".bin");
  }

  private String read(String file) {
    try {
      return new String(Files.readAllBytes(contracts.resolve(file)), StandardCharsets.UTF_8).trim();
    } catch (Exception e) {
      throw new IllegalStateException("missing SM build output " + file, e);
    }
  }

  private AssembleTransactionProcessor processor(CryptoKeyPair kp) {
    return processors.computeIfAbsent(kp.getAddress(), a -> TransactionProcessorFactory.createAssembleTransactionProcessor(client, kp));
  }

  TransactionReceipt deploy(CryptoKeyPair kp, String contract, Object... args) {
    try {
      TransactionResponse r = processor(kp).deployAndGetResponse(abi(contract), bin(contract), Arrays.asList(args));
      return r.getTransactionReceipt();
    } catch (Exception e) {
      throw new IllegalStateException("deploy " + contract + ": " + e.getMessage(), e);
    }
  }

  TransactionReceipt send(CryptoKeyPair kp, String contract, String to, String fn, Object... args) {
    try {
      return processor(kp).sendTransactionAndGetResponse(to, abi(contract), fn, Arrays.asList(args)).getTransactionReceipt();
    } catch (Exception e) {
      throw new IllegalStateException(contract + "." + fn + ": " + e.getMessage(), e);
    }
  }

  byte[] encode(String contract, String fn, Object... args) {
    try {
      return codec.encodeMethod(abi(contract), fn, Arrays.asList(args));
    } catch (Exception e) {
      throw new IllegalStateException("encode " + contract + "." + fn + ": " + e.getMessage(), e);
    }
  }

  Call.CallOutput rawCall(String from, String to, byte[] data) {
    return client.call(new Transaction(from, to, data)).getCallResult();
  }

  /** A view call's raw ABI output; a failed call throws with its status. */
  byte[] call(String contract, String to, String fn, Object... args) {
    Call.CallOutput out = rawCall(to, to, encode(contract, fn, args));
    if (out.getStatus() != 0) throw new IllegalStateException(contract + "." + fn + " call status " + out.getStatus());
    return Hex.decode(out.getOutput().replaceFirst("^0x", ""));
  }

  /** First 4 bytes of SM3(signature): selectors and custom error ids on an SM chain. */
  byte[] selector(String signature) {
    return Arrays.copyOf(sm.hash(signature.getBytes(StandardCharsets.UTF_8)), 4);
  }

  /** The custom error a failed receipt or call carries, by its SM3 id, or null. */
  String revertError(String output, List<String> errors) {
    if (output == null) return null;
    String o = output.replaceFirst("^0x", "");
    if (o.length() < 8) return null;
    for (String e : errors) if (o.substring(0, 8).equalsIgnoreCase(Hex.toHexString(selector(e)))) return e;
    return null;
  }

  @Override
  public void close() {
    sdk.stopAll();
  }
}
