#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/stat.h>

static const char *required(const char *name) {
    const char *value = getenv(name);
    if (!value || value[0] != '/') { fprintf(stderr, "Missing absolute runtime path: %s\n", name); exit(64); }
    return value;
}

int main(int argc, char **argv) {
    const char *root = required("ELECKOI_GLIBC_ROOT");
    const char *loader = required("ELECKOI_GLIBC_LOADER");
    const char *libraries = required("ELECKOI_GLIBC_LIBRARIES");
    const char *node = required("ELECKOI_NODE_PAYLOAD");
    const char *bootstrap = required("ELECKOI_NODE_BOOTSTRAP");
    const char *execution = required("ELECKOI_GLIBC_EXEC_SHIM");
    int directory = open(root, O_RDONLY | O_DIRECTORY);
    if (directory < 0) { perror("runtime-root"); return 74; }
    if (dup2(directory, 63) < 0 || fcntl(63, F_SETFD, 0) < 0) { perror("runtime-fd"); return 74; }
    if (directory != 63) close(directory);
    char executable[4096];
    ssize_t length = readlink("/proc/self/exe", executable, sizeof(executable) - 1);
    if (length < 0 || length >= (ssize_t)sizeof(executable) - 1) return 74;
    executable[length] = '\0';
    if (setenv("ELECKOI_NODE_LAUNCHER", executable, 1) < 0) return 74;
    char **arguments = calloc((size_t)argc + 11, sizeof(char *));
    if (!arguments) return 70;
    arguments[0] = (char *)loader;
    arguments[1] = "--inhibit-cache";
    arguments[2] = "--library-path";
    arguments[3] = (char *)libraries;
    arguments[4] = "--preload";
    arguments[5] = (char *)execution;
    arguments[6] = (char *)node;
    arguments[7] = "--require";
    arguments[8] = (char *)bootstrap;
    for (int i = 1; i < argc; i++) arguments[i + 8] = argv[i];
    execv(loader, arguments);
    perror("glibc-loader"); return 71;
}
