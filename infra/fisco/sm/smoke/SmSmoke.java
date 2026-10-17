import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.fisco.bcos.sdk.v3.client.protocol.response.Call;
import org.fisco.bcos.sdk.v3.contract.auth.manager.AuthManager;
import org.fisco.bcos.sdk.v3.contract.auth.po.AuthType;
import org.fisco.bcos.sdk.v3.contract.auth.po.CommitteeInfo;
import org.fisco.bcos.sdk.v3.contract.auth.po.GovernorInfo;
import org.fisco.bcos.sdk.v3.contract.auth.po.ProposalInfo;
import org.fisco.bcos.sdk.v3.crypto.CryptoSuite;
import org.fisco.bcos.sdk.v3.crypto.keypair.CryptoKeyPair;
import org.fisco.bcos.sdk.v3.model.CryptoType;
import org.fisco.bcos.sdk.v3.model.TransactionReceipt;
import org.fisco.bcos.sdk.v3.utils.Hex;

/**
 * Guomi profile smoke (M15, spec 04) with FISCO's Java SDK 3.8.0. Modes, each run by infra/fisco/sm/run.sh in the
 * pinned JDK 11 image:
 *   keygen   fresh test-only keys under WORK/keys (SM2 FISCO accounts, secp256k1 Base signers), addresses only printed
 *   selftest pure checks before the chain exists: SM3, the off-chain Base digest against the golden vectors, bindings
 *   smoke     on the SM chain: governance bootstrap, deploy ACL, the SM build of the contracts, member bindings, a
 *            status attestation and an audit anchor through the opaque boards, audit chain, SM3 facts
 * Each mode writes WORK/<mode>-results.json and exits non-zero when a check fails.
 */
public final class SmSmoke {
  static final String SM3_ABC = "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0";
  static final String KECCAK_ABC = "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45";
  static final String[] SM2_ACCOUNTS = {"bank", "regulator", "operator", "deployer", "weid", "stranger", "router", "relayer"};
  static final String[] BASE_SIGNERS = {"bank", "regulator", "operator", "operator2"};
  static final List<String> ERRORS = Arrays.asList("NotMember()", "AlreadySigned()", "BadSignature()", "NotOpen()", "OnlyOperator()",
      "OnlyBank()", "DigestOffChain()", "DomainOffChain()", "OnlyDeployer()");
  static final String DOMAIN = "Praetor-sm-smoke";
  static final String HOOK = "0x00000000000000000000000000000000DeaDBeef";
  static final String USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  static final ObjectMapper JSON = new ObjectMapper();

  public static void main(String[] args) throws Exception {
    String mode = args[0];
    Path work = Paths.get(args[1]);
    if (mode.equals("keygen")) {
      keygen(work);
      return;
    }
    Report report = new Report();
    try {
      if (mode.equals("selftest")) selftest(work, report);
      else if (mode.equals("smoke")) new SmSmoke(work, report).run();
      else throw new IllegalArgumentException("unknown mode " + mode);
    } catch (Exception e) {
      e.printStackTrace();
      report.check("aborted", "the " + mode + " ran to the end", false, e.toString());
    }
    report.print(mode);
    report.write(work.resolve(mode + "-results.json"));
    System.exit(report.failed() == 0 ? 0 : 1);
  }

  // ---------------------------------------------------------------- keygen

  static void keygen(Path work) throws Exception {
    Path keys = work.resolve("keys");
    Files.createDirectories(keys);
    CryptoSuite sm = new CryptoSuite(CryptoType.SM_TYPE);
    CryptoSuite ec = new CryptoSuite(CryptoType.ECDSA_TYPE);
    ObjectNode addresses = JSON.createObjectNode();
    for (String n : SM2_ACCOUNTS) addresses.put(n, writeKey(keys.resolve(n + ".sm2"), sm.generateRandomKeyPair()));
    ObjectNode base = addresses.putObject("baseSigners");
    for (String n : BASE_SIGNERS) base.put(n, writeKey(keys.resolve(n + ".base"), ec.generateRandomKeyPair()));
    JSON.writerWithDefaultPrettyPrinter().writeValue(keys.resolve("addresses.json").toFile(), addresses);
    System.out.println("keygen: " + addresses);
  }

  static String writeKey(Path file, CryptoKeyPair kp) throws Exception {
    Files.write(file, kp.getHexPrivateKey().getBytes(StandardCharsets.UTF_8));
    Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
    return kp.getAddress();
  }

  static String readKey(Path work, String file) throws Exception {
    return new String(Files.readAllBytes(work.resolve("keys").resolve(file)), StandardCharsets.UTF_8).trim();
  }

  // ---------------------------------------------------------------- selftest

  /** The anvil test scalars of the golden vectors (packages/protocol/vectors, Q13): public, never funded. */
  static final Map<String, String> VECTOR_PK = new LinkedHashMap<>();

