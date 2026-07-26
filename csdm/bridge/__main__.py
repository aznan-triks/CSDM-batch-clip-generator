"""Entry point: `python -m csdm.bridge`."""
import sys

from csdm.bridge.host import serve

if __name__ == "__main__":
    sys.exit(serve(sys.stdin, sys.stdout))
