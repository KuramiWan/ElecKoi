package com.eleckoi.app;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.function.LongConsumer;

/** Reports bytes only after writing them, and keeps the archive integrity check mandatory. */
final class RuntimeArchiveCopy {
    static void copy(InputStream input, OutputStream output, long expectedBytes, String expectedDigest,
                     LongConsumer progress) throws IOException, NoSuchAlgorithmException {
        if (expectedBytes <= 0 || !expectedDigest.matches("[a-f0-9]{64}"))
            throw new IOException("Invalid runtime archive size or checksum");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long written = 0;
        progress.accept(0);
        byte[] buffer = new byte[64 * 1024]; int count;
        while ((count = input.read(buffer)) != -1) {
            if (count > expectedBytes - written) throw new IOException("Runtime archive exceeds declared size");
            output.write(buffer, 0, count); digest.update(buffer, 0, count);
            written += count; progress.accept(written);
        }
        if (written != expectedBytes || !RuntimeInstaller.hex(digest.digest()).equals(expectedDigest))
            throw new IOException("Runtime archive size or checksum mismatch");
    }
}
