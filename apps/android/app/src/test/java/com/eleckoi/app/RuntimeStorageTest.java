package com.eleckoi.app;

import org.junit.Test;
import java.io.File;
import java.io.IOException;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import static org.junit.Assert.*;

public final class RuntimeStorageTest {
    @Test public void removesOnlyRetiredInstallationsAndPreservesProductData() throws Exception {
        Path root = Files.createTempDirectory("eleckoi-runtime-storage-");
        try {
            Path installations = Files.createDirectories(root.resolve("installations"));
            Path active = Files.createDirectories(installations.resolve("aaaaaaaaaaaaaaaaaaaa"));
            Path old = Files.createDirectories(installations.resolve("bbbbbbbbbbbbbbbbbbbb"));
            Files.write(active.resolve("active"), "current-runtime".getBytes(StandardCharsets.UTF_8));
            Files.write(old.resolve("old"), "old-runtime".getBytes(StandardCharsets.UTF_8));
            Path data = Files.createDirectories(root.resolve("data"));
            Files.write(data.resolve("record"), "synthetic-user-record".getBytes(StandardCharsets.UTF_8));
            RuntimeInstaller.retireUnused(installations.toFile(), active.toFile(), ignored -> {});
            assertTrue(Files.exists(active.resolve("active")));
            assertFalse(Files.exists(old));
            assertEquals("synthetic-user-record", new String(Files.readAllBytes(data.resolve("record")), StandardCharsets.UTF_8));
            assertEquals(1, installations.toFile().list().length);
        } finally { eraseFixture(root); }
    }
    @Test public void rejectsAnActivePathOutsideInstallations() throws Exception {
        Path root = Files.createTempDirectory("eleckoi-runtime-boundary-");
        try {
            File installations = Files.createDirectories(root.resolve("installations")).toFile();
            File data = Files.createDirectories(root.resolve("data")).toFile();
            assertThrows(IOException.class, () -> RuntimeInstaller.retireUnused(installations, data, ignored -> {}));
            assertTrue(data.isDirectory());
        } finally { eraseFixture(root); }
    }
    @Test public void retainsAllDirectoriesWhenAnUnrecognizedEntryIsPresent() throws Exception {
        Path root = Files.createTempDirectory("eleckoi-runtime-unknown-");
        try {
            Path active = Files.createDirectories(root.resolve("aaaaaaaaaaaaaaaaaaaa"));
            Path old = Files.createDirectories(root.resolve("bbbbbbbbbbbbbbbbbbbb"));
            Path unknown = Files.createDirectories(root.resolve("unknown"));
            assertThrows(IOException.class, () -> RuntimeInstaller.retireUnused(root.toFile(), active.toFile(), ignored -> {}));
            assertTrue(Files.isDirectory(old));
            assertTrue(Files.isDirectory(unknown));
            assertTrue(Files.isDirectory(active));
        } finally { eraseFixture(root); }
    }
    private static void eraseFixture(Path root) throws IOException {
        try (var paths = Files.walk(root)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path);
        }
    }
}
