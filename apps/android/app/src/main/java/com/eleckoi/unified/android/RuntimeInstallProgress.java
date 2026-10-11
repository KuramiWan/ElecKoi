package com.eleckoi.unified.android;

/** Byte progress is limited to copying; tar extraction has no byte completion contract. */
final class RuntimeInstallProgress {
    enum Stage { COPYING, EXTRACTING, CHECKING, STARTING }
    final Stage stage;
    final int archiveNumber, archiveCount;
    final long copiedBytes, totalBytes;

    private RuntimeInstallProgress(Stage stage, int number, int count, long copied, long total) {
        this.stage = stage; archiveNumber = number; archiveCount = count;
        copiedBytes = copied; totalBytes = total;
    }
    static RuntimeInstallProgress copying(int number, int count, long copied, long total) {
        if (number < 1 || number > count || total <= 0 || copied < 0 || copied > total)
            throw new IllegalArgumentException("Invalid runtime copy progress");
        return new RuntimeInstallProgress(Stage.COPYING, number, count, copied, total);
    }
    static RuntimeInstallProgress extracting(int number, int count) {
        if (number < 1 || number > count) throw new IllegalArgumentException("Invalid runtime archive progress");
        return new RuntimeInstallProgress(Stage.EXTRACTING, number, count, 0, 0);
    }
    static RuntimeInstallProgress checking() { return new RuntimeInstallProgress(Stage.CHECKING, 0, 0, 0, 0); }
    static RuntimeInstallProgress starting() { return new RuntimeInstallProgress(Stage.STARTING, 0, 0, 0, 0); }
    boolean indeterminate() { return stage != Stage.COPYING; }
    int percent() { return indeterminate() ? 0 : (int) (100.0 * copiedBytes / totalBytes); }
    String message() {
        switch (stage) {
            case COPYING: return "准备本地资源（" + archiveNumber + "/" + archiveCount + "）";
            case EXTRACTING: return "解压本地资源（" + archiveNumber + "/" + archiveCount + "）";
            case CHECKING: return "检查运行环境";
            case STARTING: return "正在启动…";
            default: throw new IllegalStateException("Unknown runtime installation stage");
        }
    }
}
