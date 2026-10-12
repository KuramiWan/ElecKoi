package com.eleckoi.app;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;

/** Reads the published Android descriptor without selecting Windows-only releases. */
final class AppUpdateClient {
    static final String ENDPOINT="https://api.github.com/repos/eleckoi/ElecKoi/releases";
    interface Transport { Reply get(String url, int limit) throws Exception; }
    static final class Reply {
        final String body; final boolean next;
        Reply(String body, boolean next) { this.body=body; this.next=next; }
    }
    private final Transport transport;
    AppUpdateClient(Transport transport) { this.transport=transport; }
    AppUpdateRelease latest(String applicationId) throws Exception {
        AppUpdateRelease.Candidate selected=null;
        for (int page=1; page<=20; page++) {
            Reply response=transport.get(ENDPOINT+"?per_page=100&page="+page, 2*1024*1024);
            selected=AppUpdateRelease.newest(new JSONArray(response.body),selected);
            if (!response.next) {
                if (selected==null) return null;
                String url=AppUpdateRelease.assetUrl(selected.release,selected.descriptor);
                return AppUpdateRelease.read(selected,transport.get(url,64*1024).body,applicationId);
            }
        }
        throw new IOException("更新发布列表超过检查范围，请稍后重试。");
    }
    static final class HttpTransport implements Transport {
        @Override public Reply get(String url, int limit) throws Exception {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("更新检查已取消。");
            HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();
            connection.setConnectTimeout(15000); connection.setReadTimeout(15000);
            connection.setRequestProperty("Accept","application/vnd.github+json");
            connection.setRequestProperty("X-GitHub-Api-Version","2022-11-28");
            connection.setRequestProperty("User-Agent","ElecKoi-Android-Update-Check");
            try {
                int status=connection.getResponseCode();
                if (status!=200) throw new IOException("更新检查 HTTP "+status);
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                try(InputStream input=connection.getInputStream()) {
                    byte[] buffer=new byte[8192]; int count;
                    while((count=input.read(buffer))!=-1) {
                        if (bytes.size()+count>limit) throw new IOException("更新响应超过允许大小。");
                        bytes.write(buffer,0,count);
                    }
                }
                String links=connection.getHeaderField("Link");
                return new Reply(new String(bytes.toByteArray(),StandardCharsets.UTF_8),links!=null && links.contains("rel=\"next\""));
            } finally { connection.disconnect(); }
        }
    }
}
