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
GRAMMAR = (
    'root ::= "power_on" | "power_off" | "volume_up" | "volume_down" | '
    '"mute" | "unmute" | "source_phono" | "source_cd" | "source_tidal" | '
    '"source_tv" | "source_aux" | "play" | "pause" | "next" | "previous" | "unknown"'
)
SYSTEM = (
    "You interpret natural spoken requests for a home audio system. "
    "Infer an intent only when the speaker clearly wants the audio system to change state. "
    "Direct requests and clear complaints about the current audio can imply an action. "
    "Complaints that the audio is too loud mean volume_down; complaints that it is too quiet mean volume_up. "
    "Mere observations, compliments, descriptions, questions, or conversation that do not clearly request a change must be unknown. "
    "When uncertain, choose unknown. Reply with only the allowed intent. Command: "
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
        "prompt": SYSTEM + command,
        "n_predict": 20,
        "temperature": 0,
        "grammar": GRAMMAR,
        "cache_prompt": True,
    }
    started = time.perf_counter()
    try:
        result = request_json("/completion", payload, timeout=30)
        elapsed = time.perf_counter() - started
    except (urllib.error.URLError, TimeoutError) as exc:
        return None, time.perf_counter() - started, str(exc)

    actual = str(result.get("content", "")).strip()
    if actual not in ALLOWED:
        actual = None
    return actual, elapsed, json.dumps(result, ensure_ascii=False)


def main():
    cases = json.loads(CASES_PATH.read_text())
    check_server()

    passed = 0
    total_time = 0.0
    failures = []

    print(f"Model: {MODEL}", flush=True)
    print(f"Cases: {len(cases)}", flush=True)
    print(f"Server: {SERVER_URL}", flush=True)
    print(flush=True)

    for index, case in enumerate(cases, 1):
        actual, elapsed, debug = classify(case["command"])
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
            failures.append({**case, "actual": actual, "debug": debug})

    accuracy = 100.0 * passed / len(cases) if cases else 0.0
    average = total_time / len(cases) if cases else 0.0
    print(flush=True)
    print(f"RESULT: {passed}/{len(cases)} = {accuracy:.1f}%", flush=True)
    print(f"AVERAGE WALL TIME: {average:.3f}s per request", flush=True)

    if failures:
        print("\nFAILURES:", flush=True)
        for failure in failures:
            print(
                f"- expected={failure['expected']} actual={failure['actual']}: "
                f"{failure['command']}",
                flush=True,
            )

    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
