package com.eleckoi.app;

import org.junit.Test;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

public final class HostPageCookiesTest {
    private static String name(int port) throws Exception {
        return "dsh-auth-" + Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256").digest(("127.0.0.1:" + port).getBytes(StandardCharsets.UTF_8)));
    }
    private static String issued(int port) throws Exception {
        return name(port) + "=synthetic-session; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict";
    }
    private static final class DelayedStore implements HostPageCookies.Store {
        String stored;
        final List<String> written = new ArrayList<>();
        final Queue<HostPageCookies.Completion> callbacks = new ArrayDeque<>();
        DelayedStore(String stored) { this.stored = stored; }
        public String get(String url) { return stored; }
        public void set(String url, String header, HostPageCookies.Completion callback) {
            written.add(header); callbacks.add(callback);
        }
    }
    @Test public void retiresOnlyObsoleteOfficialSessionsAndPreservesCurrentAndPluginCookies() throws Exception {
        String old = name(31001), active = name(31002);
        List<String> updates = HostPageCookies.mutations(old + "=old; " + active + "=current; plugin=value; dsh-auth-custom=keep", issued(31002));
        assertEquals(Arrays.asList(old + "=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict", issued(31002)), updates);
        assertEquals(Collections.singletonList(issued(31002)), HostPageCookies.mutations(null, issued(31002)));
    }
    @Test public void existingAccumulationAndRepeatedPortChangesStayBounded() throws Exception {
        CookieManager jar = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        URI uri = URI.create("http://127.0.0.1:32000/");
        for (int port = 31000; port < 31069; port++) jar.put(uri, Map.of("Set-Cookie", List.of(issued(port))));
        jar.put(uri, Map.of("Set-Cookie", List.of("plugin=preserved; Path=/; Max-Age=2592000")));
        assertEquals(70, jar.getCookieStore().getCookies().size());
        for (int port = 32000; port < 32100; port++) {
            String stored = String.join("; ", jar.get(uri, Collections.emptyMap()).get("Cookie"));
            for (String update : HostPageCookies.mutations(stored, issued(port))) jar.put(uri, Map.of("Set-Cookie", List.of(update)));
            assertEquals(2, jar.getCookieStore().getCookies().size());
            assertTrue(jar.getCookieStore().getCookies().stream().anyMatch(cookie -> cookie.getName().equals("plugin") && cookie.getValue().equals("preserved")));
        }
    }
    @Test public void admitsOnlyAfterAllCookieCallbacksComplete() throws Exception {
        DelayedStore store = new DelayedStore(name(31001) + "=old");
        AtomicBoolean admitted = new AtomicBoolean();
        List<String> failures = new ArrayList<>();
        HostPageCookies.install(store, "http://127.0.0.1:31002/", issued(31002), () -> true, () -> admitted.set(true), failures::add);
        assertFalse(admitted.get()); assertEquals(1, store.written.size());
        store.callbacks.remove().complete(true);
        assertFalse(admitted.get()); assertEquals(2, store.written.size());
        store.callbacks.remove().complete(true);
        assertTrue(admitted.get()); assertTrue(failures.isEmpty());
    }
    @Test public void failedCookieWriteDoesNotAdmitPage() throws Exception {
        DelayedStore store = new DelayedStore(null);
        AtomicBoolean admitted = new AtomicBoolean();
        List<String> failures = new ArrayList<>();
        HostPageCookies.install(store, "http://127.0.0.1:31002/", issued(31002), () -> true, () -> admitted.set(true), failures::add);
        store.callbacks.remove().complete(false);
        assertFalse(admitted.get()); assertEquals(1, failures.size());
    }
    @Test public void replacedNavigationCannotContinueCookieWritesOrLoadOldPage() throws Exception {
        DelayedStore store = new DelayedStore(name(31001) + "=old");
        AtomicBoolean current = new AtomicBoolean(true), admitted = new AtomicBoolean();
        HostPageCookies.install(store, "http://127.0.0.1:31002/", issued(31002), current::get, () -> admitted.set(true), error -> fail(error));
        current.set(false); store.callbacks.remove().complete(true);
        assertEquals(1, store.written.size()); assertFalse(admitted.get());
    }
    @Test public void unsupportedSessionIsVisibleAndDoesNotMutateExistingCookies() {
        DelayedStore store = new DelayedStore("plugin=preserved");
        List<String> failures = new ArrayList<>();
        HostPageCookies.install(store, "http://127.0.0.1:31002/", "unknown=value", () -> true, () -> fail("Unexpected admission"), failures::add);
        assertTrue(store.written.isEmpty()); assertEquals(1, failures.size());
    }
}
