package com.eleckoi.app;

import android.app.*;
import android.app.job.*;
import android.content.*;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.*;
import android.util.Log;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.json.JSONObject;

/** Platform-owned version checks, bounded cached release state and notification deduplication. */
final class AppUpdates {
    interface Listener { void changed(String snapshot); }
    private static final String CHANNEL="app-updates";
    private static final int NOTIFICATION=42, JOB=42;
    private static final long HOUR=60*60*1000L, DAY=24*HOUR;
    private final Context context;
    private final SharedPreferences preferences;
    private final AppUpdateClient client=new AppUpdateClient(new AppUpdateClient.HttpTransport());
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Set<Listener> listeners=new CopyOnWriteArraySet<>();
    private final List<Consumer<Boolean>> completions=new ArrayList<>();
    private final String version;
    private final long installedCode;
    private volatile JSONObject state;
    private boolean checking, requestedManual;
    AppUpdates(Context context) {
        this.context=context;
        preferences=context.getSharedPreferences("app-updates",Context.MODE_PRIVATE);
        try {
            PackageInfo info=context.getPackageManager().getPackageInfo(context.getPackageName(),0);
            version=info.versionName; installedCode=Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;
            JSONObject cached=new JSONObject(preferences.getString("latest","{}"));
            state=!BuildConfig.DEBUG && BuildConfig.BROWSER_VARIANT.equals(cached.optString("variant")) && cached.optLong("versionCode",0)>installedCode?cached:empty("idle",null);
            state.put("currentVersion",version);
        } catch(Exception error) { throw new IllegalStateException("无法读取安卓应用版本。",error); }
    }
    void scheduleBackground() {
        JobScheduler scheduler=context.getSystemService(JobScheduler.class);
        if (BuildConfig.DEBUG) { scheduler.cancel(JOB); return; }
        if (scheduler.getPendingJob(JOB)!=null) return;
        int result=scheduler.schedule(new JobInfo.Builder(JOB,new ComponentName(context,AppUpdateJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(DAY).setPersisted(true)
            .setBackoffCriteria(HOUR,JobInfo.BACKOFF_POLICY_LINEAR).build());
        if(result!=JobScheduler.RESULT_SUCCESS) Log.e("ElecKoiUpdates","Android update job could not be scheduled");
    }
    void startup() {
        if (BuildConfig.DEBUG) return;
        long elapsed=System.currentTimeMillis()-preferences.getLong("checkedAt",0);
        if(elapsed>=HOUR || elapsed<0) check(false,null);
    }
    String status() { return state.toString(); }
    void observe(Listener listener) { listeners.add(listener); }
    void removeObserver(Listener listener) { listeners.remove(listener); }
    synchronized Runnable check(boolean manual, Consumer<Boolean> completion) {
        if (BuildConfig.DEBUG) {
            publish(empty("idle",manual?"开发版不接收正式版更新，请安装新的开发包。":null));
            if(completion!=null) completion.accept(true);
            return () -> {};
        }
        requestedManual |= manual;
        if(completion!=null) completions.add(completion);
        if(!checking) {
            checking=true;
            try { JSONObject next=new JSONObject(state.toString()); next.put("phase","checking").put("manualCheck",manual).put("message",manual?"正在检查更新…":JSONObject.NULL); publish(next); }
            catch(Exception error) { throw new IllegalStateException(error); }
            executor.execute(() -> {
                AppUpdateRelease release=null; Exception failure=null;
                try { release=client.latest(context.getPackageName()); } catch(Exception error) { failure=error; }
                AppUpdateRelease result=release; Exception error=failure;
                main.post(() -> complete(result,error,manual));
            });
        }
        return () -> { synchronized(AppUpdates.this) { completions.remove(completion); } };
    }
    private void complete(AppUpdateRelease release, Exception error, boolean manual) {
        synchronized(this) { manual=requestedManual; requestedManual=false; }
        boolean success=error==null;
        try {
            JSONObject next;
            if(success) {
                next=release!=null && release.isNewerThan(installedCode)?available(release):empty("idle",manual?(release==null?"暂无已发布的安卓更新。":"当前已是最新版本。"):null);
                preferences.edit().putLong("checkedAt",System.currentTimeMillis()).putString("latest",next.toString()).apply();
                if(release!=null && release.isNewerThan(installedCode)) notifyRelease(release);
            } else {
                Log.w("ElecKoiUpdates","Update check failed",error);
                next=new JSONObject(state.toString());
                next.put("phase","error").put("message",("更新检查失败："+error.getMessage()).substring(0,Math.min(300,("更新检查失败："+error.getMessage()).length())));
            }
            next.put("manualCheck",manual); publish(next);
        } catch(Exception failure) {
            success=false; Log.e("ElecKoiUpdates","Update state could not be published",failure);
            publish(empty("error","更新状态处理失败，请重新检查。"));
        }
        List<Consumer<Boolean>> waiting;
        synchronized(this) { checking=false; waiting=new ArrayList<>(completions); completions.clear(); }
        for(Consumer<Boolean> callback:waiting) callback.accept(success);
    }
    private JSONObject available(AppUpdateRelease release) throws Exception {
        return empty("available",null).put("variant",BuildConfig.BROWSER_VARIANT).put("versionCode",release.versionCode).put("availableVersion",release.versionName)
            .put("releaseName",release.title).put("releaseNotes",release.notes.substring(0,Math.min(4000,release.notes.length())))
            .put("releaseDate",release.publishedAt).put("releaseUrl",release.releaseUrl).put("downloadUrl",release.downloadUrl).put("downloadSizeBytes",release.bytes);
    }
    private JSONObject empty(String phase, String message) {
        try { return new JSONObject().put("phase",phase).put("currentVersion",version).put("availableVersion",JSONObject.NULL)
            .put("releaseName",JSONObject.NULL).put("releaseNotes",JSONObject.NULL).put("releaseDate",JSONObject.NULL)
            .put("downloadSizeBytes",JSONObject.NULL).put("progress",JSONObject.NULL).put("message",message==null?JSONObject.NULL:message); }
        catch(Exception error) { throw new IllegalStateException(error); }
    }
    private void publish(JSONObject next) { state=next; for(Listener listener:listeners) listener.changed(next.toString()); }
    String downloadUrl() throws Exception {
        if(BuildConfig.DEBUG) throw new IllegalStateException("开发版不下载正式版更新。");
        JSONObject current=state;
        if(current.optLong("versionCode",0)<=installedCode) throw new IllegalStateException("没有可下载的安卓更新。");
        String url=current.getString("downloadUrl");
        if(!url.startsWith(AppUpdateRelease.REPOSITORY+"/releases/download/")) throw new IllegalStateException("安卓下载地址无效。");
        return url;
    }
    private void notifyRelease(AppUpdateRelease release) {
        if(preferences.getLong("notifiedCode",0)==release.versionCode) return;
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL,"版本更新",NotificationManager.IMPORTANCE_DEFAULT));
        if(!manager.areNotificationsEnabled() || manager.getNotificationChannel(CHANNEL).getImportance()==NotificationManager.IMPORTANCE_NONE) return;
        if(Build.VERSION.SDK_INT>=33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        Intent open=new Intent(Intent.ACTION_VIEW,Uri.parse(release.releaseUrl));
        PendingIntent intent=PendingIntent.getActivity(context,NOTIFICATION,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        manager.notify(NOTIFICATION,new Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("ElecKoi 有新版本").setContentText("v"+release.versionName+"，点击查看并下载")
            .setContentIntent(intent).setAutoCancel(true).build());
        preferences.edit().putLong("notifiedCode",release.versionCode).apply();
    }
}
