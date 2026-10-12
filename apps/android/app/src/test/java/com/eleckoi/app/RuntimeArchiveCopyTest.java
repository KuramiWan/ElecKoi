package com.eleckoi.app;

import org.junit.Test;
import java.io.*;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CancellationException;
import static org.junit.Assert.*;

public final class RuntimeArchiveCopyTest {
    @Test public void progressReportsWrittenBytesAndIntegrityRemainsRequired() throws Exception {
        byte[] archive = fixture(150_001);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        List<Long> progress = new ArrayList<>();
        RuntimeArchiveCopy.copy(new ByteArrayInputStream(archive), output, archive.length, checksum(archive), bytes -> {
            assertEquals(output.size(), bytes);
            progress.add(bytes);
        });
        assertArrayEquals(archive, output.toByteArray());
        assertEquals(Long.valueOf(0), progress.get(0));
        assertEquals(Long.valueOf(archive.length), progress.get(progress.size() - 1));
        assertTrue(progress.size() > 2);
    }
    @Test public void truncatedCorruptAndOversizedArchivesFailInsteadOfCompleting() throws Exception {
        byte[] archive = fixture(100);
        String expected = checksum(archive);
        assertThrows(IOException.class, () -> RuntimeArchiveCopy.copy(new ByteArrayInputStream(archive),
            new ByteArrayOutputStream(), 101, expected, ignored -> {}));
        byte[] corrupt = archive.clone(); corrupt[25] ^= 1;
        assertThrows(IOException.class, () -> RuntimeArchiveCopy.copy(new ByteArrayInputStream(corrupt),
            new ByteArrayOutputStream(), 100, expected, ignored -> {}));
        ByteArrayOutputStream oversized = new ByteArrayOutputStream();
        List<Long> progress = new ArrayList<>();
        assertThrows(IOException.class, () -> RuntimeArchiveCopy.copy(new ByteArrayInputStream(archive),
            oversized, 99, expected, progress::add));
        assertEquals(0, oversized.size());
        assertEquals(List.of(0L), progress);
    }
    @Test public void writeFailuresAndCancellationNeverReportUnwrittenBytes() throws Exception {
        byte[] archive = fixture(150_001);
        List<Long> progress = new ArrayList<>();
        OutputStream failed = new OutputStream() {
            @Override public void write(int value) throws IOException { throw new IOException("synthetic write failure"); }
            @Override public void write(byte[] bytes, int offset, int count) throws IOException { throw new IOException("synthetic write failure"); }
        };
        assertThrows(IOException.class, () -> RuntimeArchiveCopy.copy(new ByteArrayInputStream(archive),
            failed, archive.length, checksum(archive), progress::add));
        assertEquals(List.of(0L), progress);
        ByteArrayOutputStream cancelled = new ByteArrayOutputStream();
        assertThrows(CancellationException.class, () -> RuntimeArchiveCopy.copy(new ByteArrayInputStream(archive),
            cancelled, archive.length, checksum(archive), bytes -> {
                if (bytes > 0) throw new CancellationException("synthetic cancellation");
            }));
        assertEquals(64 * 1024, cancelled.size());
    }
    private static byte[] fixture(int size) {
        byte[] bytes = new byte[size];
        for (int index = 0; index < size; index++) bytes[index] = (byte) (index % 251);
        return bytes;
    }
    private static String checksum(byte[] bytes) throws Exception {
        return RuntimeInstaller.hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
}
