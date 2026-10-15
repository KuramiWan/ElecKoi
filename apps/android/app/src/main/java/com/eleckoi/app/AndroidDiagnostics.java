package com.eleckoi.app;

import android.app.ActivityManager;
import android.content.Context;
import android.os.*;
import org.json.JSONObject;
import java.io.File;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Low-frequency sampling and off-main-thread diagnostic storage/export. */
final class AndroidDiagnostics {
    private final Context context;
    private final boolean enabled="compat".equals(BuildConfig.BROWSER_VARIANT);
    private final RuntimeDiagnostics store;
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean visible;
    private volatile long pendingBeat;
    private boolean stallReported;
    private final java.util.concurrent.atomic.AtomicBoolean flushQueued=new java.util.concurrent.atomic.AtomicBoolean();
    AndroidDiagnostics(Context context) {
        this.context = context;
        store = new RuntimeDiagnostics(new File(context.getFilesDir(), "runtime-diagnostics"));
        if(!enabled) return;
        worker.scheduleWithFixedDelay(store::flush, 5, 5, TimeUnit.SECONDS);
        worker.scheduleWithFixedDelay(this::sample, 5, 5, TimeUnit.SECONDS);
        worker.scheduleWithFixedDelay(this::memory, 60, 60, TimeUnit.SECONDS);
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, failure) -> {
            record(RuntimeDiagnostics.failure("java-uncaught", failure));
            try { worker.submit(store::flush).get(1500, TimeUnit.MILLISECONDS); } catch (Exception ignored) { }
            if (previous != null) previous.uncaughtException(thread, failure);
        });
        record(environment().with("kind", "process-start"));
    }
    boolean enabled() { return enabled; }
    void record(JSONObject event) { if(enabled) store.record(event); }
    void event(String kind, String stage) { record(new RuntimeDiagnostics.Record().with("kind", kind).with("stage", stage)); }
    void visible(boolean value) { if(!enabled) return; visible = value; event("activity", value ? "resume" : "pause"); }
    private void sample() {
        if (!visible) { pendingBeat = 0; return; }
        long now = SystemClock.elapsedRealtime();
        if (pendingBeat != 0) {
            if (!stallReported && now - pendingBeat > 1000) { stallReported = true; record(new RuntimeDiagnostics.Record().with("kind", "native-stall").with("delayMs", now - pendingBeat)); }
            return;
        }
        pendingBeat = now; stallReported = false;
        main.post(() -> {
            if(pendingBeat!=now) return;
            long start = pendingBeat; pendingBeat = 0;
            if (visible && start != 0 && SystemClock.elapsedRealtime() - start > 250)
                record(new RuntimeDiagnostics.Record().with("kind", "native-resumed").with("delayMs", SystemClock.elapsedRealtime() - start));
        });
    }
    private void memory() {
        if (!visible) return;
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        ((ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);
        Runtime runtime = Runtime.getRuntime();
        record(new RuntimeDiagnostics.Record().with("kind", "memory").with("heapBytes", runtime.totalMemory() - runtime.freeMemory())
            .with("pssKb", Debug.getPss()).with("availableBytes", memory.availMem).with("lowMemory", memory.lowMemory));
    }
    RuntimeDiagnostics.Record environment() {
        return new RuntimeDiagnostics.Record().with("variant", BuildConfig.BROWSER_VARIANT).with("version", BuildConfig.VERSION_NAME).with("versionCode", BuildConfig.VERSION_CODE)
            .with("sdk", Build.VERSION.SDK_INT).with("system", Build.VERSION.RELEASE).with("manufacturer", Build.MANUFACTURER).with("model", Build.MODEL)
            .with("abi", String.join(",", Build.SUPPORTED_ABIS)).with("pid", android.os.Process.myPid());
    }
    void report(JSONObject metadata, int maximum, Consumer<String> done) {
        worker.execute(() -> {
            String result;
            try { result = store.report(metadata, maximum); } catch (Exception failure) { result = "诊断读取失败：" + RuntimeDiagnostics.clean(failure.toString(), 512); }
            String text = result; main.post(() -> done.accept(text));
        });
    }
    void export(JSONObject metadata, Consumer<File> done, Consumer<String> failed) {
        worker.execute(() -> {
            try { File result = store.export(metadata); main.post(() -> done.accept(result)); }
            catch (Exception failure) { main.post(() -> failed.accept("诊断导出失败：" + RuntimeDiagnostics.clean(failure.toString(), 512))); }
        });
    }
    void flushSoon() { if(enabled && flushQueued.compareAndSet(false,true)) worker.execute(()->{ try { store.flush(); } finally { flushQueued.set(false); } }); }
}
