"""Bridge package: the JSON/stdio transport between Electron and the engine.

Never imports Tkinter, and never imports `csdm_batch_clips_generator` -- this
is the transport layer, not the UI and not the engine.
"""
