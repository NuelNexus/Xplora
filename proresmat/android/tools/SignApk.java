import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/**
 * Signs an APK with the v2 scheme using apksig, then verifies it (which also parses the binary
 * manifest). v2 covers every supported device: the app's minimum is Android 7.0 (API 24), the
 * first release that verifies v2 signatures.
 */
public class SignApk {
    public static void main(String[] args) throws Exception {
        if (args.length != 5) {
            System.err.println("usage: SignApk <in.apk> <out.apk> <keystore.p12> <alias> <password>");
            System.exit(2);
        }
        char[] pass = args[4].toCharArray();
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (FileInputStream in = new FileInputStream(args[2])) {
            ks.load(in, pass);
        }
        PrivateKey key = (PrivateKey) ks.getKey(args[3], pass);
        X509Certificate cert = (X509Certificate) ks.getCertificate(args[3]);
        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder("PRORESMAT", key, Collections.singletonList(cert)).build();
        new ApkSigner.Builder(Collections.singletonList(signer))
                .setInputApk(new File(args[0]))
                .setOutputApk(new File(args[1]))
                .setMinSdkVersion(24)
                .setV1SigningEnabled(false)
                .setV2SigningEnabled(true)
                .build()
                .sign();
        ApkVerifier.Result result = new ApkVerifier.Builder(new File(args[1])).build().verify();
        if (!result.isVerified()) {
            for (ApkVerifier.IssueWithParams e : result.getErrors()) System.err.println("ERROR: " + e);
            System.exit(1);
        }
        for (ApkVerifier.IssueWithParams w : result.getWarnings()) System.out.println("WARNING: " + w);
        System.out.println("Signed and verified (v2: " + result.isVerifiedUsingV2Scheme() + ")");
    }
}
