package com.eleckoi.app;

import java.io.IOException;
import java.net.URLEncoder;
import java.time.Instant;
import org.json.JSONArray;
import org.json.JSONObject;

/** Identifies Android releases by an explicit asset and validates their update contract. */
final class AppUpdateRelease {
    static final String REPOSITORY = "https://github.com/eleckoi/ElecKoi";
    static final String DESCRIPTOR = "compat".equals(BuildConfig.BROWSER_VARIANT) ? "android-update-compat.json" : "android-update.json";
    final long versionCode, bytes;
    final String versionName, title, notes, publishedAt, releaseUrl, downloadUrl;
    boolean isNewerThan(long installedCode) { return versionCode>installedCode; }
    AppUpdateRelease(long code, String version, Candidate source, JSONObject apk) throws Exception {
        versionCode=code; versionName=version; bytes=integer(apk, "size");
        title=source.release.optString("name", version); notes=source.release.optString("body", "");
        publishedAt=text(source.release, "published_at"); releaseUrl=text(source.release, "html_url");
        downloadUrl=assetUrl(source.release, apk);
    }
    static final class Candidate {
        final JSONObject release, descriptor;
        final Instant date;
        Candidate(JSONObject release, JSONObject descriptor) throws Exception {
            this.release=release; this.descriptor=descriptor;
            date=Instant.parse(text(release, "published_at"));
            if (!text(release, "html_url").equals(REPOSITORY+"/releases/tag/"+encoded(text(release, "tag_name"))))
                throw new IOException("安卓发布页不属于 ElecKoi 仓库。");
            assetUrl(release, descriptor);
        }
    }
    static Candidate newest(JSONArray releases, Candidate previous) throws Exception {
        Candidate result=previous;
        for (int index=0; index<releases.length(); index++) {
            JSONObject release=releases.getJSONObject(index);
            if (flag(release,"draft") || flag(release,"prerelease")) continue;
            JSONObject descriptor=asset(release, DESCRIPTOR, false);
            if (descriptor==null) continue;
            Candidate candidate=new Candidate(release,descriptor);
            if (result==null || candidate.date.isAfter(result.date)) result=candidate;
            else if (candidate.date.equals(result.date) && integer(candidate.release,"id")!=integer(result.release,"id"))
                throw new IOException("多个安卓发布的时间相同，无法确定更新版本。");
        }
        return result;
    }
    static AppUpdateRelease read(Candidate source, String json, String applicationId) throws Exception {
        JSONObject manifest=new JSONObject(json);
        if (integer(manifest,"schemaVersion")!=1 || !text(manifest,"platform").equals("android"))
            throw new IOException("不支持的安卓更新描述版本或平台。");
        if (!text(manifest,"applicationId").equals(applicationId)) throw new IOException("安卓更新包名与当前应用不一致。");
        if (!text(manifest,"variant").equals(BuildConfig.BROWSER_VARIANT)) throw new IOException("安卓更新变体与当前应用不一致。");
        long code=integer(manifest,"versionCode");
        if (code<=0 || code>2100000000L) throw new IOException("安卓更新 versionCode 无效。");
        String version=text(manifest,"versionName"), name=text(manifest,"apkAsset");
        if (version.trim().isEmpty() || version.length()>100 || !name.endsWith(".apk")) throw new IOException("安卓更新版本或 APK 标识无效。");
        if (!text(manifest,"sha256").matches("[a-f0-9]{64}")) throw new IOException("安卓更新 APK 校验和无效。");
        JSONObject apk=asset(source.release,name,true);
        if (integer(apk,"size")<=0) throw new IOException("安卓更新 APK 为空。");
        return new AppUpdateRelease(code,version,source,apk);
    }
    private static JSONObject asset(JSONObject release, String name, boolean required) throws Exception {
        JSONObject result=null;
        JSONArray assets=release.getJSONArray("assets");
        for (int index=0; index<assets.length(); index++) {
            JSONObject item=assets.getJSONObject(index);
            if (!name.equals(text(item,"name"))) continue;
            if (result!=null) throw new IOException("发布中存在重复资产："+name);
            if (!"uploaded".equals(text(item,"state"))) throw new IOException("发布资产尚未上传完成："+name);
            result=item;
        }
        if (required && result==null) throw new IOException("发布缺少指定的 APK："+name);
        return result;
    }
    static String assetUrl(JSONObject release, JSONObject asset) throws Exception {
        String url=text(asset,"browser_download_url");
        String expected=REPOSITORY+"/releases/download/"+encoded(text(release,"tag_name"))+"/"+encoded(text(asset,"name"));
        if (!url.equals(expected)) throw new IOException("更新资产地址与当前发布不一致。");
        return url;
    }
    static String apiAssetUrl(JSONObject asset) throws Exception {
        long id=integer(asset,"id");
        String expected=AppUpdateClient.ENDPOINT+"/assets/"+id;
        if(id<=0 || !text(asset,"url").equals(expected)) throw new IOException("更新附件 API 地址与资产标识不一致。");
        return expected;
    }
    private static String encoded(String value) throws Exception { return URLEncoder.encode(value,"UTF-8").replace("+","%20"); }
    private static boolean flag(JSONObject object, String key) throws Exception {
        Object value=object.get(key); if (!(value instanceof Boolean)) throw new IOException("更新字段不是布尔值："+key); return (Boolean)value;
    }
    static String text(JSONObject object, String key) throws Exception {
        Object value=object.get(key); if (!(value instanceof String)) throw new IOException("更新字段不是文字："+key); return (String)value;
    }
    static long integer(JSONObject object, String key) throws Exception {
        Object value=object.get(key);
        if (!(value instanceof Number) || ((Number)value).doubleValue()!=((Number)value).longValue()) throw new IOException("更新字段不是整数："+key);
        return ((Number)value).longValue();
    }
}
