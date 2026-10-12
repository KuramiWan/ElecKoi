package com.eleckoi.app;

import java.io.*;
import java.nio.channels.*;
import java.nio.file.*;
import java.util.*;

/** Owns readable upload files for the lifetime of one browser session. */
final class BrowserUploads implements AutoCloseable {
    interface Source { InputStream open() throws IOException; }
    static final class Input {
        final String name; final Source source;
        Input(String name, Source source) { this.name=name; this.source=source; }
    }
    private final Path root;
    private final FileChannel owner;
    private final FileLock ownership;
    BrowserUploads(Path cache) throws IOException {
        pruneClosedSessions(cache);
        root=Files.createTempDirectory(cache,"gecko-uploads-");
        owner=FileChannel.open(root.resolve(".owner"),StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);
        ownership=owner.lock();
    }
    private static synchronized void pruneClosedSessions(Path cache) throws IOException {
        try(DirectoryStream<Path> sessions=Files.newDirectoryStream(cache,"gecko-uploads-*")) {
            for(Path session:sessions) {
                if(!Files.isDirectory(session,LinkOption.NOFOLLOW_LINKS)) continue;
                Path marker=session.resolve(".owner");
                if(!Files.isRegularFile(marker,LinkOption.NOFOLLOW_LINKS)) {
                    try(DirectoryStream<Path> children=Files.newDirectoryStream(session)) {
                        if(!children.iterator().hasNext()) Files.delete(session);
                    }
                    continue;
                }
                boolean abandoned=false;
                try(FileChannel channel=FileChannel.open(marker,StandardOpenOption.WRITE)) {
                    try(FileLock lock=channel.tryLock()) { abandoned=lock!=null; }
                    catch(OverlappingFileLockException activeSession) { continue; }
                }
                if(abandoned) deleteSession(session);
            }
        }
    }
    private static void deleteSession(Path directory) throws IOException {
        try(java.util.stream.Stream<Path> paths=Files.walk(directory)) {
            for(Path file:paths.sorted(Comparator.reverseOrder()).toArray(Path[]::new)) Files.delete(file);
        }
    }
    synchronized List<File> stage(List<Input> inputs) throws IOException {
        if(!Files.isDirectory(root)) throw new IOException("Upload session is closed");
        List<File> staged=new ArrayList<>();
        List<Path> owned=new ArrayList<>();
        try {
            for(Input input:inputs) {
                if(input.name==null || input.name.isEmpty() || input.name.equals(".") || input.name.equals("..")
                    || input.name.indexOf('/')>=0 || input.name.indexOf('\\')>=0 || input.name.indexOf('\0')>=0)
                    throw new IOException("Selected file has no valid display name");
                Path directory=Files.createTempDirectory(root,"selection-"); owned.add(directory);
                Path file=directory.resolve(input.name); owned.add(file);
                try(InputStream source=input.source.open()) {
                    if(source==null) throw new IOException("Selected file could not be opened");
                    Files.copy(source,file);
                }
                staged.add(file.toFile());
            }
            return staged;
        } catch(Exception failure) {
            IOException error=failure instanceof IOException?(IOException)failure:new IOException(failure);
            Collections.reverse(owned);
            for(Path file:owned) try { Files.deleteIfExists(file); } catch(IOException cleanup) { error.addSuppressed(cleanup); }
            throw error;
        }
    }
    @Override public synchronized void close() throws IOException {
        if(!owner.isOpen()) return;
        try { ownership.release(); } finally { owner.close(); }
        deleteSession(root);
    }
}