  static {
    VECTOR_PK.put("bank", "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    VECTOR_PK.put("regulator", "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    VECTOR_PK.put("operator", "7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
  }

  static void selftest(Path work, Report report) throws Exception {
    CryptoSuite sm = new CryptoSuite(CryptoType.SM_TYPE);
    BaseDigest base = new BaseDigest();
    byte[] abc = "abc".getBytes(StandardCharsets.UTF_8);
    report.check("sdk.sm3", "the SDK's SM3(\"abc\") is the GB/T 32905 test value", Hex.toHexString(sm.hash(abc)).equals(SM3_ABC), Hex.toHexString(sm.hash(abc)));
    report.check("sdk.keccak", "the SDK's ECDSA suite hashes with keccak256", Hex.toHexString(base.keccak(abc)).equals(KECCAK_ABC), Hex.toHexString(base.keccak(abc)));
    for (String[] v : new String[][] {{"status-attestation.json", BaseDigest.STATUS}, {"anchor-attestation.json", BaseDigest.ANCHOR}}) {
      JsonNode j = JSON.readTree(Paths.get("/vectors", v[0]).toFile());
      byte[] fields = Hex.decode(j.get("encoded").asText().substring(2));
      String name = j.get("domain").get("name").asText();
      String hook = j.get("domain").get("verifyingContract").asText();
      boolean typehash = Abi.hex(base.keccak(v[1])).equals(j.get("typehash").asText());
      boolean struct = Abi.hex(base.structHash(v[1], fields)).equals(j.get("structHash").asText());
      byte[] digest = base.digest(name, hook, v[1], fields);
      report.check("vector." + v[0], "the off-chain Base digest matches the golden vector (typehash, struct hash, digest)",
          typehash && struct && Abi.hex(digest).equals(j.get("digest").asText()), Abi.hex(digest));
      boolean same = true;
      StringBuilder d = new StringBuilder();
      for (JsonNode s : j.get("signatures")) {
        byte[] sig = base.sign(base.ec.getKeyPairFactory().createKeyPair(VECTOR_PK.get(s.get("who").asText())), digest);
        same &= Abi.hex(sig).equals(s.get("sig").asText()) && Abi.sameAddress(base.recover(digest, sig), s.get("signer").asText()) && BaseDigest.lowS(sig);
        d.append(s.get("who").asText()).append(' ');
      }
      report.check("vector." + v[0] + ".sigs", "Java SDK secp256k1 signatures are byte-identical to the vector (RFC 6979, low s, v 27/28)", same, d.toString().trim());
    }
    CryptoKeyPair member = sm.generateRandomKeyPair();
    CryptoKeyPair other = sm.generateRandomKeyPair();
    String signer = base.ec.generateRandomKeyPair().getAddress();
    byte[] binding = Binding.sign(sm, member, signer);
    report.check("binding.roundtrip", "an SM2 binding verifies for its FISCO account and Base signer", Binding.verify(sm, binding, member.getAddress(), signer),
        binding.length + " bytes (r, s, public key)");
    report.check("binding.address", "the FISCO address is SM3(public key)[12..32]", Abi.sameAddress(Abi.hex(Binding.signerAddress(sm, binding)), member.getAddress()), member.getAddress());
    String otherSigner = base.ec.generateRandomKeyPair().getAddress();
    report.check("binding.otherSigner", "a binding does not verify for another Base signer", !Binding.verify(sm, binding, member.getAddress(), otherSigner), otherSigner);
    report.check("binding.otherAccount", "a binding signed by another SM2 key does not verify for this account",
        !Binding.verify(sm, Binding.sign(sm, other, signer), member.getAddress(), signer), other.getAddress());
    byte[] tampered = binding.clone();
    tampered[5] ^= 1;
    report.check("binding.tampered", "a tampered binding does not verify", !Binding.verify(sm, tampered, member.getAddress(), signer), "r bit flipped");
  }

  // ---------------------------------------------------------------- smoke

  final Path work;
  final Report report;
  final BaseDigest base = new BaseDigest();
  Chain chain;
  final Map<String, CryptoKeyPair> fisco = new LinkedHashMap<>();
  final Map<String, CryptoKeyPair> signer = new LinkedHashMap<>();
  final Map<String, String> at = new LinkedHashMap<>();

  SmSmoke(Path work, Report report) {
    this.work = work;
    this.report = report;
  }

  void run() throws Exception {
    Path config = work.resolve("sdk/config.toml");
    Files.createDirectories(config.getParent());
    Files.write(config, String.join("\n",
        "[cryptoMaterial]",
        "certPath = \"" + work.resolve("chain/nodes/10.97.0.10/sdk") + "\"",
        "useSMCrypto = \"true\"",
        "[network]",
        "messageTimeout = \"10000\"",
        "defaultGroup = \"group0\"",
        "peers = [\"10.97.0.10:20200\", \"10.97.0.11:20200\"]",
        "[account]",
        "keyStoreDir = \"" + work.resolve("sdk/account") + "\"",
        "accountFileFormat = \"pem\"",
        "").getBytes(StandardCharsets.UTF_8));
    try (Chain c = new Chain(config, work.resolve("contracts"))) {
      chain = c;
      for (String n : SM2_ACCOUNTS) fisco.put(n, chain.key(readKey(work, n + ".sm2")));
      for (String n : BASE_SIGNERS) signer.put(n, base.ec.getKeyPairFactory().createKeyPair(readKey(work, n + ".base")));
      connect();
      governance();
      compilerFacts();
      deploy();
      bindings();
      statusThroughTheBoard();
      auditLog();
      probeFacts();
      memberRotation();
    }
  }

  String addr(String name) {
    return fisco.get(name).getAddress();
  }

  String base(String name) {
    return signer.get(name).getAddress();
  }

  void connect() {
    report.check("chain.sm", "the SDK reaches the chain over SM-TLS and the chain is in SM crypto mode", chain.client.getCryptoType() == CryptoType.SM_TYPE,
        "cryptoType " + chain.client.getCryptoType() + ", chain " + chain.client.getChainId() + ", group " + chain.client.getGroup());
    report.check("chain.auth", "governance (auth) mode is on", chain.client.isAuthCheck(), "isAuthCheck " + chain.client.isAuthCheck());
    int sealers = chain.client.getSealerList().getSealerList().size();
    report.check("chain.sealers", "4 sealers", sealers == 4, sealers + " sealers, block " + chain.client.getBlockNumber().getBlockNumber());
    report.check("keys.sm2", "the FISCO accounts are SM2 (SM3-derived addresses)", fisco.get("bank").getCurveName().toLowerCase().contains("sm2"),
        fisco.get("bank").getCurveName());
  }

  /** Q22 order: governors, then rates 51/51, then the deploy whitelist; afterwards every proposal needs a second vote. */
  void governance() throws Exception {
    AuthManager bank = new AuthManager(chain.client, fisco.get("bank"));
    AuthManager reg = new AuthManager(chain.client, fisco.get("regulator"));
    String cm = "0x0000000000000000000000000000000000010001";
    Call.CallOutput genesis = chain.rawCall(cm, cm, chain.selector("_committee()"));
    report.info("rpc.block0", "native RPC call to the committee contract while the chain is at block 0",
        "block " + chain.client.getBlockNumber().getBlockNumber() + ", status " + genesis.getStatus() + ", output '" + genesis.getOutput() + "'"
            + ("0x".equals(genesis.getOutput()) ? " (empty: genesis system contracts answer from block 1, so the first read follows the first proposal)" : ""));
    BigInteger first = bank.updateGovernor(addr("regulator"), BigInteger.ONE);
    ProposalInfo p1 = bank.getProposalInfo(first);
    report.check("gov.admin", "the genesis committee is the bank's SM2 account alone (build_chain -a): its first proposal passes on its own vote",
        Abi.sameAddress(p1.getProposer(), addr("bank")) && p1.getAgreeVoters().size() == 1 && Abi.sameAddress(p1.getAgreeVoters().get(0), addr("bank"))
            && bank.getCommitteeInfo().getGovernorList().size() == 2,
        "proposal " + first + " " + p1.getStatusString() + ", agree " + p1.getAgreeVoters());
    bank.updateGovernor(addr("operator"), BigInteger.ONE);
    bank.setRate(BigInteger.valueOf(51), BigInteger.valueOf(51));
    vote(reg, bank.setDeployAuthType(AuthType.WHITE_LIST));
    vote(reg, bank.modifyDeployAuth(addr("deployer"), true));
    vote(reg, bank.modifyDeployAuth(addr("weid"), true));
    CommitteeInfo info = bank.getCommitteeInfo();
    List<String> after = governors(info);
    report.check("gov.governors", "bank, regulator and operator govern the chain, rates 51/51",
        after.size() == 3 && info.getParticipatesRate() == 51 && info.getWinRate() == 51, after.size() + " governors, rates " + info.getParticipatesRate() + "/" + info.getWinRate());
    BigInteger type = bank.getDeployAuthType();
    report.check("gov.whitelist", "deploys are whitelisted: deployer and WeIdentity admin only",
        type.equals(AuthType.WHITE_LIST.getValue()) && bank.checkDeployAuth(addr("deployer")) && bank.checkDeployAuth(addr("weid")) && !bank.checkDeployAuth(addr("stranger")),
        "deployType " + type);
    TransactionReceipt refused = chain.deploy(fisco.get("stranger"), "SmProbe");
    report.check("gov.refused", "a deploy from an account outside the whitelist is refused", refused.getStatus() != 0, "status " + refused.getStatus());
    TransactionReceipt adminDeploy = chain.deploy(fisco.get("bank"), "SmProbe");
    report.check("gov.adminNoDeploy", "the governance admin itself cannot deploy unless whitelisted (V2)", adminDeploy.getStatus() != 0, "status " + adminDeploy.getStatus());
  }

  void vote(AuthManager voter, BigInteger proposal) {
    TransactionReceipt r = voter.voteProposal(proposal, true);
    if (r.getStatus() != 0) throw new IllegalStateException("vote on proposal " + proposal + " failed: " + r.getStatus());
  }

  static List<String> governors(CommitteeInfo info) {
    List<String> out = new ArrayList<>();
    for (GovernorInfo g : info.getGovernorList()) out.add(g.getGovernorAddress());
    return out;
  }

  /** Selectors from the SM solc build (`--hashes`) against SM3 and keccak of the same signature. */
  void compilerFacts() throws Exception {
    String sig = "sign(uint256,bytes)";
    String line = Files.readAllLines(work.resolve("contracts/AgentStatus.signatures")).stream().filter(l -> l.trim().endsWith(sig)).findFirst().orElse("");
    String compiled = line.split(":")[0].trim();
    String sm3 = Hex.toHexString(chain.selector(sig));
    String keccak = Hex.toHexString(Arrays.copyOf(base.keccak(sig), 4));
    report.check("solc.selectors", "FISCO's SM solc derives selectors with SM3 (" + sig + ")", compiled.equals(sm3) && !sm3.equals(keccak),
        "SM solc " + compiled + ", SM3 " + sm3 + ", keccak " + keccak);
  }

  void deploy() {
    at.put("SmProbe", deployed("SmProbe"));
    at.put("MemberRegistry", deployed("MemberRegistry"));
    String reg = at.get("MemberRegistry");
    at.put("BaseOutbox", deployed("BaseOutbox", reg));
    String outbox = at.get("BaseOutbox");
    for (String b : new String[] {"AgentStatus", "AssetRegistry", "SanctionsList", "JurisdictionRules", "AttesterRegistry"}) at.put(b, deployed(b, reg, outbox));
    at.put("MandateRegistry", deployed("MandateRegistry", reg, outbox, at.get("AssetRegistry"), USDC));
    at.put("AuditLog", deployed("AuditLog", reg, outbox));
    for (String b : new String[] {"AgentStatus", "AssetRegistry", "SanctionsList", "JurisdictionRules", "AttesterRegistry", "MandateRegistry", "AuditLog"}) {
      ok(chain.send(fisco.get("deployer"), "BaseOutbox", outbox, "addBoard", at.get(b)), "addBoard " + b);
    }
    ok(chain.send(fisco.get("deployer"), "BaseOutbox", outbox, "seal"), "seal");
    report.check("deploy.all", "the SM build of the consortium contracts deploys with SM2-signed transactions (whitelisted deployer)", true,
        at.size() + " contracts, outbox sealed with 7 boards");
  }

  String deployed(String contract, Object... args) {
    TransactionReceipt r = chain.deploy(fisco.get("deployer"), contract, args);
    if (r.getStatus() != 0) throw new IllegalStateException("deploy " + contract + " status " + r.getStatus() + " " + r.getMessage());
    return r.getContractAddress();
  }

  static void ok(TransactionReceipt r, String what) {
    if (r.getStatus() != 0) throw new IllegalStateException(what + ": status " + r.getStatus() + " output " + r.getOutput());
  }

  /** Each member's SM2 binding over its Base signer: checked before submission, stored, read back and checked again. */
  void bindings() throws Exception {
    String reg = at.get("MemberRegistry");
    List<Object> members = new ArrayList<>();
    String[] roles = {"bank", "regulator", "operator"};
    boolean prechecked = true;
    for (String r : roles) {
      byte[] b = Binding.sign(chain.sm, fisco.get(r), base(r));
      prechecked &= Binding.verify(chain.sm, b, addr(r), base(r));
      members.add(Arrays.asList(addr(r), base(r), b));
    }
    report.check("binding.precheck", "each member's binding verifies before submission (the member service's check)", prechecked, "3 bindings");
    byte[] forged = Binding.sign(chain.sm, fisco.get("stranger"), base("bank"));
    report.check("binding.forged", "a binding signed by another SM2 account is refused before submission", !Binding.verify(chain.sm, forged, addr("bank"), base("bank")),
        "signed by " + addr("stranger"));
    ok(chain.send(fisco.get("deployer"), "MemberRegistry", reg, "bootstrap", members, HOOK, DOMAIN, addr("router"), addr("relayer")), "bootstrap");
    boolean readBack = true;
    StringBuilder d = new StringBuilder();
    for (int i = 0; i < 3; i++) {
      byte[] out = chain.call("MemberRegistry", reg, "memberOf", BigInteger.valueOf(i));
      int t = Abi.uintAt(out, 0).intValueExact();
      String fiscoAccount = Abi.addressAt(out, t);
      String baseSigner = Abi.addressAt(out, t + 32);
      byte[] binding = Abi.bytesAt(out, t + Abi.uintAt(out, t + 64).intValueExact());
      readBack &= Abi.sameAddress(fiscoAccount, addr(roles[i])) && Abi.sameAddress(baseSigner, base(roles[i])) && Binding.verify(chain.sm, binding, fiscoAccount, baseSigner);
      d.append(roles[i]).append(' ').append(binding.length).append("B ");
    }
    report.check("binding.stored", "MemberRegistry returns each member with its binding, which verifies against the stored FISCO account and Base signer", readBack,
        d.toString().trim());
    byte[] role = chain.call("MemberRegistry", reg, "roleOf", addr("regulator"));
    report.check("registry.roleOf", "roleOf(regulator's SM2 account) = (true, REGULATOR)", Abi.uintAt(role, 0).equals(BigInteger.ONE) && Abi.uintAt(role, 32).equals(BigInteger.ONE),
        Abi.uintAt(role, 0) + "," + Abi.uintAt(role, 32));
    Call.CallOutput dom = chain.rawCall(reg, reg, chain.encode("MemberRegistry", "domainSeparator"));
    report.check("registry.noDomain", "domainSeparator() reverts DomainOffChain (no SM3 domain is ever served)",
        dom.getStatus() != 0 && "DomainOffChain()".equals(chain.revertError(dom.getOutput(), ERRORS)), "status " + dom.getStatus());
  }

  Proposal proposal(String board, BigInteger id) {
    byte[] out = chain.call(board, at.get(board), "proposal", id);
    int t = Abi.uintAt(out, 0).intValueExact();
    Proposal p = new Proposal();
    p.kind = Abi.uintAt(out, t).intValueExact();
    p.status = Abi.uintAt(out, t + 32).intValueExact();
    p.nonce = Abi.uintAt(out, t + 64).longValueExact();
    p.required = Abi.uintAt(out, t + 192).intValueExact();
    p.fields = Abi.bytesAt(out, t + Abi.uintAt(out, t + 288).intValueExact());
    p.sigs = Abi.bytesArrayAt(out, t + Abi.uintAt(out, t + 320).intValueExact());
    p.signers = Abi.addressArrayAt(out, t + Abi.uintAt(out, t + 352).intValueExact());
    return p;
  }

  static final class Proposal {
    int kind;
    int status;
    long nonce;
    int required;
    byte[] fields;
    List<byte[]> sigs;
    List<String> signers;
  }

  BigInteger lastProposal(String board) {
    return Abi.uintAt(chain.call(board, at.get(board), "proposalCount"), 0);
  }

  BigInteger deadline(String board) {
    return Abi.uintAt(chain.call(board, at.get(board), "chainTimeSeconds"), 0).add(BigInteger.valueOf(3600));
  }

  /** A member service's submission: Base digest computed off-chain, its own signature checked, then sent. */
  TransactionReceipt submit(String member, String board, BigInteger id, String encodeType, byte[] fields) {
    byte[] digest = base.digest(DOMAIN, HOOK, encodeType, fields);
    byte[] sig = base.sign(signer.get(member), digest);
    if (!Abi.sameAddress(base.recover(digest, sig), base(member)) || !BaseDigest.lowS(sig)) throw new IllegalStateException("own signature check failed");
    return chain.send(fisco.get(member), board, at.get(board), "sign", id, sig);
  }

  List<String> memberSigners() {
    return Arrays.asList(base("bank"), base("regulator"), base("operator"));
  }

  void statusThroughTheBoard() throws Exception {
    String board = "AgentStatus";
    String account = "0x000000000000000000000000000000000000a11c";
    ok(chain.send(fisco.get("regulator"), board, at.get(board), "openStatus", account, BigInteger.valueOf(2), deadline(board)), "openStatus freeze");
    BigInteger id = lastProposal(board);
    Proposal p = proposal(board, id);
    byte[] fiscoRef = Abi.wordAt(p.fields, 128);
    byte[] sm3Ref = chain.sm.hash(Abi.concat(Abi.word(at.get(board)), Abi.word(id)));
    report.check("board.fiscoRef", "fiscoRef = SM3(abi.encode(board, proposalId)) on an SM chain (keccak in the main profile)", Arrays.equals(fiscoRef, sm3Ref),
        Abi.hex(fiscoRef));
    report.check("board.nonce", "the board allocates nonce stored + 1 and a 1-signature threshold for a freeze", p.nonce == 1 && p.required == 1 && p.status == 1,
        "nonce " + p.nonce + ", required " + p.required);
    Call.CallOutput dig = chain.rawCall(at.get(board), at.get(board), chain.encode(board, "digestOf", p.fields, BigInteger.ZERO));
    report.check("board.noDigest", "digestOf reverts DigestOffChain (members build the Base digest off-chain)",
        dig.getStatus() != 0 && "DigestOffChain()".equals(chain.revertError(dig.getOutput(), ERRORS)), "status " + dig.getStatus());
    TransactionReceipt stranger = submitAs("stranger", "regulator", board, id, p.fields);
    report.check("board.nonMember", "a non-member SM2 account cannot submit a signature (NotMember)", "NotMember()".equals(chain.revertError(stranger.getOutput(), ERRORS)),
        "status " + stranger.getStatus());
    ok(submit("regulator", board, id, BaseDigest.STATUS, p.fields), "regulator signs the freeze");
    p = proposal(board, id);
    byte[] digest = base.digest(DOMAIN, HOOK, BaseDigest.STATUS, p.fields);
    report.check("board.ready", "the regulator's signature alone makes the freeze Ready, stored under its Base signer",
        p.status == 2 && p.signers.size() == 1 && Abi.sameAddress(p.signers.get(0), base("regulator")), "status " + p.status + ", signers " + p.signers);
    report.check("board.statusOf", "statusOf(account) = FROZEN on FISCO", Abi.uintAt(chain.call(board, at.get(board), "statusOf", account), 0).intValue() == 2, account);
    Message m = message(0);
    report.check("outbox.freeze", "the outbox holds the attestation bytes and the opaque signature, and Base would accept them (keccak digest, ecrecover, member, threshold 1)",
        m.kind == 0 && Arrays.equals(m.payload, p.fields) && m.sigs.size() == 1 && base.accepts(digest, m.sigs, memberSigners(), 1), "outbox message 0");
    // Loosening back: two members, submitted in descending Base signer order so the board re-sorts them.
    ok(chain.send(fisco.get("bank"), board, at.get(board), "openStatus", account, BigInteger.ZERO, deadline(board)), "openStatus unfreeze");
    BigInteger id2 = lastProposal(board);
    Proposal q = proposal(board, id2);
    boolean bankHigh = new BigInteger(1, Abi.address(base("bank"))).compareTo(new BigInteger(1, Abi.address(base("operator")))) > 0;
    String first = bankHigh ? "bank" : "operator";
    String second = bankHigh ? "operator" : "bank";
    ok(submit(first, board, id2, BaseDigest.STATUS, q.fields), first + " signs the unfreeze");
    TransactionReceipt twice = submit(first, board, id2, BaseDigest.STATUS, q.fields);
    report.check("board.once", "a member submits once per proposal (AlreadySigned)", "AlreadySigned()".equals(chain.revertError(twice.getOutput(), ERRORS)),
        "status " + twice.getStatus());
    report.check("board.loosenOpen", "loosening stays open with one signature (threshold 2, nonce 2)", proposal(board, id2).status == 1 && q.nonce == 2 && q.required == 2,
        "required " + q.required);
    ok(submit(second, board, id2, BaseDigest.STATUS, q.fields), second + " signs the unfreeze");
    q = proposal(board, id2);
    byte[] d2 = base.digest(DOMAIN, HOOK, BaseDigest.STATUS, q.fields);
    report.check("board.sorted", "two signatures make it Ready, signers ascending, each signature recovering to its signer, Base would accept them",
        q.status == 2 && q.signers.size() == 2 && base.accepts(d2, q.sigs, memberSigners(), 2)
            && Abi.sameAddress(base.recover(d2, q.sigs.get(0)), q.signers.get(0)) && Abi.sameAddress(base.recover(d2, q.sigs.get(1)), q.signers.get(1)),
        "signers " + q.signers);
    report.check("board.unfrozen", "statusOf(account) = ACTIVE again and the outbox has both messages",
        Abi.uintAt(chain.call(board, at.get(board), "statusOf", account), 0).intValue() == 0 && outboxCount().intValue() == 2, "outbox count " + outboxCount());
  }

  /** `who` submits the signature `member` made: the board attributes it to `who` (or refuses a non-member). */
  TransactionReceipt submitAs(String who, String member, String board, BigInteger id, byte[] fields) {
    byte[] sig = base.sign(signer.get(member), base.digest(DOMAIN, HOOK, BaseDigest.STATUS, fields));
    return chain.send(fisco.get(who), board, at.get(board), "sign", id, sig);
  }

  BigInteger outboxCount() {
    return Abi.uintAt(chain.call("BaseOutbox", at.get("BaseOutbox"), "count"), 0);
  }

  static final class Message {
    int kind;
    byte[] payload;
    List<byte[]> sigs;
  }

  Message message(long id) {
    byte[] out = chain.call("BaseOutbox", at.get("BaseOutbox"), "message", BigInteger.valueOf(id));
    int t = Abi.uintAt(out, 0).intValueExact();
    Message m = new Message();
    m.kind = Abi.uintAt(out, t).intValueExact();
    m.payload = Abi.bytesAt(out, t + Abi.uintAt(out, t + 96).intValueExact());
    m.sigs = Abi.bytesArrayAt(out, t + Abi.uintAt(out, t + 128).intValueExact());
    return m;
  }

  /** The audit chain on an SM chain: head = SM3(abi.encode(head, entryHash)); then an anchor through the board. */
  void auditLog() throws Exception {
    String board = "AuditLog";
    String log = at.get(board);
    JsonNode vec = JSON.readTree(Paths.get("/vectors/audit-chain.json").toFile());
    byte[] e1 = Hex.decode(vec.get(0).get("entryHash").asText().substring(2));
    byte[] e2 = Hex.decode(vec.get(1).get("entryHash").asText().substring(2));
    byte[] zero = new byte[32];
    TransactionReceipt notOp = chain.send(fisco.get("bank"), board, log, "append", e1, BigInteger.ONE, "0x000000000000000000000000000000000000a11c", zero, zero);
    report.check("audit.onlyOperator", "only the operator's FISCO account appends (OnlyOperator)", "OnlyOperator()".equals(chain.revertError(notOp.getOutput(), ERRORS)),
        "status " + notOp.getStatus());
    ok(chain.send(fisco.get("operator"), board, log, "append", e1, BigInteger.ONE, "0x000000000000000000000000000000000000a11c", zero, zero), "append 1");
    ok(chain.send(fisco.get("operator"), board, log, "append", e2, BigInteger.valueOf(2), "0x000000000000000000000000000000000000a11c", zero, zero), "append 2");
    byte[] latest = chain.call(board, log, "latest");
    byte[] h1 = chain.sm.hash(Abi.concat(zero, e1));
    byte[] h2 = chain.sm.hash(Abi.concat(h1, e2));
    byte[] keccakHead = Hex.decode(vec.get(1).get("head").asText().substring(2));
    report.check("audit.sm3Chain", "the on-chain audit head is the SM3 chain of the entry hashes (seq 2)",
        Abi.uintAt(latest, 0).intValue() == 2 && Arrays.equals(Abi.wordAt(latest, 32), h2) && Arrays.equals(Abi.wordAt(chain.call(board, log, "headAt", BigInteger.ONE), 0), h1),
        Abi.hex(h2));
    report.check("audit.notKeccak", "it differs from the main profile's keccak head for the same entries (audit vector)", !Arrays.equals(h2, keccakHead),
        "keccak head " + Abi.hex(keccakHead));
    ok(chain.send(fisco.get("operator"), board, log, "openAnchor", deadline(board)), "openAnchor");
    BigInteger id = lastProposal(board);
    Proposal p = proposal(board, id);
    ok(submit("operator", board, id, BaseDigest.ANCHOR, p.fields), "operator signs the anchor");
    ok(submit("bank", board, id, BaseDigest.ANCHOR, p.fields), "bank signs the anchor");
    p = proposal(board, id);
    byte[] digest = base.digest(DOMAIN, HOOK, BaseDigest.ANCHOR, p.fields);
    report.check("audit.anchor", "the anchor (seq 1, the SM3 head) is Ready with 2 signatures Base would accept",
        p.status == 2 && Abi.uintAt(p.fields, 0).intValue() == 1 && Arrays.equals(Abi.wordAt(p.fields, 32), h2) && base.accepts(digest, p.sigs, memberSigners(), 2)
            && outboxCount().intValue() == 3,
        "anchored head " + Abi.hex(Abi.wordAt(p.fields, 32)));
  }

  /** What an SM chain computes: SHA3, selectors, the crypto precompile, ecrecover, sm2Verify. */
  void probeFacts() throws Exception {
    String probe = at.get("SmProbe");
    byte[] abc = "abc".getBytes(StandardCharsets.UTF_8);
    byte[] sha3 = Abi.wordAt(chain.call("SmProbe", probe, "sha3Of", abc), 0);
    report.check("evm.sha3", "the SHA3 opcode computes SM3 (keccak256(\"abc\") in Solidity returns SM3(\"abc\"))", Hex.toHexString(sha3).equals(SM3_ABC), Abi.hex(sha3));
    byte[] encoded = chain.encode("SmProbe", "sha3Of", abc);
    byte[] args = Arrays.copyOfRange(encoded, 4, encoded.length);
    Call.CallOutput keccakSel = chain.rawCall(probe, probe, Abi.concat(Arrays.copyOf(base.keccak("sha3Of(bytes)"), 4), args));
    Call.CallOutput sm3Sel = chain.rawCall(probe, probe, Abi.concat(chain.selector("sha3Of(bytes)"), args));
    report.check("evm.selectors", "the dispatcher answers the SM3 selector and refuses the keccak one", sm3Sel.getStatus() == 0 && keccakSel.getStatus() != 0,
        "SM3 selector status " + sm3Sel.getStatus() + ", keccak selector status " + keccakSel.getStatus());
    byte[] pk = probe(probe, "precompileKeccak", abc);
    report.info("precompile.keccak", "crypto precompile 0x100a keccak256Hash(\"abc\")", pk == null ? "call failed" : Abi.hex(pk) + (Hex.toHexString(pk).equals(KECCAK_ABC) ? " = keccak256" : " (not keccak256)"));
    byte[] ps = probe(probe, "precompileSm3", abc);
    report.info("precompile.sm3", "crypto precompile 0x100a sm3(\"abc\")", ps == null ? "call failed" : Abi.hex(ps) + (Hex.toHexString(ps).equals(SM3_ABC) ? " = SM3" : ""));
    byte[] digest = base.keccak("praetor sm smoke");
    byte[] sig = base.sign(signer.get("regulator"), digest);
    byte[] rec = probeRaw(probe, chain.encode("SmProbe", "recover", digest, BigInteger.valueOf(sig[64] & 0xff), Arrays.copyOfRange(sig, 0, 32), Arrays.copyOfRange(sig, 32, 64)));
    String recovered = rec == null ? null : Abi.addressAt(rec, 0);
    report.info("evm.ecrecover", "ecrecover (precompile 0x01) on an SM chain",
        recovered == null ? "call failed" : recovered + (Abi.sameAddress(recovered, base("regulator")) ? " = the secp256k1 signer" : " (not the signer)"));
    byte[] binding = Binding.sign(chain.sm, fisco.get("bank"), base("bank"));
    byte[] check = probeRaw(probe, chain.encode("SmProbe", "sm2Check", chain.sm.hash(Binding.message(base("bank"))), Arrays.copyOfRange(binding, 64, 128),
        Arrays.copyOfRange(binding, 0, 32), Arrays.copyOfRange(binding, 32, 64)));
    report.info("precompile.sm2Verify", "crypto precompile 0x100a sm2Verify on the bank's binding",
        check == null ? "call failed" : "ok=" + Abi.uintAt(check, 0) + " account=" + Abi.addressAt(check, 32) + (Abi.sameAddress(Abi.addressAt(check, 32), addr("bank")) ? " (the bank's FISCO account)" : ""));
  }

  byte[] probe(String probe, String fn, byte[] arg) {
    byte[] out = probeRaw(probe, chain.encode("SmProbe", fn, arg));
    return out == null ? null : Abi.wordAt(out, 0);
  }

  byte[] probeRaw(String probe, byte[] data) {
    Call.CallOutput out = chain.rawCall(probe, probe, data);
    return out.getStatus() == 0 ? Hex.decode(out.getOutput().replaceFirst("^0x", "")) : null;
  }

  /** A member changes its Base signer through the 2-of-3 change, with a fresh binding checked before submission. */
  void memberRotation() throws Exception {
    String reg = at.get("MemberRegistry");
    String newSigner = base("operator2");
    byte[] stale = Binding.sign(chain.sm, fisco.get("operator"), base("operator"));
    report.check("rotation.staleBinding", "the old binding does not cover the new Base signer (refused before submission)",
        !Binding.verify(chain.sm, stale, addr("operator"), newSigner), newSigner);
    byte[] binding = Binding.sign(chain.sm, fisco.get("operator"), newSigner);
    if (!Binding.verify(chain.sm, binding, addr("operator"), newSigner)) throw new IllegalStateException("fresh binding check failed");
    byte[] data = Abi.concat(Abi.word(2), Abi.word(addr("operator")), Abi.word(newSigner), Abi.word(128), Abi.word(binding.length), binding);
    ok(chain.send(fisco.get("operator"), "MemberRegistry", reg, "proposeChange", BigInteger.ZERO, data), "proposeChange");
    ok(chain.send(fisco.get("bank"), "MemberRegistry", reg, "approveChange", BigInteger.ZERO), "approveChange");
    byte[] out = chain.call("MemberRegistry", reg, "memberOf", BigInteger.valueOf(2));
    int t = Abi.uintAt(out, 0).intValueExact();
    byte[] stored = Abi.bytesAt(out, t + Abi.uintAt(out, t + 64).intValueExact());
    report.check("rotation.applied", "after 2 of 3 approvals the operator's new Base signer and its binding are stored and verify",
        Abi.sameAddress(Abi.addressAt(out, t + 32), newSigner) && Binding.verify(chain.sm, stored, Abi.addressAt(out, t), Abi.addressAt(out, t + 32)), newSigner);
  }

  // ---------------------------------------------------------------- report

  static final class Report {
    final List<ObjectNode> checks = new ArrayList<>();

    void check(String id, String what, boolean ok, String detail) {
      add(id, what, ok ? "PASS" : "FAIL", detail);
    }

    void info(String id, String what, String detail) {
      add(id, what, "INFO", detail);
    }

    private void add(String id, String what, String result, String detail) {
      ObjectNode n = JSON.createObjectNode();
      n.put("id", id).put("check", what).put("result", result).put("detail", detail);
      checks.add(n);
      System.out.printf("%-4s %-22s %s%n     %s%n", result, id, what, detail);
    }

    long failed() {
      return checks.stream().filter(c -> c.get("result").asText().equals("FAIL")).count();
    }

    void print(String mode) {
      long pass = checks.stream().filter(c -> c.get("result").asText().equals("PASS")).count();
      long info = checks.stream().filter(c -> c.get("result").asText().equals("INFO")).count();
      System.out.printf("%s: %d PASS, %d FAIL, %d INFO%n", mode, pass, failed(), info);
    }

    void write(Path file) throws Exception {
      ArrayNode a = JSON.createArrayNode();
      checks.forEach(a::add);
      JSON.writerWithDefaultPrettyPrinter().writeValue(file.toFile(), a);
    }
  }
}
