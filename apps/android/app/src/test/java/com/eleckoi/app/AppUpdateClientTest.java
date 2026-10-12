package com.eleckoi.app;

import java.io.IOException;
import java.util.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class AppUpdateClientTest {
    private static final String APK="ElecKoi-android-test.apk", PACKAGE="com.eleckoi.app";
    private static JSONObject asset(String tag,String name) throws Exception {
        long id=Integer.toUnsignedLong((tag+"/"+name).hashCode())+1;
        return new JSONObject().put("id",id).put("url",AppUpdateClient.ENDPOINT+"/assets/"+id)
            .put("name",name).put("state","uploaded").put("size",1024)
            .put("browser_download_url",AppUpdateRelease.REPOSITORY+"/releases/download/"+tag+"/"+name);
    }
    private static JSONObject release(int id,String tag,String date,boolean android) throws Exception {
        JSONArray assets=new JSONArray().put(asset(tag,"latest.yml"));
        if(android) assets.put(asset(tag,AppUpdateRelease.DESCRIPTOR)).put(asset(tag,APK));
        return new JSONObject().put("id",id).put("tag_name",tag).put("published_at",date).put("draft",false).put("prerelease",false)
            .put("html_url",AppUpdateRelease.REPOSITORY+"/releases/tag/"+tag).put("name","合成发布").put("body","合成发布说明").put("assets",assets);
    }
    private static JSONObject descriptor(long code) throws Exception {
        return new JSONObject().put("schemaVersion",1).put("platform","android").put("variant",BuildConfig.BROWSER_VARIANT).put("applicationId",PACKAGE)
            .put("versionCode",code).put("versionName","1.2.3").put("apkAsset",APK).put("sha256",String.join("",Collections.nCopies(64,"a")));
    }
    @Test public void windowsOnlyAndPrereleasesDoNotCountAsAndroidUpdates() throws Exception {
        JSONObject preview=release(2,"android-v1.2.3","2025-01-02T00:00:00Z",true).put("prerelease",true);
        List<String> requests=new ArrayList<>();
        AppUpdateClient client=new AppUpdateClient((url,limit,accept) -> { requests.add(url); return new AppUpdateClient.Reply(new JSONArray().put(release(1,"v1.2.3","2025-01-01T00:00:00Z",false)).put(preview).toString(),false); });
        assertNull(client.latest(PACKAGE)); assertEquals(1,requests.size());
        assertTrue(requests.get(0).startsWith("https://api.github.com/repos/eleckoi/ElecKoi/releases?"));
    }
    @Test public void followsPaginationAndPublishedDatesRatherThanListOrder() throws Exception {
        List<String> requests=new ArrayList<>();
        AppUpdateClient client=new AppUpdateClient((url,limit,accept) -> {
            requests.add(url);
            assertEquals(url.contains("/releases/assets/")?"application/octet-stream":"application/vnd.github+json",accept);
            if(url.endsWith("page=1")) return new AppUpdateClient.Reply(new JSONArray().put(release(2,"android-v1.2.3","2025-01-02T00:00:00Z",true)).toString(),true);
            if(url.endsWith("page=2")) return new AppUpdateClient.Reply(new JSONArray().put(release(1,"v1.2.2","2025-01-01T00:00:00Z",true)).put(release(3,"v1.2.4","2025-01-03T00:00:00Z",true)).toString(),false);
            assertEquals(AppUpdateRelease.apiAssetUrl(asset("v1.2.4",AppUpdateRelease.DESCRIPTOR)),url);
            return new AppUpdateClient.Reply(descriptor(9).toString(),false);
        });
        AppUpdateRelease update=client.latest(PACKAGE);
        assertEquals(9,update.versionCode); assertEquals(3,requests.size());
        assertEquals(AppUpdateRelease.REPOSITORY+"/releases/tag/v1.2.4",update.releaseUrl);
        assertEquals(AppUpdateRelease.REPOSITORY+"/releases/download/v1.2.4/"+APK,update.downloadUrl);
        assertTrue(update.isNewerThan(8)); assertFalse(update.isNewerThan(9)); assertFalse(update.isNewerThan(10));
    }
    @Test public void rejectsInvalidIdentityAndAssetContracts() throws Exception {
        JSONObject release=release(1,"v1.2.3","2025-01-01T00:00:00Z",true);
        AppUpdateRelease.Candidate source=AppUpdateRelease.newest(new JSONArray().put(release),null);
        for(JSONObject invalid:Arrays.asList(descriptor(2).put("variant","standard".equals(BuildConfig.BROWSER_VARIANT)?"compat":"standard"),descriptor(2).put("applicationId","com.example.other"),descriptor(2).put("platform","windows"),descriptor(0),descriptor(2).put("apkAsset","unknown.apk"),descriptor(2).put("sha256","invalid"))) {
            try { AppUpdateRelease.read(source,invalid.toString(),PACKAGE); fail("Invalid descriptor was accepted"); } catch(IOException expected) {}
        }
        release.getJSONArray("assets").put(asset("v1.2.3",AppUpdateRelease.DESCRIPTOR));
        try { AppUpdateRelease.newest(new JSONArray().put(release),null); fail("Duplicate descriptor was accepted"); } catch(IOException expected) { assertTrue(expected.getMessage().contains("重复")); }
    }
    @Test public void malformedLatestReleaseIsNotReplacedByAnOlderCandidate() throws Exception {
        AppUpdateClient client=new AppUpdateClient((url,limit,accept) -> !url.contains("/releases/assets/")
            ?new AppUpdateClient.Reply(new JSONArray().put(release(1,"v1.2.3","2025-01-01T00:00:00Z",true)).put(release(2,"android-v1.2.4","2025-01-02T00:00:00Z",true)).toString(),false)
            :new AppUpdateClient.Reply("{}",false));
        try { client.latest(PACKAGE); fail("Malformed latest descriptor was accepted"); } catch(JSONException expected) {}
    }
    @Test public void requestFailuresAndPaginationLimitsRemainFailures() throws Exception {
        AppUpdateClient failing=new AppUpdateClient((url,limit,accept) -> { throw new IOException("synthetic network failure"); });
        try { failing.latest(PACKAGE); fail("Network failure became success"); } catch(IOException expected) { assertTrue(expected.getMessage().contains("network")); }
        AppUpdateClient endless=new AppUpdateClient((url,limit,accept) -> new AppUpdateClient.Reply("[]",true));
        try { endless.latest(PACKAGE); fail("Incomplete pagination became success"); } catch(IOException expected) { assertTrue(expected.getMessage().contains("检查范围")); }
    }
    @Test public void rejectsMismatchedApiAssetIdentityBeforeRequestingDescriptor() throws Exception {
        JSONObject release=release(1,"v1.2.3","2025-01-01T00:00:00Z",true);
        release.getJSONArray("assets").getJSONObject(1).put("url","https://api.github.com/repos/example/other/releases/assets/1");
        List<String> requests=new ArrayList<>();
        AppUpdateClient client=new AppUpdateClient((url,limit,accept) -> {
            requests.add(url); return new AppUpdateClient.Reply(new JSONArray().put(release).toString(),false);
        });
        try { client.latest(PACKAGE); fail("Mismatched API identity was accepted"); }
        catch(IOException expected) { assertTrue(expected.getMessage().contains("资产标识")); }
        assertEquals(1,requests.size());
    }
}
