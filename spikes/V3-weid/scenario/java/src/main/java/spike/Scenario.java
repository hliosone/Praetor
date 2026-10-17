package spike;

import java.io.FileInputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import com.webank.weid.blockchain.protocol.response.TransactionInfo;
import com.webank.weid.protocol.base.AuthorityIssuer;
import com.webank.weid.protocol.base.ClaimPolicy;
import com.webank.weid.protocol.base.CredentialPojo;
import com.webank.weid.protocol.base.EvidenceInfo;
import com.webank.weid.protocol.base.WeIdAuthentication;
import com.webank.weid.protocol.base.WeIdPrivateKey;
import com.webank.weid.protocol.request.AuthenticationArgs;
import com.webank.weid.protocol.request.CreateCredentialPojoArgs;
import com.webank.weid.protocol.request.RegisterAuthorityIssuerArgs;
import com.webank.weid.protocol.request.ServiceArgs;
import com.webank.weid.blockchain.protocol.response.ResponseData;
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
 * Scenario steps that WeIdentity-Rest-Service 1.7.0 has no endpoint for, run directly
 * against weid-java-sdk 3.1.1-rc.2.
 *
 * Vocabulary:
 *  - WeIdAuthentication: (WeID, private key, verification-method id) bundle the SDK signs with.
 *  - ResponseData: SDK envelope {result, errorCode, errorMessage, transactionInfo}; the tx hash
 *    of a write is in transactionInfo.transactionHash (null for reads / pre-chain failures).
 *  - evidence: on-chain record keyed by a credential hash; holds per-signer signature, logs and
 *    a "revoked" flag. It is the only revocation mechanism used here.
 *
 * Input: state.properties written by scenario.sh phase 1. Output: JSON files + results.tsv rows
 * in the same out dir. Private keys are read from files and never printed.
 */
public class Scenario {

    private static String out;
    private static FileWriter results;

