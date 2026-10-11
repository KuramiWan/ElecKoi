#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>
#include <elf.h>
#include <asm/ptrace.h>

int main(int argc, char **argv) {
    if (argc < 2) return 64;
    pid_t child = fork();
    if (child < 0) { perror("fork"); return 70; }
    if (child == 0) {
        if (ptrace(PTRACE_TRACEME, 0, 0, 0) < 0) { perror("trace"); _exit(70); }
        raise(SIGSTOP);
        execv(argv[1], argv + 1);
        perror("execv"); _exit(71);
    }
    int status;
    if (waitpid(child, &status, 0) < 0) return 70;
    if (ptrace(PTRACE_SETOPTIONS, child, 0, PTRACE_O_TRACESYSGOOD | PTRACE_O_EXITKILL) < 0) {
        perror("trace-options"); kill(child, SIGKILL); return 70;
    }
    unsigned long last_call = 0;
    int deliver = 0;
    while (1) {
        if (ptrace(PTRACE_SYSCALL, child, 0, deliver) < 0) { perror("trace-next"); return 70; }
        if (waitpid(child, &status, 0) < 0) return 70;
        if (WIFEXITED(status)) return WEXITSTATUS(status);
        if (WIFSIGNALED(status)) {
            fprintf(stderr, "GLIBC_PROBE signal=%d last_syscall=%lu\n", WTERMSIG(status), last_call);
            return 128 + WTERMSIG(status);
        }
        int stopped = WSTOPSIG(status);
        struct user_pt_regs regs;
        struct iovec view = { &regs, sizeof(regs) };
        int have_regs = ptrace(PTRACE_GETREGSET, child, (void *)NT_PRSTATUS, &view) == 0;
        if (have_regs) last_call = regs.regs[8];
        if (stopped == SIGSYS) {
            siginfo_t info;
            if (ptrace(PTRACE_GETSIGINFO, child, 0, &info) == 0)
                fprintf(stderr, "GLIBC_PROBE blocked_syscall=%d signal_code=%d arch=%x\n", info.si_syscall, info.si_code, info.si_arch);
        }
        deliver = stopped == (SIGTRAP | 0x80) || stopped == SIGTRAP ? 0 : stopped;
    }
}
