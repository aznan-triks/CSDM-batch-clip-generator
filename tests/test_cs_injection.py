import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from csdm_batch_clips_generator import App, CSDM_RUNTIME_CFG_NAME, CSDM_RUNTIME_BLOCK_START, CSDM_RUNTIME_BLOCK_END


class _Var:
    def __init__(self, v):
        self._v = v

    def get(self):
        return self._v

    def set(self, v):
        self._v = v


class _PlayerStub:
    def get_steam_ids(self):
        return []

    def get_steam_id(self):
        return ""

    def get_name(self):
        return ""


class CSInjectionTests(unittest.TestCase):
    def setUp(self):
        self.app = App.__new__(App)
        self.logs = []

        # Capture log output instead of writing to the (uninitialised) Tk widget.
        # NOTE: the single _alog method was split/renamed to _log + _async_log in
        # v191; _log/_log_parts touch self.log, and the async variants call
        # self.after — both blow up on a bare App.__new__ instance. Stub all four.
        def _cap(msg, tag=""):
            self.logs.append((tag, msg))

        def _cap_parts(parts):
            self.logs.append(("parts", parts))

        self.app._log = _cap
        self.app._async_log = _cap
        self.app._log_parts = _cap_parts
        self.app._async_log_parts = _cap_parts

        # _FILTER_BADGE_DEFS is a cached property derived purely from
        # KILL_FILTER_REGISTRY. Pre-seed its backing cache so the property does
        # not fall through to tk.Tk.__getattr__ — which recurses forever on a
        # bare App.__new__ instance (self.tk is never set).
        # The property now lives on EngineMixin (chantier 1.5, task 4), so the
        # name-mangled cache attribute is `_EngineMixin__...`, not `_App__...`.
        self.app._EngineMixin__filter_badge_defs_cache = App._get_filter_badge_defs()

    def test_common_cs2_injection(self):
        cfg = {
            "cs2_window_mode": "noborder",
            "phys_ragdoll_gravity": 500,
            "phys_ragdoll_scale": "0.8",
            "phys_sv_gravity": 700,
            "phys_ragdoll_enable": False,
            "phys_blood": False,
            "phys_dynamic_lighting": True,
        }
        shared = self.app._common_cs2_injection(cfg)
        self.assertEqual(shared["launch_args"], ["-windowed", "-noborder"])
        cmd_str = "\n".join(shared["console_cmds"])
        self.assertIn("cl_ragdoll_gravity 500", cmd_str)
        self.assertIn("ragdoll_gravity_scale 0.8", cmd_str)
        self.assertIn("sv_gravity 700", cmd_str)
        self.assertIn("cl_ragdoll_physics_enable 0", cmd_str)
        self.assertIn("violence_hblood 0", cmd_str)
        self.assertIn("r_dynamic 1", cmd_str)

    def test_inject_cs_runtime_cfg_writes_runtime_and_autoexec(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg_dir = Path(tmp)
            autoexec = cfg_dir / "autoexec.cfg"
            autoexec.write_text("echo hello\n", encoding="utf-8")

            self.app._resolve_cs2_cfg_dir = lambda cfg: str(cfg_dir)
            cfg = {
                "hlae_slow_motion": 80,
                "hlae_no_spectator_ui": True,
            }
            shared = {
                "launch_args": ["-windowed"],
                "console_cmds": ["sv_gravity 700"],
            }

            ok = self.app._inject_cs_runtime_cfg(cfg, shared)
            self.assertTrue(ok)

            runtime_path = cfg_dir / CSDM_RUNTIME_CFG_NAME
            self.assertTrue(runtime_path.exists())
            runtime = runtime_path.read_text(encoding="utf-8")
            self.assertIn("sv_gravity 700", runtime)
            self.assertIn("host_timescale 0.8", runtime)
            self.assertIn("cl_draw_only_deathnotices 1", runtime)

            autoexec_txt = autoexec.read_text(encoding="utf-8")
            self.assertIn(CSDM_RUNTIME_BLOCK_START, autoexec_txt)
            self.assertIn(CSDM_RUNTIME_BLOCK_END, autoexec_txt)
            self.assertIn(f"exec {Path(CSDM_RUNTIME_CFG_NAME).stem}", autoexec_txt)

            ok2 = self.app._inject_cs_runtime_cfg(cfg, shared)
            self.assertTrue(ok2)
            autoexec_txt2 = autoexec.read_text(encoding="utf-8")
            self.assertEqual(autoexec_txt2.count(CSDM_RUNTIME_BLOCK_START), 1)

    def test_invalid_cfg_values_are_parsed_with_fallbacks(self):
        bad_cfg = {
            "cs2_window_mode": "windowed",
            "phys_ragdoll_gravity": "abc",
            "phys_ragdoll_scale": "nanx",
            "phys_sv_gravity": None,
            "phys_ragdoll_enable": "maybe",
            "phys_blood": "0",
            "phys_dynamic_lighting": "yes",
        }
        shared = self.app._common_cs2_injection(bad_cfg)
        self.assertIn("-windowed", shared["launch_args"])
        cmd_str = "\n".join(shared["console_cmds"])
        self.assertIn("cl_ragdoll_gravity 600", cmd_str)
        self.assertIn("ragdoll_gravity_scale 1.0", cmd_str)
        self.assertIn("sv_gravity 800", cmd_str)
        self.assertIn("cl_ragdoll_physics_enable 1", cmd_str)
        self.assertIn("violence_hblood 0", cmd_str)
        self.assertIn("r_dynamic 1", cmd_str)

    def test_resolve_cfg_dir_uses_manual_override_when_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = {"cs2_cfg_dir": tmp}
            out = self.app._resolve_cs2_cfg_dir(cfg)
            self.assertEqual(Path(out).resolve(), Path(tmp).resolve())

    def test_runtime_cfg_permission_error_is_handled(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg_dir = Path(tmp)
            self.app._resolve_cs2_cfg_dir = lambda cfg: str(cfg_dir)
            cfg = {
                "hlae_slow_motion": 100,
                "hlae_no_spectator_ui": True,
            }
            shared = {"launch_args": [], "console_cmds": ["sv_gravity 800"]}

            real_write = Path.write_text

            def side_effect(path_obj, *args, **kwargs):
                if str(path_obj).endswith(CSDM_RUNTIME_CFG_NAME):
                    raise PermissionError("blocked")
                return real_write(path_obj, *args, **kwargs)

            with patch.object(Path, "write_text", autospec=True, side_effect=side_effect):
                ok = self.app._inject_cs_runtime_cfg(cfg, shared)
            self.assertFalse(ok)

    def test_apply_config_coerces_legacy_encoder(self):
        # Legacy "VirtualDub" encoder is coerced to "FFmpeg" on load.
        # (recording_output images/video setting was removed from the app.)
        self.app.v = {
            "encoder": _Var("VirtualDub"),
        }
        self.app.sel_events = {}
        self.app.sel_weapons = {}
        self.app.player_search = _PlayerStub()
        self.app._apply_config({"encoder": "VirtualDub"})
        self.assertEqual(self.app.v["encoder"].get(), "FFmpeg")

    def test_collect_config_coerces_legacy_encoder(self):
        # Legacy "VirtualDub" encoder is coerced to "FFmpeg" when collecting cfg.
        # (recording_output images/video setting was removed from the app.)
        self.app.v = {
            "resolution": _Var("1920x1080"),
            "encoder": _Var("VirtualDub"),
            "pg_host": _Var(""), "pg_port": _Var(""), "pg_user": _Var(""),
            "pg_pass": _Var(""), "pg_db": _Var(""),
        }
        self.app.sel_events = {}
        self.app.sel_weapons = {}
        self.app._map_filter_vars = {}
        self.app.player_search = _PlayerStub()
        self.app._get_active_tag_names = lambda: []
        cfg = self.app._collect_config()
        self.assertEqual(cfg["encoder"], "FFmpeg")

    def test_build_clip_badges_content_and_filter(self):
        cfg = {
            "kill_mod_one_tap": True,
            "kill_mod_flick": True,
        }
        events = [
            {"type": "kill", "weapon": "AWP"},
            {"type": "kill", "weapon": "deagle"},
        ]
        badges = self.app._build_clip_badges(events, cfg)
        merged = "".join(t for t, _ in badges)
        # Content badge: 2 kills with their weapons.
        self.assertIn("2✕", merged)
        self.assertIn("AWP", merged)
        # Active kill filters add badges on top of the content badge.
        self.assertTrue(any(tag == "badge_filter" for _, tag in badges))
        self.assertGreater(
            len(badges), len(self.app._build_clip_badges(events, {}))
        )

    def test_build_clip_badges_round_marker_when_no_kills(self):
        cfg = {}
        events = [{"type": "round", "weapon": ""}]
        badges = self.app._build_clip_badges(events, cfg)
        self.assertEqual(badges[0], (" [ROUND]", "badge_safe"))

    def test_clamp_layout_values_bounds(self):
        w, h, split = self.app._clamp_layout_values("99999", "100", "5")
        # split lower bound is 38 % (left panel min width), not 30 %.
        self.assertEqual((w, h, split), (3840, 600, 38))
        w2, h2, split2 = self.app._clamp_layout_values("1200", "800", "70")
        self.assertEqual((w2, h2, split2), (1200, 800, 70))

    def test_build_demo_log_base_preview_and_run_shapes(self):
        p = self.app._build_demo_log_base("01 01 2026", "demo.dem", 3, 2)
        r = self.app._build_demo_log_base("01 01 2026", "demo.dem", 3, 2, idx=4, total=10, timing_str="  ⏱ seq 2.0ms")
        self.assertEqual(p, "  01 01 2026  demo.dem  (3 events → 2 seq)")
        self.assertTrue(r.startswith("\n[4/10]"))
        self.assertIn("⏱", r)


if __name__ == "__main__":
    unittest.main()
