package com.eleckoi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import android.os.SystemClock;
import java.net.HttpURLConnection;
import java.net.URL;

/** Runs a bounded native probe without changing the managed Host state. */
public final class GlibcProbeReceiver extends BroadcastReceiver {
    private static final AtomicBoolean running = new AtomicBoolean();
    @Override public void onReceive(Context context, Intent intent) {
        if (!running.compareAndSet(false, true)) {
            android.util.Log.e("ElecKoiGlibcProbe", "A native probe is already running");
            return;
        }
        PendingResult pending = goAsync();
        new Thread(() -> {
            Process diagnosticChild = null;
            try {
                RuntimePaths paths = new RuntimePaths(context);
                boolean git = intent.getBooleanExtra("git", false);
                android.util.Log.i("ElecKoiGlibcProbe", git ? "Starting isolated Git probe" : "Starting native probe");
                if (git) {
                    String manifest;
                    try (java.io.InputStream source = context.getAssets().open("runtime/manifest.json")) {
                        manifest = RuntimeInstaller.readText(source);
                    }
                    byte[] hash = java.security.MessageDigest.getInstance("SHA-256").digest(manifest.getBytes(StandardCharsets.UTF_8));
                    StringBuilder identity = new StringBuilder();
                    for (byte value : hash) identity.append(String.format("%02x", value));
                    File marker = new File(paths.installations, identity.substring(0, 20) + "/.installed");
                    if (!marker.isFile()) throw new IllegalStateException("Git probe requires the current runtime to finish installation first");
                }
                RuntimeInstaller.Installation installation = RuntimeInstaller.install(context, paths, ignored -> {});
                boolean host = intent.getBooleanExtra("host", false);
                boolean androidGlibc = intent.getBooleanExtra("androidGlibc", false);
                if (host && !androidGlibc) throw new IllegalArgumentException("Host probe requires Android glibc");
                boolean portable = intent.getBooleanExtra("portable", false);
                if (git && host) throw new IllegalArgumentException("Git probe cannot start a Host");
                ProcessBuilder command = git ? RuntimeCommand.create(context, paths, installation, false)
                    : createCommand(paths, installation, androidGlibc, host,
                        portable, intent.getBooleanExtra("compatibility", false));
                if (git) {
                    File entry = new File(paths.temp, "git-install-probe.cjs");
                    try (java.io.InputStream source = context.getAssets().open("git-install-probe.cjs")) {
                        Files.write(entry.toPath(), RuntimeInstaller.readText(source).getBytes(StandardCharsets.UTF_8));
                    }
                    List<String> args = new ArrayList<>(java.util.Arrays.asList(command.command().get(0),
                        "--report-exclude-network", entry.getAbsolutePath(), new File(installation.app, "package.json").getAbsolutePath()));
                    String repository = intent.getStringExtra("repository");
                    if (repository != null) args.add(repository);
                    command.command(args);
                }
                if (intent.getBooleanExtra("disableRseq", false))
                    command.environment().put("GLIBC_TUNABLES", "glibc.pthread.rseq=0");
                if (intent.getBooleanExtra("trace", false)) {
                    List<String> args = new ArrayList<>();
                    args.add(paths.nativeExecutable("libeleckoi_glibc_probe.so").getAbsolutePath());
                    args.addAll(command.command()); command.command(args);
                }
                File log = new File(paths.temp, "glibc-probe.log");
                long startedAt = SystemClock.elapsedRealtime(), readyMs = -1;
                int healthStatus = -1;
                Process process = command.redirectErrorStream(true).redirectOutput(log).start();
                diagnosticChild = process;
                if (host) {
                    while (process.isAlive() && SystemClock.elapsedRealtime() - startedAt < 25000) {
                        String current = new String(Files.readAllBytes(log.toPath()), StandardCharsets.UTF_8);
                        JSONObject ready = null;
                        int completeEnd = current.lastIndexOf('\n');
                        for (String line : current.substring(0, completeEnd + 1).split("\n")) {
                            if (!line.startsWith("ELECKOI_HOST\t")) continue;
                            JSONObject message = new JSONObject(line.substring("ELECKOI_HOST\t".length()));
                            if (message.optString("type").equals("ready")) ready = message;
                        }
                        if (ready != null) {
                            readyMs = SystemClock.elapsedRealtime() - startedAt;
                            HttpURLConnection connection = (HttpURLConnection) new URL(ready.getString("healthUrl")).openConnection();
                            connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
                            try { healthStatus = connection.getResponseCode(); } finally { connection.disconnect(); }
                            process.getOutputStream().write("{\"type\":\"shutdown\"}\n".getBytes(StandardCharsets.UTF_8));
                            process.getOutputStream().flush();
                            break;
                        }
                        Thread.sleep(50);
                    }
                }
                boolean exited = process.waitFor(host ? 5 : 25, TimeUnit.SECONDS);
                if (!exited) process.destroyForcibly();
                String output = new String(Files.readAllBytes(log.toPath()), StandardCharsets.UTF_8);
                output = output.replaceAll("http://127\\.0\\.0\\.1:[^\\s\"']+", "[local-url]");
                JSONObject result = new JSONObject().put("exited", exited)
                    .put("exitCode", exited ? process.exitValue() : -1).put("output", output)
                    .put("readyMs", readyMs).put("healthStatus", healthStatus)
                    .put("elapsedMs", SystemClock.elapsedRealtime() - startedAt);
                Files.write(new File(paths.temp, "glibc-probe-result.json").toPath(), result.toString().getBytes(StandardCharsets.UTF_8));
                android.util.Log.i("ElecKoiGlibcProbe", "Probe completed: exit=" + (exited ? process.exitValue() : -1));
            } catch (Exception error) {
                android.util.Log.e("ElecKoiGlibcProbe", "Native probe failed", error);
                try {
                    RuntimePaths paths = new RuntimePaths(context);
                    JSONObject failure = new JSONObject().put("exited", false).put("exitCode", -1)
                        .put("error", error.toString());
                    Files.write(new File(paths.temp, "glibc-probe-result.json").toPath(),
                        failure.toString().getBytes(StandardCharsets.UTF_8));
                } catch (Exception recordingError) {
                    android.util.Log.e("ElecKoiGlibcProbe", "Could not record native probe failure", recordingError);
                }
            } finally {
                if (diagnosticChild != null && diagnosticChild.isAlive()) diagnosticChild.destroyForcibly();
                running.set(false); pending.finish();
            }
        }, "ElecKoiGlibcProbe").start();
    }

