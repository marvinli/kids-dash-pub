package dev.kidsdash.frame;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;

/**
 * Plain-JVM tests (no Android runtime needed): `node build.mjs --test`.
 * Signs with a fresh P-256 key exactly as KMS does (DER ECDSA over SHA-256 of
 * the payload bytes) and checks the verifier accepts only what it should.
 */
public final class BundleVerifierTest {
    private static int passed;

    public static void main(String[] args) throws Exception {
        KeyPair pair = keyPair();
        KeyPair other = keyPair();
        String publicKey = Base64.getEncoder().encodeToString(pair.getPublic().getEncoded());
        BundleVerifier verifier = new BundleVerifier(publicKey, "key-1");

        String json = "{\"schemaVersion\":1,\"title\":\"Pajama day ☺\"}";
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        String signature = sign(pair, bytes);

        check("accepts a valid envelope and returns its UTF-8 JSON",
                json.equals(verifier.verify(payload, signature, "key-1")));

        rejects("a different key id", verifier, payload, signature, "key-2");
        rejects("a signature from another key", verifier, payload, sign(other, bytes), "key-1");
        byte[] tampered = bytes.clone();
        tampered[5] ^= 1;
        rejects("a tampered payload", verifier,
                Base64.getUrlEncoder().withoutPadding().encodeToString(tampered), signature, "key-1");
        rejects("garbage base64", verifier, "!!!", signature, "key-1");
        rejects("a truncated signature", verifier, payload, signature.substring(0, 20), "key-1");

        check("hashes like sha256sum",
                BundleVerifier.sha256Hex("abc".getBytes(StandardCharsets.UTF_8))
                        .equals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));

        check("accepts well-formed tokens",
                BundleVerifier.isValidToken("4cd57a7dc2acdf5d." + repeat('A', 43)));
        check("rejects malformed tokens",
                !BundleVerifier.isValidToken(null)
                        && !BundleVerifier.isValidToken("short.token")
                        && !BundleVerifier.isValidToken("4cd57a7dc2acdf5d." + repeat('A', 42))
                        && !BundleVerifier.isValidToken("4CD57A7DC2ACDF5D." + repeat('A', 43)));

        System.out.println("BundleVerifierTest: " + passed + " passed");
    }

    private static KeyPair keyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        return generator.generateKeyPair();
    }

    private static String sign(KeyPair pair, byte[] bytes) throws Exception {
        Signature signer = Signature.getInstance("SHA256withECDSA");
        signer.initSign(pair.getPrivate());
        signer.update(bytes);
        return Base64.getEncoder().encodeToString(signer.sign());
    }

    private static void rejects(String what, BundleVerifier verifier, String payload, String signature, String keyId) {
        try {
            verifier.verify(payload, signature, keyId);
            fail("should reject " + what);
        } catch (BundleVerifier.VerificationException expected) {
            passed++;
        }
    }

    private static void check(String what, boolean ok) {
        if (!ok) fail(what);
        passed++;
    }

    private static void fail(String what) {
        System.err.println("FAILED: " + what);
        System.exit(1);
    }

    private static String repeat(char c, int n) {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < n; i++) s.append(c);
        return s.toString();
    }
}