    public static void main(String[] args) throws Exception {
        Properties st = new Properties();
        try (FileInputStream in = new FileInputStream(args[0])) { st.load(in); }
        out = st.getProperty("out");
        results = new FileWriter(out + "/results.tsv", true);

        String bank = st.getProperty("bank");
        String user = st.getProperty("user");
        String agent = st.getProperty("agent");
        String keys = st.getProperty("restKeysDir");
        String adminKey = readKey(st.getProperty("adminKeyFile"));
        String bankKey = readKey(keys + "/" + addr(bank));
        String userKey = readKey(keys + "/" + addr(user));
        String agentKey = readKey(st.getProperty("agentKeyFile"));
        String admin = WeIdUtils.getWeIdFromPrivateKey(adminKey);
        System.out.println("STEP admin WeID (derived from REST admin key) = " + admin);
        if (!agent.equals(WeIdUtils.getWeIdFromPrivateKey(agentKey))) {
            System.out.println("ERR agent key does not match agent WeID");
        }

        WeIdAuthentication adminAuth = auth(adminKey);
        WeIdAuthentication bankAuth = auth(bankKey);
        WeIdAuthentication userAuth = auth(userKey);

        WeIdService weIdService = new WeIdServiceImpl();
        AuthorityIssuerService issuerService = new AuthorityIssuerServiceImpl();
        CredentialPojoService credService = new CredentialPojoServiceImpl();
        EvidenceService evidenceService = new EvidenceServiceImpl();

        // ---------------------------------------------------------------- a3 issuer type
        ResponseData<Boolean> rIt = issuerService.registerIssuerType(adminAuth, "KYC_PROVIDER");
        boolean typeOk = ok(rIt) || rIt.getErrorMessage().toLowerCase().contains("exist");
        rec("a3a", "SDK", typeOk, tx(rIt), "registerIssuerType(KYC_PROVIDER) by admin: "
            + rIt.getErrorCode() + " " + rIt.getErrorMessage() + " (already-exists counts as ok on re-runs)");
        ResponseData<Boolean> rIsAi = issuerService.isAuthorityIssuer(bank);
        rec("a2-check", "SDK", Boolean.TRUE.equals(rIsAi.getResult()), "(read)",
            "isAuthorityIssuer(bank)=" + rIsAi.getResult() + " (true only after admin recognizeAuthorityIssuer)");

        // ---------------------------------------------------------------- e3 service entries
        ServiceArgs svcWallet = new ServiceArgs();
        svcWallet.setType("AgentWallet");
        svcWallet.setServiceEndpoint("eip155:84532:0x0000000000000000000000000000000000001234");
        ResponseData<Boolean> rS1 = weIdService.setService(agent, svcWallet, pk(agentKey));
        ServiceArgs svcMcp = new ServiceArgs();
        svcMcp.setType("MCP");
        svcMcp.setServiceEndpoint("https://example.invalid/mcp");
        ResponseData<Boolean> rS2 = weIdService.setService(agent, svcMcp, pk(agentKey));
        rec("e3", "SDK", ok(rS1) && ok(rS2), tx(rS1) + "," + tx(rS2),
            "setService AgentWallet: " + rS1.getErrorMessage() + "; MCP: " + rS2.getErrorMessage());

        // ---------------------------------------------------------------- e4 recovery / controller
        // WeIdentity 3.x has no "recovery" concept. The closest is a verification method in the
        // agent's document whose controller is the user's WeID, added with the agent's own key.
        AuthenticationArgs ctl = new AuthenticationArgs();
        ctl.setController(user);
        ctl.setPublicKey(DataToolUtils.publicKeyStrFromPrivate(new BigInteger(userKey)));
        ResponseData<Boolean> rCtl = weIdService.setAuthentication(agent, ctl, pk(agentKey));
        rec("e4", "SDK", ok(rCtl), tx(rCtl), "setAuthentication(agent, {controller=user, publicKey=user's}) signed by agent: "
            + rCtl.getErrorCode() + " " + rCtl.getErrorMessage()
            + ". Whether the user can then UPDATE the agent doc is tested in j4b");

        // ---------------------------------------------------------------- e5 read back
        ResponseData<String> rDoc = weIdService.getWeIdDocumentJson(agent);
        write("agent_did_document.json", rDoc.getResult());
        String doc = rDoc.getResult() == null ? "" : rDoc.getResult();
        rec("e5", "SDK", doc.contains("AgentWallet") && doc.contains("\"MCP\"") && doc.contains(user), "(read)",
            "agent_did_document.json (services + user-controlled verification method present)");

        // ---------------------------------------------------------------- f3 selective disclosure
        CredentialPojo kyc = CredentialPojo.fromJson(read("credential_kyc_full.json"));
        ResponseData<Boolean> rVk = credService.verify(bank, kyc);
        rec("f2-sdk", "SDK", ok(rVk), "(read)", "SDK verify(full KYC) = " + rVk.getResult());
        ClaimPolicy policy = new ClaimPolicy();
        policy.setFieldsToBeDisclosed("{\"jurisdiction\":1,\"ageOver18\":1}");
        ResponseData<CredentialPojo> rSel = credService.createSelectiveCredential(kyc, policy);
        boolean selOk = ok(rSel);
        if (selOk) {
            write("credential_kyc_selective.json", rSel.getResult().toJson());
            ResponseData<Boolean> rVs = credService.verify(bank, rSel.getResult());
            Map<String, Object> c = rSel.getResult().getClaim();
            selOk = ok(rVs);
            rec("f3", "SDK", selOk, "(off-chain)", "createSelectiveCredential(jurisdiction, ageOver18) -> verify="
                + rVs.getResult() + " " + rVs.getErrorMessage() + "; hidden fields become hashes, e.g. kycLevel="
                + String.valueOf(c.get("kycLevel")).substring(0, Math.min(20, String.valueOf(c.get("kycLevel")).length())) + "...");
        } else {
            rec("f3", "SDK", false, "", "createSelectiveCredential: " + rSel.getErrorCode() + " " + rSel.getErrorMessage());
        }

        // ---------------------------------------------------------------- g2/g3 add bank signature
        CredentialPojo mandate = CredentialPojo.fromJson(read("credential_mandate_user_signed.json"));
        List<CredentialPojo> list = new ArrayList<>();
        list.add(mandate);
        ResponseData<CredentialPojo> rMs = credService.addSignature(list, bankAuth);
        if (ok(rMs)) {
            CredentialPojo ms = rMs.getResult();
            write("credential_mandate_multisigned.json", ms.toJson());
            ResponseData<Boolean> rVms = credService.verify(bank, ms);
            // the user's original credential is embedded in claim.credentialList
            ResponseData<Boolean> rVinner = credService.verify(user, mandate);
            String inner = String.valueOf(ms.getClaim().get("credentialList"));
            boolean both = ok(rVms) && ok(rVinner) && inner.contains(user) && bank.equals(ms.getIssuer());
            rec("g2", "SDK", true, "(off-chain)", "addSignature(bank) -> outer cptId=" + ms.getCptId()
                + " issuer=bank, embeds user-signed original");
            rec("g3", "SDK", both, "(off-chain)", "verify(multi-signed, bank)=" + rVms.getResult() + " " + rVms.getErrorMessage()
                + "; verify(inner, user)=" + rVinner.getResult());
            // j-extra: tamper the embedded inner claim -> outer verify must fail
            String msTampered = ms.toJson().replace("\"balanced\"", "\"growth\"");
            ResponseData<Boolean> rVt = credService.verify(bank, CredentialPojo.fromJson(msTampered));
            rec("j2b", "SDK", !ok(rVt), "(read)", "tampered inner riskProfile of multi-signed credential -> verify="
                + rVt.getResult() + " " + rVt.getErrorCode() + " " + rVt.getErrorMessage());
            // j-extra: addSignature's key/WeID match check is commented out in the SDK; sign as "bank" with user's key
            WeIdAuthentication forged = new WeIdAuthentication(bank, userKey, bankAuth.getAuthenticationMethodId());
            ResponseData<CredentialPojo> rForge = credService.addSignature(list, forged);
            if (ok(rForge)) {
                ResponseData<Boolean> rVf = credService.verify(bank, rForge.getResult());
                rec("j5", "SDK", !ok(rVf), "(read)", "addSignature claiming bank WeID but signed with user key: created, verify="
                    + rVf.getResult() + " " + rVf.getErrorCode() + " " + rVf.getErrorMessage());
            } else {
                rec("j5", "SDK", true, "(read)", "addSignature with mismatched key refused: " + rForge.getErrorMessage());
            }
        } else {
            rec("g2", "SDK", false, "", "addSignature: " + rMs.getErrorCode() + " " + rMs.getErrorMessage());
        }

        // ---------------------------------------------------------------- h evidence
        ResponseData<String> rEv = evidenceService.createEvidence(kyc, pk(bankKey));
        String evHash = rEv.getResult();
        rec("h1", "SDK", evHash != null && !evHash.isEmpty(), tx(rEv), "createEvidence(PersonKYC, bank key) hash=" + evHash
            + " (credential.getHash()=" + kyc.getHash() + ")");
        if (evHash != null && !evHash.isEmpty()) {
            write("evidence_hash.txt", evHash);
            ResponseData<EvidenceInfo> rGe = evidenceService.getEvidence(evHash);
            write("evidence_before_revoke.json", DataToolUtils.serialize(rGe.getResult()));
            // signInfo is keyed by the signer's ADDRESS, not its WeID
            boolean signedByBank = rGe.getResult() != null && rGe.getResult().getSignInfo().containsKey(addr(bank));
            rec("h2", "SDK", ok(rGe) && signedByBank, "(read)", "getEvidence -> signers=" +
                (rGe.getResult() == null ? "null" : rGe.getResult().getSignInfo().keySet()));

            // ------------------------------------------------------------ i revocation
            ResponseData<Boolean> rRv = evidenceService.revoke(kyc, bankAuth);
            ResponseData<EvidenceInfo> rGe2 = evidenceService.getEvidence(evHash);
            write("evidence_after_revoke.json", DataToolUtils.serialize(rGe2.getResult()));
            ResponseData<Boolean> rIr = evidenceService.isRevoked(rGe2.getResult(), bank);
            ResponseData<Boolean> rVafter = credService.verify(bank, kyc);
            rec("i1", "SDK", ok(rRv), tx(rRv), "evidence revoke(PersonKYC, bank): " + rRv.getErrorMessage());
            rec("i2", "SDK", Boolean.TRUE.equals(rIr.getResult()), "(read)", "isRevoked(evidence, bank)=" + rIr.getResult()
                + "; NOTE credentialPojoService.verify() after revoke still = " + rVafter.getResult()
                + " (verify does not consult evidence)");
        }

        // ---------------------------------------------------------------- j1 non-admin registers issuer
        AuthorityIssuer ai = new AuthorityIssuer();
        ai.setWeId(user);
        ai.setName("Evil SDK " + st.getProperty("run"));
        ai.setAccValue("1");
        RegisterAuthorityIssuerArgs ra = new RegisterAuthorityIssuerArgs();
        ra.setAuthorityIssuer(ai);
        ra.setWeIdPrivateKey(pk(userKey));
        ResponseData<Boolean> rJ1 = issuerService.registerAuthorityIssuer(ra);
        // 3.x model: anyone may REGISTER (unrecognized); only the committee can RECOGNIZE.
        ResponseData<Boolean> rJ1r = issuerService.recognizeAuthorityIssuer(user, pk(userKey));
        ResponseData<Boolean> rJ1i = issuerService.isAuthorityIssuer(user);
        rec("j1a", "SDK", true, tx(rJ1), "INFO user (non-admin) registerAuthorityIssuer(self) -> " + rJ1.getResult() + " "
            + rJ1.getErrorCode() + " " + rJ1.getErrorMessage() + " (registration is open; entry is unrecognized)");
        rec("j1b", "SDK", !ok(rJ1r) && !Boolean.TRUE.equals(rJ1i.getResult()), tx(rJ1r),
            "user tries recognizeAuthorityIssuer(self) -> " + rJ1r.getResult() + " " + rJ1r.getErrorCode() + " "
            + rJ1r.getErrorMessage() + "; isAuthorityIssuer(user)=" + rJ1i.getResult());
        ResponseData<Boolean> rJ6 = issuerService.addIssuerIntoIssuerType(userAuth, "KYC_PROVIDER", user);
        ResponseData<Boolean> rJ6i = issuerService.isSpecificTypeIssuer("KYC_PROVIDER", user);
        rec("j6", "SDK", !ok(rJ6) && !Boolean.TRUE.equals(rJ6i.getResult()), tx(rJ6),
            "user tries addIssuerIntoIssuerType(KYC_PROVIDER, self) -> " + rJ6.getResult() + " " + rJ6.getErrorCode()
            + " " + rJ6.getErrorMessage() + "; isSpecificTypeIssuer(user)=" + rJ6i.getResult());

        // ---------------------------------------------------------------- j2 tamper
        CredentialPojo tampered = CredentialPojo.fromJson(read("credential_kyc_full.json"));
        tampered.getClaim().put("jurisdiction", "US");
        ResponseData<Boolean> rJ2 = credService.verify(bank, tampered);
        rec("j2", "SDK", !ok(rJ2), "(read)", "jurisdiction HK->US after issuance -> verify=" + rJ2.getResult() + " "
            + rJ2.getErrorCode() + " " + rJ2.getErrorMessage());

        // ---------------------------------------------------------------- j3 expired
        CreateCredentialPojoArgs<Map<String, Object>> ca = new CreateCredentialPojoArgs<>();
        ca.setCptId(Integer.valueOf(st.getProperty("kycCpt")));
        ca.setIssuer(bank);
        ca.setExpirationDate(System.currentTimeMillis() + 3000L);
        ca.setClaim(kyc.getClaim());
        ca.setWeIdAuthentication(bankAuth);
        ResponseData<CredentialPojo> rExp = credService.createCredential(ca);
        if (ok(rExp)) {
            // DataToolUtils.serialize = the REST wire format (epoch-second dates). toJson() (ISO dates,
            // "$from") is NOT always accepted back by REST verifyCredentialPojo for this credential.
            write("credential_expired.json", DataToolUtils.serialize(rExp.getResult()));
            write("credential_expired.tojson.json", rExp.getResult().toJson());
            ResponseData<Boolean> rV0 = credService.verify(bank, rExp.getResult());
            Thread.sleep(6000);
            ResponseData<Boolean> rV1 = credService.verify(bank, rExp.getResult());
            rec("j3", "SDK", ok(rV0) && !ok(rV1), "(read)", "expiry=+3s: verify before=" + rV0.getResult() + ", after 6s="
                + rV1.getResult() + " " + rV1.getErrorCode() + " " + rV1.getErrorMessage());
        } else {
            rec("j3", "SDK", false, "", "createCredential(+3s expiry): " + rExp.getErrorCode() + " " + rExp.getErrorMessage());
        }

        // ---------------------------------------------------------------- j4 wrong-key DID update
        String strangerKey = new BigInteger(1, randomBytes()).toString();
        ServiceArgs evil = new ServiceArgs();
        evil.setType("AgentWallet");
        evil.setServiceEndpoint("eip155:84532:0x000000000000000000000000000000000000dEaD");
        ResponseData<Boolean> rJ4a = weIdService.setService(agent, evil, pk(strangerKey));
        rec("j4a", "SDK", !ok(rJ4a), tx(rJ4a), "setService(agent) signed by random key -> " + rJ4a.getResult() + " "
            + rJ4a.getErrorCode() + " " + rJ4a.getErrorMessage());
        ResponseData<Boolean> rJ4b = weIdService.setService(agent, evil, pk(userKey));
        rec("j4b", "SDK", !ok(rJ4b), tx(rJ4b), "setService(agent) signed by USER key (user is controller of a verification"
            + " method on agent doc) -> " + rJ4b.getResult() + " " + rJ4b.getErrorCode() + " " + rJ4b.getErrorMessage()
            + " => controller field is NOT an on-chain update/recovery right");
        String after = weIdService.getWeIdDocumentJson(agent).getResult();
        rec("j4c", "SDK", after != null && !after.contains("dEaD"), "(read)", "agent doc unchanged after rejected updates");

        results.close();
        System.out.println("STEP java phase done");
        System.exit(0);
    }

