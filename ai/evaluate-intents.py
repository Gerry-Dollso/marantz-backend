#!/usr/bin/env python3

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES_PATH = ROOT / "ai" / "intent-eval.json"
SERVER_URL = "http://127.0.0.1:8080"
MODEL = "ggml-org/Qwen3-1.7B-GGUF:Q4_K_M"
SYSTEM = (
    "You classify spoken commands for a Marantz home audio system. "
    "Infer an intent only when the speaker clearly wants the system to change state now. "
    "Use these meanings exactly: "
    "power_on means turn the Marantz on; power_off means turn it off or put it in standby; "
    "volume_up means make the current audio louder; volume_down means make it quieter; "
    "mute means silence audio; unmute means restore muted audio; "
    "source_phono means select PHONO or the record player; source_cd means select CD; "
    "source_tidal means select TIDAL or HEOS as the source; source_tv means select the TV source; "
    "source_aux means select AUX or the projector source; "
    "play means resume current playback; pause means pause current playback; "
    "next means skip to the next track; previous means go back to the previous track. "
    "Direct requests and clear complaints about current audio can imply an action. "
    "If audio is too loud choose volume_down; if it is too quiet choose volume_up. "
    "Questions, observations, compliments, hypothetical or future statements, and unsupported requests must be unknown. "
    "A phrase beginning with play is not automatically the playback-control intent: play is only for resuming current playback. "
    "When uncertain, choose unknown. "
    "Reply with only one exact intent token from: power_on, power_off, volume_up, volume_down, mute, unmute, "
    "source_phono, source_cd, source_tidal, source_tv, source_aux, play, pause, next, previous, unknown."
)
ALLOWED = {
    "power_on", "power_off", "volume_up", "volume_down", "mute", "unmute",
    "source_phono", "source_cd", "source_tidal", "source_tv", "source_aux",
    "play", "pause", "next", "previous", "unknown"
}


def request_json(path, payload=None, timeout=30):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(SERVER_URL + path, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def check_server():
    try:
        request_json("/health", timeout=3)
    except Exception as exc:
        raise SystemExit(
            "llama-server is not ready at http://127.0.0.1:8080\n"
            "Start it first with:\n\n"
            "  /opt/llama.cpp/build/bin/llama-server -hf " + MODEL +
            " -t 4 -c 1024 --reasoning off --host 127.0.0.1 --port 8080\n\n"
            f"Health check error: {exc}"
        )


def classify(command: str):
    payload = {
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": command},
        ],
        "temperature": 0,
        "max_tokens": 20,
    }
    started = time.perf_counter()
    try:
        result = request_json("/v1/chat/completions", payload, timeout=30)
        elapsed = time.perf_counter() - started
    except (urllib.error.URLError, TimeoutError) as exc:
        return None, "", time.perf_counter() - started, str(exc)

    try:
        raw = str(result["choices"][0]["message"]["content"]).strip()
    except (KeyError, IndexError, TypeError):
        raw = ""

    actual = raw if raw in ALLOWED else None
    return actual, raw, elapsed, json.dumps(result, ensure_ascii=False)


def main():
    cases = json.loads(CASES_PATH.read_text())
    check_server()

    passed = 0
    total_time = 0.0
    failures = []

    print(f"Model: {MODEL}", flush=True)
    print(f"Cases: {len(cases)}", flush=True)
    print(f"Server: {SERVER_URL} (chat completions)", flush=True)
    print(flush=True)

    for index, case in enumerate(cases, 1):
        actual, raw, elapsed, debug = classify(case["command"])
        total_time += elapsed
        ok = actual == case["expected"]
        passed += int(ok)
        status = "PASS" if ok else "FAIL"
        print(
            f"{index:02d}. {status}  expected={case['expected']:<13} "
            f"actual={str(actual):<13} {elapsed:5.2f}s  {case['command']}",
            flush=True,
        )
        if not ok:
            failures.append({**case, "actual": actual, "raw": raw, "debug": debug})

    accuracy = 100.0 * passed / len(cases) if cases else 0.0
    average = total_time / len(cases) if cases else 0.0
    print(flush=True)
    print(f"RESULT: {passed}/{len(cases)} = {accuracy:.1f}%", flush=True)
    print(f"AVERAGE WALL TIME: {average:.3f}s per request", flush=True)

    if failures:
        print("\nFAILURES:", flush=True)
        for failure in failures:
            print(
                f"- expected={failure['expected']} actual={failure['actual']} raw={failure['raw']!r}: "
                f"{failure['command']}",
                flush=True,
            )

    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
