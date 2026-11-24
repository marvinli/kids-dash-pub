package dev.kidsdash.frame;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/**
 * Checks a bundle envelope before anything is shown. The API signs the payload
 * bytes with an ECDSA P-256 KMS key; the public half is compiled into the app
 * (Config.PUBLIC_KEY), so a compromised network path or storage cannot put
 * content on the frame. Pure Java so it is unit-tested on the JVM.
 */
public final class BundleVerifier {
    public static final class VerificationException extends Exception {
        VerificationException(String message) {
            super(message);
        }
    }

    private final PublicKey publicKey;
    private final String keyId;

    public BundleVerifier(String publicKeyBase64, String keyId) throws GeneralSecurityException {
        byte[] der = Base64.getDecoder().decode(publicKeyBase64);
        this.publicKey = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(der));
        this.keyId = keyId;
    }

    /** Returns the payload's UTF-8 JSON if, and only if, the signature is valid. */
    public String verify(String payloadBase64Url, String signatureBase64, String envelopeKeyId)
            throws VerificationException {
        if (!keyId.equals(envelopeKeyId)) {
            throw new VerificationException("Signed with unknown key " + envelopeKeyId);
        }
        try {
            byte[] payload = Base64.getUrlDecoder().decode(payloadBase64Url);
            byte[] signature = Base64.getDecoder().decode(signatureBase64);
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(publicKey);
            verifier.update(payload);
            if (!verifier.verify(signature)) throw new VerificationException("Bad signature");
            return new String(payload, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException | GeneralSecurityException e) {
            throw new VerificationException("Malformed envelope: " + e.getMessage());
        }
    }

    public static String sha256Hex(byte[] bytes) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String hex(byte[] bytes) {
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    /** Device tokens are `<16 hex id>.<43 base64url secret>`. */
    public static boolean isValidToken(String token) {
        return token != null && token.matches("^[0-9a-f]{16}\\.[A-Za-z0-9_-]{43}$");
    }
}
