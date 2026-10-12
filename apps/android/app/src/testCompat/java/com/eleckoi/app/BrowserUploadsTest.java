package com.eleckoi.app;

import org.junit.Test;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.Assert.*;

public class BrowserUploadsTest {
    @Test public void selectedStreamsRemainReadableUntilTheBrowserCloses() throws Exception {
        Path cache=Files.createTempDirectory("upload-test-");
        try(BrowserUploads uploads=new BrowserUploads(cache)) {
            List<File> files=uploads.stage(Arrays.asList(
                new BrowserUploads.Input("synthetic.png",()->new ByteArrayInputStream(new byte[]{1,2,3})),
                new BrowserUploads.Input("synthetic.png",()->new ByteArrayInputStream(new byte[]{4,5}))));
            assertEquals("synthetic.png",files.get(0).getName());
            assertArrayEquals(new byte[]{1,2,3},Files.readAllBytes(files.get(0).toPath()));
            assertArrayEquals(new byte[]{4,5},Files.readAllBytes(files.get(1).toPath()));
            assertNotEquals(files.get(0),files.get(1));
        } finally {
            try(java.util.stream.Stream<Path> children=Files.list(cache)) { assertEquals(0,children.count()); }
            Files.delete(cache);
        }
    }
    @Test public void failedOrInvalidSelectionDoesNotPublishPartialFiles() throws Exception {
        Path cache=Files.createTempDirectory("upload-test-");
        try(BrowserUploads uploads=new BrowserUploads(cache)) {
            try {
                uploads.stage(Arrays.asList(new BrowserUploads.Input("synthetic.txt",()->new InputStream() {
                    int count;
                    public int read() throws IOException { if(count++==0) return 65; throw new IOException("synthetic read failure"); }
                })));
                fail("Expected source failure");
            } catch(IOException error) { assertEquals("synthetic read failure",error.getMessage()); }
            try { uploads.stage(Arrays.asList(new BrowserUploads.Input("../outside.txt",()->new ByteArrayInputStream(new byte[0])))); fail("Expected invalid file name"); }
            catch(IOException expected) { assertTrue(expected.getMessage().contains("display name")); }
            try(java.util.stream.Stream<Path> paths=Files.walk(cache)) { assertEquals(3,paths.count()); }
        } finally { Files.delete(cache); }
    }
    @Test public void cleansInterruptedSessionsWithoutDeletingActiveUploads() throws Exception {
        Path cache=Files.createTempDirectory("upload-test-");
        Path abandoned=Files.createTempDirectory(cache,"gecko-uploads-");
        Files.write(abandoned.resolve(".owner"),new byte[0]);
        Files.write(abandoned.resolve("synthetic.txt"),new byte[]{7});
        try(BrowserUploads first=new BrowserUploads(cache)) {
            File active=first.stage(Arrays.asList(new BrowserUploads.Input("synthetic.txt",()->new ByteArrayInputStream(new byte[]{8})))).get(0);
            try(BrowserUploads second=new BrowserUploads(cache)) {
                assertFalse(Files.exists(abandoned));
                assertArrayEquals(new byte[]{8},Files.readAllBytes(active.toPath()));
            }
        } finally { Files.delete(cache); }
    }
}