    private static ProcessBuilder createCommand(RuntimePaths paths, RuntimeInstaller.Installation installation,
                                               boolean androidGlibc, boolean host, boolean portable, boolean compatibility) throws Exception {
        File linker = paths.nativeExecutable(androidGlibc ? "libeleckoi_glibc_android.so" : "libeleckoi_glibc_loader.so");
        File probeRoot = new File(paths.temp, "glibc-probe");
        String libraries = new File(installation.rootfs, "usr/lib/aarch64-linux-gnu").getAbsolutePath();
        if (androidGlibc) libraries = new File(probeRoot, "lib").getAbsolutePath() + ":" + libraries;
        File node = new File(installation.rootfs, installation.nodeExecutable.substring(1));
        File entrypoint = new File(installation.app, "bin/eleckoi-host.mjs");
        List<String> args;
        File portableRoot = new File(probeRoot, "portable");
        if (portable) {
            if (!androidGlibc) throw new IllegalArgumentException("Portable probe requires Android glibc");
            linker = paths.nativeExecutable("libeleckoi_glibc_portable.so");
            libraries = new File(portableRoot, "usr/glibc/lib").getAbsolutePath() + ":"
                + new File(installation.rootfs, "usr/lib/aarch64-linux-gnu").getAbsolutePath();
            Files.createDirectories(new File(portableRoot, "usr/glibc/etc").toPath());
            Files.copy(paths.resolver.toPath(), new File(portableRoot, "usr/glibc/etc/resolv.conf").toPath(),
                java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            for (File mount : new File[]{paths.root, paths.nativeLibraries, new File("/system")})
                Files.createDirectories(new File(installation.rootfs, mount.getAbsolutePath().substring(1)).toPath());
            args = new ArrayList<>(java.util.Arrays.asList(paths.nativeExecutable("libeleckoi_node.so").getAbsolutePath(),
                "--report-exclude-network"));
        } else {
            args = new ArrayList<>(java.util.Arrays.asList(linker.getAbsolutePath(), "--inhibit-cache",
                "--library-path", libraries, node.getAbsolutePath(), "--report-exclude-network"));
        }
        if (compatibility) {
            args.addAll(java.util.Arrays.asList(new File(probeRoot, "compatibility.cjs").getAbsolutePath(),
                libraries, node.getAbsolutePath()));
        } else if (host) {
            JSONObject config = new JSONObject().put("schemaVersion", 1)
                .put("runtimeDataRoot", new File(probeRoot, "data").getAbsolutePath())
                .put("homeRoot", new File(probeRoot, "home").getAbsolutePath())
                .put("workspaceRoot", new File(probeRoot, "workspace").getAbsolutePath())
                .put("productDatabasePath", new File(probeRoot, "data/probe.db").getAbsolutePath())
                .put("productMediaRoot", new File(probeRoot, "media").getAbsolutePath())
                .put("resourceRoot", new File(installation.app, "resources/dsh").getAbsolutePath());
            File configFile = new File(probeRoot, "host-config.json");
            Files.write(configFile.toPath(), config.toString().getBytes(StandardCharsets.UTF_8));
            args.addAll(java.util.Arrays.asList(entrypoint.getAbsolutePath(), "--config", configFile.getAbsolutePath()));
        } else {
            String source = "console.log(JSON.stringify({type:'glibc-probe',version:process.version,arch:process.arch,execPath:process.execPath}));"
                + "const {createRequire}=require('node:module');const r=createRequire(process.argv[1]);"
                + "const Database=r('better-sqlite3');const db=new Database(':memory:');"
                + "db.exec('create table probe(value text)');db.prepare('insert into probe values(?)').run('synthetic-value');"
                + "console.log(JSON.stringify({type:'sqlite-probe',value:db.prepare('select value from probe').get().value}));db.close();";
            args.addAll(java.util.Arrays.asList("-e", source, entrypoint.getAbsolutePath()));
        }
        ProcessBuilder builder = new ProcessBuilder(args).directory(paths.root);
        Map<String,String> env = builder.environment(); env.clear();
        env.put("HOME", paths.home.getAbsolutePath()); env.put("TMPDIR", paths.temp.getAbsolutePath());
        env.put("PATH", "/system/bin");
        if (portable) {
            env.put("ELECKOI_GLIBC_ROOT", portableRoot.getAbsolutePath());
            env.put("ELECKOI_GLIBC_LOADER", linker.getAbsolutePath());
            env.put("ELECKOI_GLIBC_LIBRARIES", libraries);
            env.put("ELECKOI_NODE_PAYLOAD", node.getAbsolutePath());
            env.put("ELECKOI_NODE_BOOTSTRAP", new File(probeRoot, "bootstrap.cjs").getAbsolutePath());
            env.put("ELECKOI_GLIBC_EXEC_SHIM", new File(portableRoot, "usr/glibc/lib/libeleckoi_glibc_exec.so").getAbsolutePath());
            env.put("ELECKOI_LINUX_ROOTFS", installation.rootfs.getAbsolutePath());
            env.put("ELECKOI_RUNTIME_ROOT", paths.root.getAbsolutePath());
            env.put("ELECKOI_NATIVE_DIRECTORY", paths.nativeLibraries.getAbsolutePath());
            env.put("ELECKOI_RESOLVER", paths.resolver.getAbsolutePath());
            env.put("PATH", new File(installation.rootfs, "usr/bin").getAbsolutePath() + ":/system/bin");
        }
        return builder;
    }
}
