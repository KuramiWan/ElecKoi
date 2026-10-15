package com.eleckoi.app;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.BooleanSupplier;

/** Handles app-owned DOM selection requests without changing WebView's browser implementation. */
final class WebViewChoicePrompts {
    interface Response { void send(String id,boolean success,String result); }
    static final class Request {
        final NativeChoiceDialog.Mode mode;
        final List<NativeChoiceDialog.Item> items;
        Request(NativeChoiceDialog.Mode mode,List<NativeChoiceDialog.Item> items) { this.mode=mode; this.items=items; }
    }
    private final NativeChoiceDialog dialog;
    private final Response response;
    private final Handler main=new Handler(Looper.getMainLooper());
    private String activeId="";
    WebViewChoicePrompts(Activity activity,BooleanSupplier dark,Response response) {
        dialog=new NativeChoiceDialog(activity,dark); this.response=response;
    }
    void handle(String action,String id,JSONObject payload) throws JSONException {
        if(id.isEmpty() || id.length()>128) throw new IllegalArgumentException("Invalid choice request ID");
        if(!"show".equals(action) && !"update".equals(action) && !"dismiss".equals(action)) throw new IllegalArgumentException("Unsupported choice operation: "+action);
        Request request="dismiss".equals(action) ? null : parse(payload);
        main.post(()->{
            if("show".equals(action)) {
                dialog.dismiss(); activeId=id;
                dialog.show(null,null,request.mode,request.items,new NativeChoiceDialog.Completion() {
                    @Override public void complete(String[] ids) {
                        if(activeId.equals(id)) activeId="";
                        response.send(id,true,ids==null ? "cancelled" : new JSONArray(java.util.Arrays.asList(ids)).toString());
                    }
                    @Override public void failed(Exception error) {
                        if(activeId.equals(id)) activeId="";
                        response.send(id,false,error.toString());
                    }
                });
            } else if(!activeId.equals(id)) response.send(id,false,"Choice request is no longer active");
            else if("dismiss".equals(action)) dialog.dismiss();
            else dialog.update(null,null,request.mode,request.items);
        });
    }
    void dismiss() { dialog.dismiss(); }
    static Request parse(JSONObject payload) throws JSONException {
        Object multiple=payload.get("multiple");
        if(!(multiple instanceof Boolean)) throw new IllegalArgumentException("Choice mode must be boolean");
        return new Request((Boolean)multiple ? NativeChoiceDialog.Mode.MULTIPLE : NativeChoiceDialog.Mode.SINGLE,
            items(payload.getJSONArray("choices"),new HashSet<>()));
    }
    private static List<NativeChoiceDialog.Item> items(JSONArray choices,Set<String> ids) throws JSONException {
        List<NativeChoiceDialog.Item> result=new ArrayList<>();
        for(int index=0;index<choices.length();index++) {
            JSONObject item=choices.getJSONObject(index);
            Object id=item.get("id"),label=item.get("label"),disabled=item.get("disabled"),selected=item.get("selected");
            if(!(id instanceof String) || ((String)id).isEmpty() || !ids.add((String)id)) throw new IllegalArgumentException("Choice IDs must be unique and nonempty");
            if(!(label instanceof String) || !(disabled instanceof Boolean) || !(selected instanceof Boolean)) throw new IllegalArgumentException("Invalid choice fields");
            Object children=item.get("items");
            if(children!=JSONObject.NULL && !(children instanceof JSONArray)) throw new IllegalArgumentException("Choice children must be an array or null");
            if(children!=JSONObject.NULL && (Boolean)selected) throw new IllegalArgumentException("Choice groups cannot be selected");
            result.add(new NativeChoiceDialog.Item((String)id,(String)label,(Boolean)disabled,(Boolean)selected,false,
                children==JSONObject.NULL ? null : items((JSONArray)children,ids)));
        }
        return result;
    }
}
