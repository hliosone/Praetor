package praetor.weid;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.webank.weid.blockchain.protocol.response.ResponseData;
import com.webank.weid.blockchain.protocol.response.TransactionInfo;
import com.webank.weid.protocol.base.ClaimPolicy;
import com.webank.weid.protocol.base.CredentialPojo;
import com.webank.weid.protocol.base.EvidenceInfo;
import com.webank.weid.protocol.base.WeIdAuthentication;
import com.webank.weid.protocol.base.WeIdPrivateKey;
import com.webank.weid.service.impl.AuthorityIssuerServiceImpl;
import com.webank.weid.service.impl.CredentialPojoServiceImpl;
import com.webank.weid.service.impl.EvidenceServiceImpl;
import com.webank.weid.service.impl.WeIdServiceImpl;
import com.webank.weid.service.rpc.AuthorityIssuerService;
import com.webank.weid.service.rpc.CredentialPojoService;
import com.webank.weid.service.rpc.EvidenceService;
import com.webank.weid.service.rpc.WeIdService;
import com.webank.weid.util.DataToolUtils;
import com.webank.weid.util.WeIdUtils;

/**
 * Small HTTP API over the WeIdentity SDK for the operations the REST service lacks: the bank's countersignature of
 * a user-signed credential, evidence (create, read, revoke), revocation-aware verification (the SDK's verify
 * ignores revocation, V3), selective disclosure and the bank's issuer setup. Keys are the REST service's custodial
 * key files (same volume, keyed by address) or the admin key; none is ever returned or logged. Docker network only.
 */
public final class Helper {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final WeIdService WEID = new WeIdServiceImpl();
    private static final CredentialPojoService CREDS = new CredentialPojoServiceImpl();
    private static final EvidenceService EVIDENCE = new EvidenceServiceImpl();
    private static final AuthorityIssuerService ISSUERS = new AuthorityIssuerServiceImpl();
    private static Path keysDir;
    private static Path adminKeyFile;

    private Helper() {}

    public static void main(String[] args) throws Exception {
        keysDir = Paths.get(env("WEID_KEYS_DIR", "/weid/keys"));
        adminKeyFile = Paths.get(env("WEID_ADMIN_KEY_FILE", "/app/private_key"));
        HttpServer server = HttpServer.create(new InetSocketAddress(Integer.parseInt(env("PORT", "6100"))), 0);
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.createContext("/health", ex -> handle(ex, body -> health()));
        server.createContext("/issuers/setup", ex -> handle(ex, Helper::issuerSetup));
        server.createContext("/credentials/countersign", ex -> handle(ex, Helper::countersign));
        server.createContext("/credentials/verify", ex -> handle(ex, Helper::verify));
        server.createContext("/credentials/selective", ex -> handle(ex, Helper::selective));
        server.createContext("/evidence/create", ex -> handle(ex, Helper::createEvidence));
        server.createContext("/evidence/get", ex -> handle(ex, Helper::getEvidence));
        server.createContext("/evidence/revoke", ex -> handle(ex, Helper::revoke));
        server.start();
        System.out.println("weid-helper listening");
    }

    interface Op {
        Map<String, Object> run(JsonNode body) throws Exception;
    }

