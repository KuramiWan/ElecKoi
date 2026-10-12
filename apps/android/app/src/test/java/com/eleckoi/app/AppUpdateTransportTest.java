package com.eleckoi.app;

import java.io.*;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class AppUpdateTransportTest {
    @Test(timeout=15000) public void followsAssetRedirectWithBinaryAcceptAndEnforcesResponseLimit() throws Exception {
        List<String> headers=Collections.synchronizedList(new ArrayList<>());
        ExecutorService worker=Executors.newSingleThreadExecutor();
        try(ServerSocket server=new ServerSocket(0)) {
            server.setSoTimeout(5000);
            Future<?> served=worker.submit(() -> {
                try {
                    for(int request=0;request<3;request++) {
                        try(Socket socket=server.accept()) {
                            socket.setSoTimeout(5000);
                            BufferedReader input=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));
                            String line; StringBuilder received=new StringBuilder();
                            while((line=input.readLine())!=null && !line.isEmpty()) received.append(line).append('\n');
                            headers.add(received.toString().toLowerCase(Locale.ROOT));
                            String body="{\"schemaVersion\":1}";
                            String response=request==0
                                ?"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:"+server.getLocalPort()+"/data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                                :"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: "+body.getBytes(StandardCharsets.UTF_8).length+"\r\nConnection: close\r\n\r\n"+body;
                            socket.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
                        }
                    }
                } catch(Exception error) { throw new CompletionException(error); }
            });
            String url="http://127.0.0.1:"+server.getLocalPort()+"/asset";
            AppUpdateClient.HttpTransport transport=new AppUpdateClient.HttpTransport();
            assertEquals("{\"schemaVersion\":1}",transport.get(url,1024,"application/octet-stream").body);
            try { transport.get(url,4,"application/octet-stream"); fail("Oversized asset was accepted"); }
            catch(IOException expected) { assertTrue(expected.getMessage().contains("允许大小")); }
            served.get(5,TimeUnit.SECONDS);
            assertEquals(3,headers.size());
            for(String header:headers) assertTrue(header.contains("accept: application/octet-stream"));
        } finally { worker.shutdownNow(); }
    }
}
