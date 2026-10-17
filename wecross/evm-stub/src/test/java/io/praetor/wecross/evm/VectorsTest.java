package io.praetor.wecross.evm;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

/** Byte-for-byte agreement with viem (scripts/wecross/evm-vectors.ts). */
public class VectorsTest {
    private static final JsonNode V;

    static {
        try {
            V = new ObjectMapper().readTree(VectorsTest.class.getResourceAsStream("/vectors.json"));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String[] strings(JsonNode n) {
        String[] out = new String[n.size()];
        for (int i = 0; i < out.length; i++) out[i] = n.get(i).asText();
        return out;
    }

    private static Signer signer() {
        return Signer.fromPrivateKey(Hex.encode(Keccak.hash(V.get("keyLabel").asText().getBytes(StandardCharsets.UTF_8))));
    }

    @Test
    public void keccakAndKeys() {
        assertEquals(V.get("keccakOfHello").asText(), Hex.encode(Keccak.hash("hello".getBytes(StandardCharsets.UTF_8))));
        Signer s = signer();
        assertEquals(V.get("address").asText().toLowerCase(), s.address());
        assertEquals(V.get("publicKey").asText(), s.publicKeyHex());
    }

    @Test
    public void encodesTheCallsTheRouterNeeds() {
        JsonNode d = V.get("deliver");
        byte[] deliver = Abi.call("deliver(string[])", Abi.stringArray(strings(d.get("args"))));
        assertEquals(d.get("data").asText(), Hex.encode(deliver));
        JsonNode st = V.get("sendTransaction");
        assertEquals(st.get("data").asText(), Hex.encode(Abi.call("sendTransaction(string,string,bytes)",
                Abi.string(st.get("uid").asText()), Abi.string(st.get("name").asText()), Abi.bytes(Hex.decode(st.get("inner").asText())))));
        JsonNode cc = V.get("constantCall");
        assertEquals(cc.get("data").asText(), Hex.encode(Abi.call("constantCall(string,bytes)",
                Abi.string(cc.get("name").asText()), Abi.bytes(Hex.decode(cc.get("inner").asText())))));
        JsonNode xa = V.get("getXATransactionState");
        assertEquals(xa.get("data").asText(), Hex.encode(Abi.call("getXATransactionState(string)", Abi.string(xa.get("path").asText()))));
    }

    @Test
    public void decodesReturnValues() {
        JsonNode r = V.get("returns");
        assertEquals("null", Abi.decodeString(Hex.decode(r.get("stringNull").asText())));
        assertArrayEquals(new String[] {"ok", "7"}, Abi.decodeStringArray(Hex.decode(r.get("stringArray").asText())));
        byte[] inner = Abi.decodeBytes(Hex.decode(r.get("bytesOfStringArray").asText()));
        assertArrayEquals(new String[] {"ok", "7"}, Abi.decodeStringArray(inner));
    }

    @Test
    public void signsALegacyEip155TransactionLikeViem() {
        JsonNode t = V.get("legacyTx");
        byte[] raw = LegacyTx.sign(signer(), t.get("chainId").asLong(), new BigInteger(t.get("nonce").asText()),
                new BigInteger(t.get("gasPrice").asText()), new BigInteger(t.get("gas").asText()), t.get("to").asText(),
                BigInteger.ZERO, Hex.decode(t.get("data").asText()));
        assertEquals(t.get("signed").asText(), Hex.encode(raw));
    }

    @Test
    public void readsTheAccountManagersPemKeys() {
        assertEquals(signer().address(), Signer.fromPem(V.get("pkcs8Pem").asText()).address());
        java.util.Map<String, Object> p = new java.util.HashMap<>();
        p.put("secKey", V.get("pkcs8Pem").asText());
        p.put("keyID", 1);
        assertEquals(signer().address(), EvmAccount.fromProperties(p).getIdentity());
    }

    @Test
    public void signaturesVerifyAgainstTheAddress() {
        Signer s = signer();
        byte[] msg = "praetor".getBytes(StandardCharsets.UTF_8);
        byte[] sig = s.signMessage(msg);
        assertEquals(65, sig.length);
        assertTrue(Signer.verify(s.address(), sig, msg));
        msg[0] ^= 1;
        assertTrue(!Signer.verify(s.address(), sig, msg));
    }
}