    private static void handle(HttpExchange ex, Op op) throws IOException {
        int status = 200;
        Map<String, Object> out;
        try (InputStream in = ex.getRequestBody()) {
            byte[] raw = in.readAllBytes();
            JsonNode body = raw.length == 0 ? JSON.createObjectNode() : JSON.readTree(raw);
            out = op.run(body);
        } catch (IllegalArgumentException e) {
            status = 400;
            out = map("error", e.getMessage());
        } catch (Exception e) {
            status = 500;
            out = map("error", e.getClass().getSimpleName() + ": " + e.getMessage());
        }
        byte[] bytes = JSON.writeValueAsBytes(out);
        ex.getResponseHeaders().add("content-type", "application/json");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static Map<String, Object> health() throws IOException {
        String admin = WeIdUtils.getWeIdFromPrivateKey(readKey(adminKeyFile));
        ResponseData<Boolean> r = WEID.isWeIdExist(admin);
        return map("ok", r.getErrorCode() == 0 && Boolean.TRUE.equals(r.getResult()));
    }

    /** Admin registers the KYC_PROVIDER issuer type, recognizes the bank as authority issuer and adds it to the type. */
    private static Map<String, Object> issuerSetup(JsonNode b) throws Exception {
        String bank = text(b, "bankWeId");
        WeIdAuthentication admin = auth(readKey(adminKeyFile));
        ResponseData<Boolean> type = ISSUERS.registerIssuerType(admin, "KYC_PROVIDER");
        ResponseData<Boolean> recognized = ISSUERS.recognizeAuthorityIssuer(bank, pk(readKey(adminKeyFile)));
        ResponseData<Boolean> added = ISSUERS.addIssuerIntoIssuerType(admin, "KYC_PROVIDER", bank);
        boolean isIssuer = Boolean.TRUE.equals(ISSUERS.isAuthorityIssuer(bank).getResult());
        boolean inType = Boolean.TRUE.equals(ISSUERS.isSpecificTypeIssuer("KYC_PROVIDER", bank).getResult());
        return map("authorityIssuer", isIssuer, "kycProvider", inType, "typeTx", tx(type), "recognizeTx", tx(recognized), "addTx", tx(added));
    }

    /** The bank's signature over a credential the user already signed (AgentMandate: user + bank, spec 05). */
    private static Map<String, Object> countersign(JsonNode b) throws Exception {
        CredentialPojo inner = CredentialPojo.fromJson(JSON.writeValueAsString(b.get("credential")));
        String signer = text(b, "signerWeId");
        List<CredentialPojo> list = new ArrayList<>();
        list.add(inner);
        ResponseData<CredentialPojo> r = CREDS.addSignature(list, auth(custodialKey(signer)));
        if (r.getErrorCode() != 0) return map("error", r.getErrorMessage(), "errorCode", r.getErrorCode());
        CredentialPojo outer = r.getResult();
        return map("credential", JSON.readTree(outer.toJson()), "hash", outer.getHash());
    }

    /** Valid = signature (and embedded signatures) good, not expired, evidence found, and the issuer's revocation flag
     *  read without error and false. The SDK's verify alone ignores revocation (V3), and a credential without evidence
     *  could never be revoked, so both fail closed. evidenceHash: the full credential's evidence, for a
     *  selective-disclosure copy (its own hash differs). signatureOnly: the inner credential of a countersigned one,
     *  whose revocation is the outer credential's evidence. */
    private static Map<String, Object> verify(JsonNode b) throws Exception {
        CredentialPojo c = CredentialPojo.fromJson(JSON.writeValueAsString(b.get("credential")));
        String issuer = text(b, "issuerWeId");
        ResponseData<Boolean> sig = CREDS.verify(issuer, c);
        boolean sigOk = sig.getErrorCode() == 0 && Boolean.TRUE.equals(sig.getResult());
        if (b.path("signatureOnly").asBoolean(false)) {
            return map("valid", sigOk, "signature", sigOk, "signatureError", sig.getErrorMessage(), "revoked", false, "evidence", false);
        }
        String hash = b.hasNonNull("evidenceHash") ? b.get("evidenceHash").asText() : c.getHash();
        ResponseData<EvidenceInfo> ev = EVIDENCE.getEvidence(hash);
        // The issuer itself must have signed the evidence (signInfo is keyed by address, V3): only then is its
        // revocation flag the one that counts.
        String issuerAddress = issuer.substring(issuer.lastIndexOf(':') + 1);
        boolean found = ev.getErrorCode() == 0 && ev.getResult() != null && ev.getResult().getSignInfo() != null
            && ev.getResult().getSignInfo().containsKey(issuerAddress);
        Boolean revoked = null;
        if (found) {
            ResponseData<Boolean> rv = EVIDENCE.isRevoked(ev.getResult(), issuer);
            if (rv.getErrorCode() == 0 && rv.getResult() != null) revoked = rv.getResult();
        }
        boolean valid = sigOk && found && Boolean.FALSE.equals(revoked);
        return map("valid", valid, "signature", sigOk, "signatureError", sig.getErrorMessage(),
            "revoked", Boolean.TRUE.equals(revoked), "evidence", found, "hash", hash);
    }

    private static Map<String, Object> selective(JsonNode b) throws Exception {
        CredentialPojo c = CredentialPojo.fromJson(JSON.writeValueAsString(b.get("credential")));
        Map<String, Integer> fields = new HashMap<>();
        for (JsonNode f : b.get("fields")) fields.put(f.asText(), 1);
        ClaimPolicy policy = new ClaimPolicy();
        policy.setFieldsToBeDisclosed(JSON.writeValueAsString(fields));
        ResponseData<CredentialPojo> r = CREDS.createSelectiveCredential(c, policy);
        if (r.getErrorCode() != 0) return map("error", r.getErrorMessage(), "errorCode", r.getErrorCode());
        return map("credential", JSON.readTree(r.getResult().toJson()));
    }

    private static Map<String, Object> createEvidence(JsonNode b) throws Exception {
        CredentialPojo c = CredentialPojo.fromJson(JSON.writeValueAsString(b.get("credential")));
        ResponseData<String> r = EVIDENCE.createEvidence(c, pk(custodialKey(text(b, "signerWeId"))));
        if (r.getErrorCode() != 0) return map("error", r.getErrorMessage(), "errorCode", r.getErrorCode());
        return map("hash", r.getResult(), "tx", tx(r));
    }

    private static Map<String, Object> getEvidence(JsonNode b) throws Exception {
        ResponseData<EvidenceInfo> r = EVIDENCE.getEvidence(text(b, "hash"));
        if (r.getErrorCode() != 0 || r.getResult() == null) return map("found", false, "error", r.getErrorMessage());
        return map("found", true, "evidence", JSON.readTree(DataToolUtils.serialize(r.getResult())));
    }

    private static Map<String, Object> revoke(JsonNode b) throws Exception {
        CredentialPojo c = CredentialPojo.fromJson(JSON.writeValueAsString(b.get("credential")));
        ResponseData<Boolean> r = EVIDENCE.revoke(c, auth(custodialKey(text(b, "signerWeId"))));
        return map("revoked", r.getErrorCode() == 0 && Boolean.TRUE.equals(r.getResult()), "tx", tx(r), "error", r.getErrorMessage());
    }

    // ------------------------------------------------------------------------------------------------ helpers

    /** The REST service stores each hosted key under the WeID's address (the part after the last colon). */
    private static String custodialKey(String weId) throws IOException {
        String address = weId.substring(weId.lastIndexOf(':') + 1);
        if (!address.matches("0x[0-9a-fA-F]{40}")) throw new IllegalArgumentException("bad WeID " + weId);
        Path p = keysDir.resolve(address);
        if (!Files.exists(p)) {
            String admin = readKey(adminKeyFile);
            if (WeIdUtils.getWeIdFromPrivateKey(admin).equals(weId)) return admin;
            throw new IllegalArgumentException("no hosted key for " + weId);
        }
        return readKey(p);
    }

    private static String readKey(Path p) throws IOException {
        return new String(Files.readAllBytes(p), StandardCharsets.UTF_8).trim();
    }

    private static WeIdPrivateKey pk(String decimal) {
        WeIdPrivateKey k = new WeIdPrivateKey();
        k.setPrivateKey(decimal);
        return k;
    }

    private static WeIdAuthentication auth(String decimal) {
        String weId = WeIdUtils.getWeIdFromPrivateKey(decimal);
        return new WeIdAuthentication(weId, decimal, weId + "#keys-" + DataToolUtils.publicKeyStrFromPrivate(new BigInteger(decimal)));
    }

    private static String tx(ResponseData<?> r) {
        TransactionInfo t = r == null ? null : r.getTransactionInfo();
        return t == null ? null : t.getTransactionHash();
    }

    private static String text(JsonNode b, String field) {
        JsonNode v = b.get(field);
        if (v == null || v.asText().isEmpty()) throw new IllegalArgumentException("missing " + field);
        return v.asText();
    }

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isEmpty() ? d : v;
    }
}