    // ------------------------------------------------------------------------------ helpers
    private static boolean ok(ResponseData<?> r) {
        return r != null && r.getErrorCode() != null && r.getErrorCode() == 0
            && r.getResult() != null && !Boolean.FALSE.equals(r.getResult());
    }

    private static String tx(ResponseData<?> r) {
        TransactionInfo t = r == null ? null : r.getTransactionInfo();
        return t == null || t.getTransactionHash() == null ? "" : t.getTransactionHash();
    }

    private static void rec(String step, String path, boolean pass, String txs, String note) throws IOException {
        String line = step + "\t" + path + "\t" + (pass ? "PASS" : "FAIL") + "\t" + txs + "\t" + note.replace('\t', ' ').replace('\n', ' ');
        System.out.println("RESULT " + line);
        results.write(line + "\n");
        results.flush();
    }

    private static WeIdAuthentication auth(String key) {
        String weId = WeIdUtils.getWeIdFromPrivateKey(key);
        return new WeIdAuthentication(weId, key,
            weId + "#keys-" + DataToolUtils.publicKeyStrFromPrivate(new BigInteger(key)));
    }

    private static WeIdPrivateKey pk(String key) {
        WeIdPrivateKey p = new WeIdPrivateKey();
        p.setPrivateKey(key);
        return p;
    }

    private static String readKey(String path) throws IOException {
        return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8).trim();
    }

    private static byte[] randomBytes() {
        byte[] b = new byte[32];
        new java.security.SecureRandom().nextBytes(b);
        return b;
    }

    private static String addr(String weId) {
        return weId.substring(weId.lastIndexOf(':') + 1);
    }

    private static String read(String name) throws IOException {
        return new String(Files.readAllBytes(Paths.get(out, name)), StandardCharsets.UTF_8);
    }

    private static void write(String name, String content) throws IOException {
        Files.write(Paths.get(out, name), String.valueOf(content).getBytes(StandardCharsets.UTF_8));
    }
}
