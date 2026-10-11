#define _GNU_SOURCE
#include <dlfcn.h>
#include <elf.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/fs.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// The glibc loader resolves this ELF; no Bionic library is linked into it.
#undef errno
extern int *__errno_location(void);
#define errno (*__errno_location())
extern char **environ;
extern int renameat2(int, const char *, int, const char *, unsigned int);
extern const char *strerrorname_np(int);

// Publish a complete temporary file without overwriting an existing destination.
const char *eleckoi_publish_file(const char *source, const char *destination) {
    if (renameat2(AT_FDCWD, source, AT_FDCWD, destination, RENAME_NOREPLACE) == 0) return NULL;
    const char *code = strerrorname_np(errno);
    return code ? code : "ANDROID_PUBLICATION_UNKNOWN_ERRNO";
}
typedef int (*Execve)(const char *, char *const[], char *const[]);
static Execve system_execve;
static char *runtime_root, *rootfs, *node_payload, *node_launcher;
static const char *glibc_root, *loader, *libraries, *execution;
static const char *keys[] = {
    "ELECKOI_GLIBC_ROOT", "ELECKOI_GLIBC_LOADER", "ELECKOI_GLIBC_LIBRARIES",
    "ELECKOI_GLIBC_EXEC_SHIM", "ELECKOI_NODE_PAYLOAD", "ELECKOI_NODE_BOOTSTRAP",
    "ELECKOI_NODE_LAUNCHER", "ELECKOI_LINUX_ROOTFS", "ELECKOI_RUNTIME_ROOT",
    "ELECKOI_NATIVE_DIRECTORY", "ELECKOI_RESOLVER"
};
static char *facts[sizeof(keys) / sizeof(keys[0])];
static size_t entries(char *const values[]) {
    size_t count = 0;
    if (values) while (values[count]) count++;
    return count;
}
static int underneath(const char *file, const char *root) {
    size_t length = strlen(root);
    return strncmp(file, root, length) == 0 && (file[length] == '/' || file[length] == '\0');
}
static char *append(const char *left, const char *right) {
    size_t a = strlen(left), b = strlen(right);
    char *value = malloc(a + b + 1);
    if (value) { memcpy(value, left, a); memcpy(value + a, right, b + 1); }
    return value;
}
static const char *required(const char *name) {
    const char *value = getenv(name);
    if (!value || value[0] != '/') {
        const char message[] = "Android Linux execution configuration is incomplete\n";
        write(2, message, sizeof(message) - 1); _exit(64);
    }
    return value;
}
__attribute__((constructor)) static void initialize(void) {
    system_execve = (Execve)dlsym(RTLD_NEXT, "execve");
    if (!system_execve) _exit(70);
    for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); i++) {
        char *prefix = append(keys[i], "=");
        facts[i] = prefix ? append(prefix, required(keys[i])) : NULL;
        free(prefix);
        if (!facts[i]) _exit(70);
    }
    runtime_root = realpath(required("ELECKOI_RUNTIME_ROOT"), NULL);
    rootfs = realpath(required("ELECKOI_LINUX_ROOTFS"), NULL);
    node_payload = realpath(required("ELECKOI_NODE_PAYLOAD"), NULL);
    node_launcher = realpath(required("ELECKOI_NODE_LAUNCHER"), NULL);
    glibc_root = required("ELECKOI_GLIBC_ROOT"); loader = required("ELECKOI_GLIBC_LOADER");
    libraries = required("ELECKOI_GLIBC_LIBRARIES"); execution = required("ELECKOI_GLIBC_EXEC_SHIM");
    if (!runtime_root || !rootfs || !node_payload || !node_launcher) _exit(74);
}
static char **execution_environment(char *const original[]) {
    size_t count = entries(original), total = sizeof(keys) / sizeof(keys[0]);
    char **values = calloc(count + total + 1, sizeof(char *));
    if (!values) { errno = ENOMEM; return NULL; }
    size_t next = 0;
    for (size_t i = 0; i < count; i++) {
        int owned = 0;
        for (size_t j = 0; j < total; j++) {
            size_t length = strlen(keys[j]);
            if (strncmp(original[i], keys[j], length) == 0 && original[i][length] == '=') { owned = 1; break; }
        }
        if (!owned) values[next++] = original[i];
    }
    for (size_t i = 0; i < total; i++) values[next++] = facts[i];
    return values;
}

