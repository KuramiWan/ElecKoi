package com.eleckoi.app;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.function.Consumer;

/** Installs the actual offline distribution before running any Host entrypoint. */
final class RuntimeInstaller {
    static final class Installation {
        final File directory, rootfs, app;
        final String version, nodeExecutable;
        Installation(File directory, JSONObject manifest) throws Exception {
            this.directory = directory;
            rootfs = new File(directory, "rootfs"); app = new File(directory, "app");
            version = manifest.getString("version"); nodeExecutable = manifest.getString("nodeExecutable");
            if (!nodeExecutable.startsWith("/") || nodeExecutable.contains(".."))
                throw new IOException("Invalid guest Node path: " + nodeExecutable);
            if (!new File(rootfs, nodeExecutable.substring(1)).isFile())
                throw new IOException("Packaged Node missing: " + nodeExecutable);
            if (!new File(app, "bin/eleckoi-host.mjs").isFile())
                throw new IOException("Real unified Host entrypoint missing: bin/eleckoi-host.mjs");
            for (String file : new String[]{"usr/bin/git", "usr/bin/ssh", "usr/bin/ssh-keygen",
                    "usr/lib/git-core/git-remote-https", "etc/ssl/certs/ca-certificates.crt"})
                if (!new File(rootfs, file).isFile()) throw new IOException("Packaged Git runtime missing: " + file);
            prepareMountTargets(rootfs);
        }
    }
    static synchronized Installation install(Context context, RuntimePaths paths, Consumer<RuntimeInstallProgress> progress) throws Exception {
        String raw;
        try (InputStream input = context.getAssets().open("runtime/manifest.json")) {
            raw = readText(input);
        } catch (FileNotFoundException missing) {
            throw new IOException("统一 Host 离线资源未打包。请运行资源 staging 并检查 verifyRuntimeAssets。", missing);
        }
        JSONObject manifest = new JSONObject(raw);
        if (manifest.getInt("schemaVersion") != 1 || !manifest.getString("architecture").equals("arm64-v8a")
            || manifest.getInt("protocolVersion") != 1 || !manifest.getString("nodeExecutable").equals("/usr/bin/node")
            || !manifest.getString("hostEntrypoint").equals("/eleckoi/app/bin/eleckoi-host.mjs"))
            throw new IOException("Unsupported Android runtime manifest");
        JSONArray archives = manifest.getJSONArray("archives");
        String[] assets = {"runtime/rootfs.archive", "runtime/node.archive", "runtime/git.archive", "runtime/app.archive"};
        String[] targets = {"rootfs", "rootfs", "rootfs", "app"};
        if (archives.length() != assets.length) throw new IOException("Runtime requires rootfs, Node, Git and Host archives");
        for (int index = 0; index < archives.length(); index++) {
            JSONObject archive = archives.getJSONObject(index);
            if (!assets[index].equals(archive.getString("asset")) || !targets[index].equals(archive.getString("target"))
                || !archive.getString("sha256").matches("[a-f0-9]{64}") || archive.getLong("bytes") <= 0)
                throw new IOException("Invalid runtime archive contract at index " + index);
        }
        String identity = hex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)));
        File directory = new File(paths.installations, identity.substring(0, 20));
        File marker = new File(directory, ".installed");
        if (marker.isFile()) try (InputStream saved = new FileInputStream(marker)) {
            if (readText(saved).equals(identity)) return new Installation(directory, manifest);
        }
        long required = 64L * 1024 * 1024, largestArchive = 0;
        for (int index = 0; index < archives.length(); index++) {
            JSONObject archive = archives.getJSONObject(index);
            long unpacked = archive.getLong("unpackedBytes");
            if (unpacked <= 0) throw new IOException("Runtime unpacked size is missing or invalid");
            required = Math.addExact(required, unpacked);
            largestArchive = Math.max(largestArchive, archive.getLong("bytes"));
        }
        required = Math.addExact(required, largestArchive);
        long available = paths.installations.getUsableSpace();
        if (available < required) throw new IOException("运行时安装空间不足：需要 " + ((required + 1048575) / 1048576)
            + " MB，可用 " + (available / 1048576) + " MB。已有数据和运行时已保留。");
        if (directory.exists()) deleteTree(directory);
        Files.createDirectories(directory.toPath());
        for (int index = 0; index < archives.length(); index++) {
            JSONObject archive = archives.getJSONObject(index);
            String target = archive.getString("target");
            if (!target.equals("rootfs") && !target.equals("app")) throw new IOException("Unknown archive target: " + target);
            String asset = archive.getString("asset");
            final int number = index + 1, count = archives.length();
            final long bytes = archive.getLong("bytes");
            File compressed = new File(directory, "archive-" + index + ".tar.gz");
            try (InputStream input = context.getAssets().open(asset); OutputStream output = new FileOutputStream(compressed)) {
                RuntimeArchiveCopy.copy(input, output, bytes, archive.getString("sha256"),
                    copied -> progress.accept(RuntimeInstallProgress.copying(number, count, copied, bytes)));
            } catch (IOException error) {
                throw new IOException("本地资源准备失败：" + asset + "：" + error.getMessage(), error);
            }
            if (compressed.length() != bytes) throw new IOException("Archive saved size mismatch: " + asset);
            progress.accept(RuntimeInstallProgress.extracting(number, count));
            File destination = new File(directory, target); Files.createDirectories(destination.toPath());
            Process extraction = new ProcessBuilder("/system/bin/toybox", "tar", "-xzf", compressed.getAbsolutePath(), "-C", destination.getAbsolutePath())
                .redirectErrorStream(true).start();
            String log; try (InputStream stream = extraction.getInputStream()) { log = readText(stream); }
            int code = extraction.waitFor();
            if (code != 0) throw new IOException("Runtime extraction failed (" + code + "): " + log);
            Files.delete(compressed.toPath());
        }
        progress.accept(RuntimeInstallProgress.checking());
        Installation installation = new Installation(directory, manifest);
        Files.write(marker.toPath(), identity.getBytes(StandardCharsets.UTF_8));
        return installation;
    }
    /** Called only after the new child passed health and authenticated page admission. */
    static void retireUnused(File installationRoot, File activeDirectory, Consumer<String> progress) throws IOException {
        File parent = installationRoot.getCanonicalFile();
        File current = activeDirectory.getCanonicalFile();
        if (!current.getParentFile().equals(parent)) throw new IOException("Active runtime escapes installation directory");
        File[] entries = parent.listFiles();
        if (entries == null) throw new IOException("Cannot enumerate installed runtimes");
        for (File entry : entries) {
            if (entry.equals(current)) continue;
            if (!entry.getName().matches("[a-f0-9]{20}") || !Files.isDirectory(entry.toPath(), LinkOption.NOFOLLOW_LINKS))
                throw new IOException("Unrecognized runtime installation retained: " + entry.getName());
            if (!entry.getCanonicalFile().getParentFile().equals(parent)) throw new IOException("Runtime cleanup path escapes installation directory");
        }
        for (File entry : entries) {
            if (entry.equals(current)) continue;
            deleteTree(entry);
            progress.accept("已清理旧运行时 " + entry.getName());
        }
    }
    private static void prepareMountTargets(File rootfs) throws IOException {
        // Refresh these even for a cached installation. Resolver symlinks from a
        // distro must not redirect the Android active-network resolver mount.
        for (String relative : new String[]{"proc", "dev", "tmp", "etc", "eleckoi/app", "eleckoi/data", "eleckoi/home", "eleckoi/media", "eleckoi/workspace", "run/eleckoi"})
            Files.createDirectories(new File(rootfs, relative).toPath());
        File resolver = new File(rootfs, "etc/resolv.conf");
        if (Files.isSymbolicLink(resolver.toPath())) Files.delete(resolver.toPath());
        for (String relative : new String[]{"etc/resolv.conf", "eleckoi/runtime-config.json"}) {
            File file = new File(rootfs, relative); if (!file.exists()) Files.createFile(file.toPath());
        }
    }
    private static void deleteTree(File root) throws IOException {
        Files.walkFileTree(root.toPath(), new SimpleFileVisitor<Path>() {
            @Override public FileVisitResult visitFile(Path path, java.nio.file.attribute.BasicFileAttributes attrs) throws IOException {
                Files.delete(path); return FileVisitResult.CONTINUE;
            }
            @Override public FileVisitResult postVisitDirectory(Path path, IOException error) throws IOException {
                if (error != null) throw error; Files.delete(path); return FileVisitResult.CONTINUE;
            }
        });
    }
    static String readText(InputStream input) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] bytes = new byte[8192]; int count;
        while ((count = input.read(bytes)) != -1) out.write(bytes, 0, count);
        return out.toString(StandardCharsets.UTF_8.name());
    }
    static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(); for (byte item : bytes) value.append(String.format("%02x", item & 255)); return value.toString();
    }
}
