package com.eleckoi.unified.android;

import org.junit.Test;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

public final class HostPageHandshakeTest {
    private static final String SESSION = "dsh-auth-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=synthetic; Path=/; HttpOnly; SameSite=Strict";
    private static final class Server implements AutoCloseable {
        final ServerSocket listener = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        final AtomicReference<String> sentCookie = new AtomicReference<>();
        final AtomicReference<Throwable> failure = new AtomicReference<>();
        final Thread worker;
        volatile boolean closed;
        Server(boolean pageSucceeds) throws IOException {
            worker = new Thread(() -> {
                while (!closed) try (Socket socket = listener.accept()) {
                    socket.setSoTimeout(5000);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                    String request = reader.readLine(), line;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) {
                        if (line.startsWith("Cookie: ")) sentCookie.set(line.substring(8));
                    }
                    String response;
                    if (request.contains("?")) response = "HTTP/1.1 303 See Other\r\nSet-Cookie: " + SESSION
                        + "\r\nLocation: " + (request.contains("external") ? "http://example.invalid/" : "./") + "\r\nContent-Length: 0\r\n";
                    else response = pageSucceeds ? "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n" : "HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n";
                    socket.getOutputStream().write((response + "Connection: close\r\n\r\n" + (pageSucceeds && !request.contains("?") ? "ok" : "")).getBytes(StandardCharsets.US_ASCII));
                } catch (Throwable error) { if (!closed) failure.set(error); }
            });
            worker.start();
        }
        URL url(String query) throws MalformedURLException { return new URL("http://127.0.0.1:" + listener.getLocalPort() + "/?" + query); }
        public void close() throws Exception { closed = true; listener.close(); worker.join(5000); assertFalse(worker.isAlive()); assertNull(failure.get()); }
    }
    @Test public void returnsActualIssuedCookieOnlyAfterAuthenticatedPageSucceeds() throws Exception {
        try (Server server = new Server(true)) {
            assertEquals(SESSION, HostPageHandshake.verify(server.url("token=synthetic")));
            assertEquals(SESSION.split(";", 2)[0], server.sentCookie.get());
        }
    }
    @Test public void failedFinalPageAndCrossOriginRedirectAreNotAdmitted() throws Exception {
        try (Server server = new Server(false)) {
            try { HostPageHandshake.verify(server.url("token=synthetic")); fail("Expected HTTP failure"); }
            catch (IOException error) { assertTrue(error.getMessage().contains("503")); }
            try { HostPageHandshake.verify(server.url("external")); fail("Expected origin failure"); }
            catch (IOException error) { assertTrue(error.getMessage().contains("origin")); }
        }
    }
}