static int execute(const char *file, char *const argv[], char *const envp[], unsigned depth) {
    if (depth > 5) { errno = ELOOP; return -1; }
    char *translated = NULL;
    // Linux system executable paths have an explicit root; Android uses /system/bin.
    if (strncmp(file, "/usr/", 5) == 0 || strncmp(file, "/bin/", 5) == 0 || strncmp(file, "/sbin/", 6) == 0)
        translated = append(rootfs, file);
    const char *target = translated ? translated : file;
    char *canonical = realpath(target, NULL);
    if (!canonical) { int failure = errno; free(translated); errno = failure; return -1; }
    int launcher = strcmp(canonical, node_launcher) == 0 || strcmp(canonical, node_payload) == 0;
    if (!launcher && !underneath(canonical, runtime_root)) {
        free(canonical); free(translated); return system_execve(file, argv, envp);
    }
    int result = -1;
    char **environment = NULL, **arguments = NULL;
    int descriptor = -1, directory = -1;
    if (access(canonical, X_OK) != 0) goto cleanup;
    environment = execution_environment(envp);
    if (!environment) goto cleanup;
    if (launcher) { result = system_execve(node_launcher, argv, environment); goto cleanup; }
    descriptor = open(canonical, O_RDONLY);
    if (descriptor < 0) goto cleanup;
    unsigned char header[256];
    ssize_t bytes = read(descriptor, header, sizeof(header));
    if (bytes < 0) { if (errno == EISDIR) errno = EACCES; goto cleanup; }
    size_t argc = entries(argv);
    if (bytes >= 2 && header[0] == '#' && header[1] == '!') {
        // Linux shebang syntax has one optional interpreter argument.
        size_t end = 2;
        while (end < (size_t)bytes && header[end] != '\n' && header[end] != '\0') end++;
        if (end == sizeof(header)) { errno = ENOEXEC; goto cleanup; }
        header[end] = '\0';
        while (end > 2 && (header[end - 1] == ' ' || header[end - 1] == '\t')) header[--end] = '\0';
        char *interpreter = (char *)header + 2;
        while (*interpreter == ' ' || *interpreter == '\t') interpreter++;
        char *optional = interpreter;
        while (*optional && *optional != ' ' && *optional != '\t') optional++;
        if (*optional) {
            *optional++ = '\0';
            while (*optional == ' ' || *optional == '\t') optional++;
        }
        if (!*interpreter) { errno = ENOEXEC; goto cleanup; }
        arguments = calloc(argc + 4, sizeof(char *));
        if (!arguments) { errno = ENOMEM; goto cleanup; }
        size_t next = 0;
        arguments[next++] = interpreter;
        if (*optional) arguments[next++] = optional;
        arguments[next++] = canonical;
        for (size_t i = 1; i < argc; i++) arguments[next++] = argv[i];
        result = execute(interpreter, arguments, environment, depth + 1);
        goto cleanup;
    }
    if (bytes < (ssize_t)sizeof(Elf64_Ehdr) || memcmp(header, ELFMAG, SELFMAG) != 0
        || header[EI_CLASS] != ELFCLASS64 || header[EI_DATA] != ELFDATA2LSB
        || ((Elf64_Ehdr *)header)->e_machine != EM_AARCH64) { errno = ENOEXEC; goto cleanup; }
    directory = open(glibc_root, O_RDONLY | O_DIRECTORY);
    if (directory < 0 || dup2(directory, 63) < 0 || fcntl(63, F_SETFD, 0) < 0) goto cleanup;
    if (directory != 63) { close(directory); directory = -1; }
    arguments = calloc(argc + 11, sizeof(char *));
    if (!arguments) { errno = ENOMEM; goto cleanup; }
    arguments[0] = (char *)loader;
    arguments[1] = "--inhibit-cache"; arguments[2] = "--library-path"; arguments[3] = (char *)libraries;
    arguments[4] = "--preload"; arguments[5] = (char *)execution;
    arguments[6] = "--argv0"; arguments[7] = argc ? argv[0] : canonical;
    arguments[8] = canonical;
    for (size_t i = 1; i < argc; i++) arguments[i + 8] = argv[i];
    result = system_execve(loader, arguments, environment);
cleanup:;
    int failure = errno;
    if (descriptor >= 0) close(descriptor);
    if (directory >= 0 && directory != 63) close(directory);
    free(canonical); free(translated); free(environment); free(arguments);
    errno = failure; return result;
}
int execve(const char *file, char *const argv[], char *const envp[]) { return execute(file, argv, envp, 0); }
static int execute_script(const char *file, char *const argv[], char *const envp[]) {
    size_t count = entries(argv);
    char **arguments = calloc(count + 3, sizeof(char *));
    if (!arguments) { errno = ENOMEM; return -1; }
    arguments[0] = "/bin/sh"; arguments[1] = (char *)file;
    for (size_t i = 1; i < count; i++) arguments[i + 1] = argv[i];
    int result = execve("/bin/sh", arguments, envp), failure = errno;
    free(arguments); errno = failure; return result;
}
int execv(const char *file, char *const argv[]) { return execve(file, argv, environ); }
int execvpe(const char *file, char *const argv[], char *const envp[]) {
    if (!*file) { errno = ENOENT; return -1; }
    if (strchr(file, '/')) {
        int result = execve(file, argv, envp);
        return errno == ENOEXEC ? execute_script(file, argv, envp) : result;
    }
    const char *paths = getenv("PATH");
    if (!paths) paths = "/bin:/usr/bin";
    int denied = 0;
    while (1) {
        const char *end = strchr(paths, ':');
        size_t length = end ? (size_t)(end - paths) : strlen(paths);
        char *candidate = malloc(length + strlen(file) + 2);
        if (!candidate) { errno = ENOMEM; return -1; }
        memcpy(candidate, paths, length);
        if (length) candidate[length++] = '/';
        strcpy(candidate + length, file);
        execve(candidate, argv, envp);
        if (errno == ENOEXEC) execute_script(candidate, argv, envp);
        int failure = errno;
        free(candidate);
        if (failure == EACCES) denied = 1;
        else if (failure != ENOENT && failure != ENOTDIR) { errno = failure; return -1; }
        if (!end) break;
        paths = end + 1;
    }
    errno = denied ? EACCES : ENOENT; return -1;
}
int execvp(const char *file, char *const argv[]) { return execvpe(file, argv, environ); }
