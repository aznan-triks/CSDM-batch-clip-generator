"""Entry point: `python -m csdm.bridge`."""
import os
import sys

from csdm.bridge.host import serve


def protocol_stdin():
    """The command pipe, moved off the process's standard input.

    Windows: while the main thread sits in a blocking read on the standard
    input pipe, a worker thread that loads numpy for the first time hangs
    forever. py-spy on a stuck process showed the worker inside
    `LoadLibraryExW` -> `RtlEnterCriticalSection` while the main thread sat in
    `ReadFile` on stdin, and the same hang reproduced in isolation from just
    those two threads -- but the exact call inside the DLL's initialisation
    that the two threads collide on is inferred from that trace, not pinned
    down. `serve()` waits on stdin for its whole life, and the first
    demoparser2 parse imports numpy on a pre-parse worker -- so every dp2
    filter froze the preview for good.

    The fix is to read the pipe through a private duplicate and point the
    standard input (fd 0 and the Win32 std handle) at NUL, so nothing loaded
    later can collide with the pending read. Elsewhere stdin is returned as is.
    """
    if sys.platform != "win32":
        reconfigure = getattr(sys.stdin, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
        return sys.stdin
    import ctypes
    import msvcrt

    pipe_fd = os.dup(0)
    nul_fd = os.open(os.devnull, os.O_RDONLY)
    os.dup2(nul_fd, 0)
    os.close(nul_fd)
    std_input_handle = ctypes.c_uint32(-10 & 0xFFFFFFFF)  # STD_INPUT_HANDLE
    ctypes.windll.kernel32.SetStdHandle(
        std_input_handle, ctypes.c_void_p(msvcrt.get_osfhandle(0)))
    return open(pipe_fd, "r", encoding="utf-8", errors="replace", closefd=True)


if __name__ == "__main__":
    # The protocol is UTF-8 on both ends. Windows hands a console-codepage
    # stream by default (cp1252), and the engine logs are full of ⏸ ⛔ ═ -- one
    # of them would raise UnicodeEncodeError mid-line and corrupt the pipe.
    # stdin is excluded: protocol_stdin() already opens its own handle with
    # encoding="utf-8" explicitly, and on Windows sys.stdin now reads NUL.
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    sys.exit(serve(protocol_stdin(), sys.stdout))
