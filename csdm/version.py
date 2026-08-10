"""The build's name, in one place both hosts can reach.

The Tkinter entry point used to own `APP_VERSION`, but `csdm/bridge/` must
never import that file -- it would drag Tkinter into a host that has no window.
Copying the constant into the bridge would let the two copies drift, so it
lives here instead: no imports, no side effects, safe for anything to read.
"""

APP_VERSION = "3.2.3"
