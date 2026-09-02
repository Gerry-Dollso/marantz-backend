from pathlib import Path

path = Path("CHANGELOG.md")
text = path.read_text(encoding="utf-8")
anchor = "# Changelog\n"
marker = "## 2026-09-02 — AVR/HEOS network-path incident and recovery"

if marker in text:
    raise SystemExit("2026-09-02 AVR incident entry already present; no change made")
if text.count(anchor) != 1:
    raise SystemExit(f"expected exactly one changelog heading, found {text.count(anchor)}; no change made")

entry = """
## 2026-09-02 — AVR/HEOS network-path incident and recovery

- Investigated a live failure where voice-started IDLES playback succeeded but MarantzPi Now Playing displayed `UNKNOWN`. HEOS metadata remained valid while AVR TCP/23 status was unavailable.
- Direct tests from both Pi and HP showed TCP/23 connections could establish but initially returned zero bytes to `SI?`; HEOS 1255 remained responsive.
- Isolated the application stack before blaming code: stopped `marantz-display.service` and `marantz-backend.service`, identified `marantz-ai.service` as the llama.cpp model server, checked both hosts for AVR connections, and rebooted both machines. The direct port-23 failure persisted.
- AVR ordinary reboot/power cycling, Network Control toggling and a dedicated Network Settings reset did not individually restore the port-23 response. A firmware update also occurred during troubleshooting; do not infer that firmware caused the incident.
- The Network Settings reset temporarily left all external HEOS music services `available:false` while local HEOS sources remained available, despite HEOS account sign-in still being shown in both the app and AVR web interface.
- Recovery followed a later cold wall-power cycle that included the AVR, Pi and the physical network switch serving the AVR. TIDAL/Internet Radio returned and literal byte capture proved clean CR-terminated Marantz TCP/23 status messages (`SINET`, `ZMON`, volume/mute/zone responses). Pi `/api/status` and touchscreen operation then returned to normal.
- No production source code was changed. The network switch/path is a serious suspect, but root cause remains unproven because several devices were cold-cycled together. Preserve and capture HEOS 1255, AVR TCP/23 bytes, Pi `/api/status`, Pi/HP socket state and switch state first if this recurs.

Current tested backend source checkpoint remains:

```text
2c8ac84 — Add lightweight personalised TIDAL artwork
```

Companion Pi source checkpoint remains:

```text
300be7a — Fix personalised TIDAL artwork loading
```

"""

path.write_text(text.replace(anchor, anchor + entry, 1), encoding="utf-8")
print("Inserted guarded 2026-09-02 AVR incident changelog entry")
