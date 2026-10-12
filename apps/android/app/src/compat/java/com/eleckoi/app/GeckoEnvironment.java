package com.eleckoi.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import org.mozilla.geckoview.*;
import java.util.Map;
import java.util.HashMap;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** One app-owned Gecko runtime and extension cookie transport for the process. */
final class GeckoEnvironment {
    static final String EXTENSION="android-browser@eleckoi.app";
    private static GeckoEnvironment instance;
    final GeckoRuntime runtime;
    final CompletableFuture<WebExtension> ready=new CompletableFuture<>();
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Map<String,CompletableFuture<Object>> requests=new HashMap<>();
    private CompletableFuture<WebExtension.Port> controlReady=new CompletableFuture<>();
    private WebExtension.Port control;
    static synchronized GeckoEnvironment get(Context context) {
        if(instance==null) instance=new GeckoEnvironment(context.getApplicationContext()); return instance;
    }
    private GeckoEnvironment(Context context) {
        runtime=GeckoRuntime.create(context,new GeckoRuntimeSettings.Builder().javaScriptEnabled(true)
            .consoleOutput(true).remoteDebuggingEnabled(BuildConfig.DEBUG).build());
        runtime.getWebExtensionController().ensureBuiltIn("resource://android/assets/eleckoi-browser/",EXTENSION).accept(extension->{
            extension.setMessageDelegate(new WebExtension.MessageDelegate() {
                @Override public void onConnect(WebExtension.Port port) {
                    WebExtension.MessageSender sender=port.sender;
                    if(!EXTENSION.equals(sender.webExtension.id) || sender.session!=null
                        || sender.environmentType!=WebExtension.MessageSender.ENV_TYPE_EXTENSION) { port.disconnect(); return; }
                    control=port;
                    port.setDelegate(new WebExtension.PortDelegate() {
                        @Override public void onPortMessage(Object value,WebExtension.Port source) {
                            if(source!=control || !(value instanceof JSONObject)) return;
                            JSONObject response=(JSONObject)value;
                            CompletableFuture<Object> request=requests.remove(response.optString("id"));
                            if(request==null) return;
                            if(response.optBoolean("success")) request.complete(response.opt("result"));
                            else request.completeExceptionally(new IllegalStateException(response.optString("error","Gecko cookie operation failed")));
                        }
                        @Override public void onDisconnect(WebExtension.Port source) {
                            if(source!=control) return; control=null; controlReady=new CompletableFuture<>();
                            for(CompletableFuture<Object> request:requests.values()) request.completeExceptionally(new IllegalStateException("Gecko cookie transport disconnected"));
                            requests.clear();
                        }
                    });
                    controlReady.complete(port);
                }
            },"eleckoi_control");
            ready.complete(extension);
        },error->{ ready.completeExceptionally(error); controlReady.completeExceptionally(error); });
    }
    CompletableFuture<Object> request(String operation,String url,String header) {
        CompletableFuture<Object> result=new CompletableFuture<>();
        main.post(()->{
            String id=UUID.randomUUID().toString();
            Runnable timeout=()->{ requests.remove(id); result.completeExceptionally(new IllegalStateException("Gecko cookie operation timed out")); };
            main.postDelayed(timeout,30_000);
            result.whenComplete((value,error)->main.removeCallbacks(timeout));
            controlReady.whenComplete((port,error)->main.post(()->{
                if(result.isDone()) return;
                if(error!=null) { result.completeExceptionally(error); return; }
                try {
                    requests.put(id,result); port.postMessage(new JSONObject().put("id",id).put("operation",operation).put("url",url).put("header",header));
                } catch(Exception failure) { requests.remove(id); result.completeExceptionally(failure); }
            }));
        });
        return result;
    }
}
