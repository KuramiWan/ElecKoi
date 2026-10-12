package com.eleckoi.app;

import android.app.Activity;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.mozilla.geckoview.*;
import java.util.Map;
import java.util.HashMap;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** Bundled Gecko implementation; native platform operations remain in the shared Activity. */
final class PlatformBrowser extends BrowserSurface {
    private final GeckoEnvironment environment;
    private final GeckoSession session=new GeckoSession();
    private final GeckoView view;
    private final Listener listener;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService operations=Executors.newSingleThreadExecutor();
    private final Map<String,Consumer<String>> commands=new HashMap<>();
    private final Bridge bridge;
    private final BrowserUploads uploads;
    private WebExtension.Port pagePort;
    private String url="";
    private boolean back;
    private volatile boolean closed;
    PlatformBrowser(Activity activity,String source,Bridge bridge,Listener listener) {
        this.bridge=bridge; this.listener=listener; environment=GeckoEnvironment.get(activity); view=new GeckoView(activity);
        try { uploads=new BrowserUploads(activity.getCacheDir().toPath()); }
        catch(java.io.IOException error) { throw new IllegalStateException("Upload cache could not be created",error); }
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession current,LoadRequest request) {
                if(listener.sameHost(request.uri)) return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                listener.external(request.uri); return GeckoResult.fromValue(AllowOrDeny.DENY);
            }
            @Override public void onLocationChange(GeckoSession current,String uri,java.util.List<GeckoSession.PermissionDelegate.ContentPermission> permissions,Boolean gesture) { url=uri; }
            @Override public void onCanGoBack(GeckoSession current,boolean value) { back=value; }
            @Override public GeckoResult<String> onLoadError(GeckoSession current,String uri,WebRequestError error) {
                listener.failure("Gecko 页面加载失败："+error); return null;
            }
            @Override public GeckoResult<GeckoSession> onNewSession(GeckoSession current,String uri) { listener.external(uri); return null; }
        });
        session.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override public void onPageStop(GeckoSession current,boolean success) {
                if(success) listener.documentReady(); else listener.failure("Gecko 页面加载未完成");
            }
        });
        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override public void onCrash(GeckoSession current) { listener.failure("内置 Gecko 渲染进程崩溃，请重新打开应用"); }
            @Override public void onKill(GeckoSession current) { listener.failure("内置 Gecko 渲染进程被系统终止，请重新打开应用"); }
            @Override public void onExternalResponse(GeckoSession current,WebResponse response) {
                listener.download(response.uri,response.headers.get("Content-Disposition"),response.headers.get("Content-Type"),response.body);
            }
        });
        session.setPromptDelegate(new GeckoSession.PromptDelegate() {
            @Override public GeckoResult<PromptResponse> onFilePrompt(GeckoSession current,FilePrompt prompt) {
                if(prompt.type==FilePrompt.Type.FOLDER) {
                    listener.failure("内置浏览器暂不支持文件夹上传，请选择文件"); return GeckoResult.fromValue(prompt.dismiss());
                }
                GeckoResult<PromptResponse> result=new GeckoResult<>();
                listener.chooseFiles(prompt.mimeTypes,prompt.type==FilePrompt.Type.MULTIPLE,false,"",selection->{
                    if(prompt.isComplete()) return;
                    if(selection==null) { result.complete(prompt.dismiss()); return; }
                    operations.execute(()->{
                        try {
                            java.util.List<BrowserUploads.Input> inputs=new java.util.ArrayList<>();
                            for(Uri uri:selection) {
                                String name=null;
                                try(Cursor cursor=activity.getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)) {
                                    if(cursor!=null && cursor.moveToFirst()) name=cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME));
                                }
                                inputs.add(new BrowserUploads.Input(name,()->activity.getContentResolver().openInputStream(uri)));
                            }
                            Uri[] files=uploads.stage(inputs).stream().map(Uri::fromFile).toArray(Uri[]::new);
                            main.post(()->{ if(!closed && !prompt.isComplete()) result.complete(prompt.confirm(activity,files)); });
                        } catch(Exception failure) {
                            main.post(()->{
                                if(closed || prompt.isComplete()) return;
                                listener.failure("所选文件读取失败："+failure.getMessage()); result.complete(prompt.dismiss());
                            });
                        }
                    });
                }); return result;
            }
        });
        session.open(environment.runtime); view.setSession(session);
        environment.ready.whenComplete((extension,error)->main.post(()->{
            if(closed) return;
            if(error!=null) { listener.failure("内置浏览器初始化失败："+error); return; }
            session.getWebExtensionController().setMessageDelegate(extension,new WebExtension.MessageDelegate() {
                @Override public GeckoResult<Object> onMessage(String nativeApp,Object message,WebExtension.MessageSender sender) {
                    GeckoResult<Object> reply=new GeckoResult<>();
                    if(!trusted(sender) || !(message instanceof JSONObject)) { reply.completeExceptionally(new SecurityException("Invalid browser message sender")); return reply; }
                    JSONObject request=(JSONObject)message;
                    operations.execute(()->{
                        String response;
                        try {
                            if(closed || !listener.sameHost(sender.url)) throw new SecurityException("Host page no longer active");
                            String method=request.getString("method"); JSONArray arguments=request.getJSONArray("arguments"); Object result;
                            if("browserConsole".equals(method)) { listener.console(arguments.getString(0),arguments.getString(1),arguments.getString(2),arguments.getInt(3)); result=JSONObject.NULL; }
                            else result=bridge.invoke(method,arguments);
                            response=new JSONObject().put("success",true).put("result",result==null?JSONObject.NULL:result).toString();
                        } catch(Exception failure) { response=errorJson(failure); }
                        String value=response; main.post(()->reply.complete(value));
                    }); return reply;
                }
            },"eleckoi");
            session.getWebExtensionController().setMessageDelegate(extension,new WebExtension.MessageDelegate() {
                @Override public void onConnect(WebExtension.Port port) {
                    if(!trusted(port.sender)) { port.disconnect(); return; }
                    if(pagePort!=null) pagePort.disconnect();
                    pagePort=port;
                    port.setDelegate(new WebExtension.PortDelegate() {
                        @Override public void onPortMessage(Object value,WebExtension.Port sender) {
                            if(sender!=pagePort || !trusted(sender.sender) || !(value instanceof JSONObject)) return;
                            JSONObject response=(JSONObject)value; Consumer<String> completion=commands.remove(response.optString("id"));
                            if(response.optBoolean("success")) { if(completion!=null) completion.accept(String.valueOf(response.opt("result"))); }
                            else listener.failure("浏览器平台操作失败："+response.optString("error"));
                        }
                        @Override public void onDisconnect(WebExtension.Port port) { if(pagePort==port) { pagePort=null; commands.clear(); } }
                    });
                }
            },"eleckoi_page");
        }));
    }
    private boolean trusted(WebExtension.MessageSender sender) {
        return !closed && sender.session==session && sender.isTopLevel() && GeckoEnvironment.EXTENSION.equals(sender.webExtension.id)
            && listener.sameHost(sender.url);
    }
    private static String errorJson(Exception error) {
        try { return new JSONObject().put("success",false).put("error",error.toString()).toString(); }
        catch(Exception impossible) { throw new IllegalStateException(impossible); }
    }
    @Override android.view.View view() { return view; }
    @Override String getUrl() { return url; }
    @Override String identity() { return "GeckoView "+BuildConfig.GECKOVIEW_VERSION; }
    @Override String userAgent() { return "Bundled GeckoView "+BuildConfig.GECKOVIEW_VERSION; }
    @Override void loadAuthenticated(String value,String cookie,BooleanSupplier current,Consumer<String> failed) {
        environment.ready.whenComplete((extension,error)->main.post(()->{
            if(closed || !current.getAsBoolean()) return;
            if(error!=null) { failed.accept(error.toString()); return; }
            environment.request("get",value,null).whenComplete((stored,failure)->main.post(()->{
                if(closed || !current.getAsBoolean()) return;
                if(failure!=null) { failed.accept(failure.toString()); return; }
                try { install(value,HostPageCookies.mutations((String)stored,cookie),0,current,failed); }
                catch(Exception invalid) { failed.accept(invalid.toString()); }
            }));
        }));
    }
    private void install(String value,java.util.List<String> headers,int index,BooleanSupplier current,Consumer<String> failed) {
        if(closed || !current.getAsBoolean()) return;
        if(index==headers.size()) { url=value; session.loadUri(value); return; }
        environment.request("set",value,headers.get(index)).whenComplete((result,error)->main.post(()->{
            if(closed || !current.getAsBoolean()) return;
            if(error!=null) failed.accept(error.toString()); else install(value,headers,index+1,current,failed);
        }));
    }
    @Override void command(String type,JSONObject payload,Consumer<String> completion) {
        if(closed || pagePort==null || !trusted(pagePort.sender)) return;
        String id=UUID.randomUUID().toString();
        try {
            if(completion!=null) { commands.put(id,completion); main.postDelayed(()->{
                if(commands.remove(id)!=null) listener.failure("内置浏览器平台响应超时："+type);
            },30_000); }
            pagePort.postMessage(new JSONObject().put("id",id).put("command",new JSONObject().put("type",type).put("payload",payload)));
        } catch(Exception error) { commands.remove(id); listener.failure(error.toString()); }
    }
    @Override String cookies(String value) throws Exception {
        if(Looper.myLooper()==Looper.getMainLooper()) throw new IllegalStateException("Cookie reads must not block the UI thread");
        return (String)environment.request("get",value,null).get(30,TimeUnit.SECONDS);
    }
    @Override void stopLoading() { session.stop(); }
    @Override boolean canGoBack() { return back; }
    @Override void goBack() { session.goBack(); }
    @Override void onResume() { session.setActive(true); }
    @Override void onPause() { session.setActive(false); }
    @Override void destroy() {
        closed=true; if(pagePort!=null) pagePort.disconnect(); commands.clear(); view.releaseSession(); session.close();
        operations.execute(()->{ try { uploads.close(); } catch(java.io.IOException error) { android.util.Log.e("ElecKoiUploads","Upload cache cleanup failed",error); } });
        operations.shutdown();
    }
}
