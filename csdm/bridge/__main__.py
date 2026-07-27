"""Entry point: `python -m csdm.bridge`."""
import sys

from csdm.bridge.host import serve

if __name__ == "__main__":
    # The protocol is UTF-8 on both ends. Windows hands a console-codepage
    # stream by default (cp1252), and the engine logs are full of ⏸ ⛔ ═ -- one
    # of them would raise UnicodeEncodeError mid-line and corrupt the pipe.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    sys.exit(serve(sys.stdin, sys.stdout))
