#!/usr/bin/env python3

import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES_PATH = ROOT / "ai" / "intent-eval.json"
LLAMA = Path("/opt/llama.cpp/build/bin/llama-cli")
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


def classify(command: str):
    args = [
        str(LLAMA),
        "-hf", MODEL,
        "-t", "4",
        "-c", "1024",
        "-n", "20",
        "--reasoning", "off",
        "--temp", "0",
        "--grammar", GRAMMAR,
        "-p", SYSTEM + command,
        "--no-display-prompt",
        "--simple-io",
    ]

    started = time.perf_counter()
    proc = subprocess.run(args, text=True, capture_output=True)
    elapsed = time.perf_counter() - started

    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    if proc.returncode != 0:
        return None, elapsed, combined.strip()

    tokens = re.findall(r"\b(?:power_on|power_off|volume_up|volume_down|mute|unmute|source_phono|source_cd|source_tidal|source_tv|source_aux|play|pause|next|previous|unknown)\b", proc.stdout or "")
    actual = tokens[-1] if tokens else None
    if actual not in ALLOWED:
        actual = None
    return actual, elapsed, combined.strip()


def main():
    if not LLAMA.exists():
        raise SystemExit(f"Missing llama-cli: {LLAMA}")
    cases = json.loads(CASES_PATH.read_text())

    passed = 0
    total_time = 0.0
    failures = []

    print(f"Model: {MODEL}")
    print(f"Cases: {len(cases)}")
    print()

    for index, case in enumerate(cases, 1):
        actual, elapsed, debug = classify(case["command"])
        total_time += elapsed
        ok = actual == case["expected"]
        passed += int(ok)
        status = "PASS" if ok else "FAIL"
        print(
            f"{index:02d}. {status}  expected={case['expected']:<13} "
            f"actual={str(actual):<13} {elapsed:5.2f}s  {case['command']}"
        )
        if not ok:
            failures.append({**case, "actual": actual, "debug": debug})

    accuracy = 100.0 * passed / len(cases) if cases else 0.0
    average = total_time / len(cases) if cases else 0.0
    print()
    print(f"RESULT: {passed}/{len(cases)} = {accuracy:.1f}%")
    print(f"AVERAGE WALL TIME: {average:.2f}s per isolated invocation")

    if failures:
        print("\nFAILURES:")
        for failure in failures:
            print(
                f"- expected={failure['expected']} actual={failure['actual']}: "
                f"{failure['command']}"
            )

    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
