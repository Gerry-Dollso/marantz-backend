#!/usr/bin/env python3

import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CASES_PATH = ROOT / "ai" / "intent-eval.json"
SERVER_URL = "http://127.0.0.1:8080"
DEFAULT_MODEL = "ggml-org/Qwen3-4B-GGUF:Q4_K_M"
SYSTEM = (
    "You classify spoken commands for a Marantz home audio system. "
    "Infer an intent only when the speaker clearly wants the system to change state now. "
    "Use these meanings exactly: "
    "power_on means turn the Marantz or receiver on; power_off means turn it off, put it in standby, or put the receiver to sleep; "
    "volume_up means make the current audio louder; volume_down means make it quieter; "
    "mute means silence audio; unmute means restore sound after mute, including requests for the sound or audio to come back on; "
    "source_phono means select PHONO or the record player; source_cd means select CD; "
    "source_tidal means select TIDAL or HEOS as the source; source_tv means select the TV source; "
    "source_aux means select AUX or the projector source; "
    "play means start or resume current playback, continue/carry on with the current music, or keep current playback going; "
    "pause means pause or temporarily hold current playback; "
    "next means advance from the current track to the next track, including requests to skip the current song; "
    "previous means go back to the previous track. "
    "A command may be short or elliptical and does not need a full sentence when its requested action is still clear. "
    "Polite requests such as 'could you' or 'would you' are commands when they clearly ask the system to perform an action now. "
    "Direct requests and clear complaints about current audio can imply an action. "
    "If audio is too loud choose volume_down; if it is too quiet choose volume_up. "
    "Questions, suggestions, and requests for an opinion or information are unknown unless they explicitly and unambiguously instruct the system to change state now. "
    "Do not turn a question about whether something is loud or quiet into a volume command. "
    "Negated commands that tell the system not to do something are unknown; never infer the opposite action from a negation. "
    "Observations, compliments, hypothetical or future statements, and unsupported requests must be unknown. "
    "A phrase beginning with play is not automatically the playback-control intent: play is only for starting, resuming, continuing, or keeping current playback going, not for selecting arbitrary media by name. "
    "When uncertain, choose unknown. "
    "Reply with only one exact intent token from: power_on, power_off, volume_up, volume_down, mute, unmute, "
    "source_phono, source_cd, source_tidal, source_tv, source_aux, play, pause, next, previous, unknown."
)
ALLOWED = {
    "power_on", "power_off", "volume_up", "volume_down", "mute", "unmute",
    "source_phono", "source_cd", "source_tidal", "source_tv", "source_aux",
    "play", "pause", "next", "previous", "unknown"
}

NEGATION_RE = re.compile(r"\b(?:don't|dont|do not|never|not)\b", re.IGNORECASE)
FUTURE_RE = re.compile(
    r"\b(?:later|tomorrow|tonight|next week|this evening|sometime|when (?:it|this|that|the (?:song|track|music|playback)) (?:starts?|begins?|finishes?|ends?))\b",
    re.IGNORECASE,
)
QUESTION_START_RE = re.compile(
    r"^(?:is|are|am|was|were|did|does|do|has|have|had|which|what|why|when|where|who|how|should|could|would|can)\b",
    re.IGNORECASE,
)
POLITE_COMMAND_START_RE = re.compile(
    r"^(?:could|would|can|will)\s+you\b|^(?:please\b)",
    re.IGNORECASE,
)
OBSERVATION_START_RE = re.compile(r"^(?:the|this|that|it|my|your|our|playback)\b", re.IGNORECASE)
OBSERVATION_ACTION_RE = re.compile(
    r"\b(?:icon|showing|shows|uses|looks|seems|currently|already|source is|input is|has stopped|has started|has paused|is stopped|is paused|is playing)\b",
    re.IGNORECASE,
)


def safety_gate(command: str):
    """Return a reason when a command must be forced to unknown, else None."""
    text = " ".join(str(command).strip().split())
    if not text:
        return "empty"
    if NEGATION_RE.search(text):
        return "negation"
    if FUTURE_RE.search(text):
        return "future"
    if QUESTION_START_RE.search(text) and not POLITE_COMMAND_START_RE.search(text):
        return "question"
    if text.endswith("?") and not POLITE_COMMAND_START_RE.search(text):
        return "question"
    if OBSERVATION_START_RE.search(text) and OBSERVATION_ACTION_RE.search(text):
        return "observation"
    return None


def request_json(path, payload=None, timeout=30):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(SERVER_URL + path, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_server_model():
    try:
        result = request_json("/v1/models", timeout=3)
        models = result.get("data", [])
        if models:
            return str(models[0].get("id") or models[0].get("model") or DEFAULT_MODEL)
    except Exception:
        pass
    return DEFAULT_MODEL


def check_server():
    try:
        request_json("/health", timeout=3)
    except Exception as exc:
        raise SystemExit(
            "llama-server is not ready at http://127.0.0.1:8080\n"
            "Start it first with:\n\n"
            "  /opt/llama.cpp/build/bin/llama-server -hf " + DEFAULT_MODEL +
            " -t 4 -c 1024 --reasoning off --host 127.0.0.1 --port 8080\n\n"
            f"Health check error: {exc}"
        )


def classify(command: str):
    gate_reason = safety_gate(command)
    if gate_reason:
        return "unknown", f"safety:{gate_reason}", 0.0, "", gate_reason

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
        return None, "", time.perf_counter() - started, str(exc), None

    try:
        raw = str(result["choices"][0]["message"]["content"]).strip()
    except (KeyError, IndexError, TypeError):
        raw = ""

    actual = raw if raw in ALLOWED else None
    return actual, raw, elapsed, json.dumps(result, ensure_ascii=False), None


def resolve_cases_path():
    if len(sys.argv) < 2:
        return DEFAULT_CASES_PATH
    requested = Path(sys.argv[1])
    if not requested.is_absolute():
        requested = ROOT / requested
    return requested


def main():
    cases_path = resolve_cases_path()
    if not cases_path.exists():
        raise SystemExit(f"Missing case file: {cases_path}")

    cases = json.loads(cases_path.read_text())
    check_server()
    model = get_server_model()

    passed = 0
    timings = []
    failures = []
    categories = defaultdict(lambda: {"passed": 0, "total": 0})
    unsafe_false_positives = 0
    missed_commands = 0
    wrong_actions = 0
    gated = defaultdict(int)

    print(f"Model: {model}", flush=True)
    print(f"Cases: {len(cases)} ({cases_path.name})", flush=True)
    print(f"Server: {SERVER_URL} (chat completions + deterministic safety gate)", flush=True)
    print(flush=True)

    for index, case in enumerate(cases, 1):
        actual, raw, elapsed, debug, gate_reason = classify(case["command"])
        if gate_reason:
            gated[gate_reason] += 1
        else:
            timings.append(elapsed)
        ok = actual == case["expected"]
        passed += int(ok)

        category = str(case.get("category") or "uncategorized")
        categories[category]["total"] += 1
        categories[category]["passed"] += int(ok)

        if not ok:
            if case["expected"] == "unknown" and actual not in (None, "unknown"):
                unsafe_false_positives += 1
            elif case["expected"] != "unknown" and actual in (None, "unknown"):
                missed_commands += 1
            elif case["expected"] != "unknown" and actual not in (None, "unknown"):
                wrong_actions += 1

        status = "PASS" if ok else "FAIL"
        gate_label = f" gate={gate_reason}" if gate_reason else ""
        print(
            f"{index:02d}. {status}  expected={case['expected']:<13} "
            f"actual={str(actual):<13} {elapsed:5.2f}s{gate_label}  {case['command']}",
            flush=True,
        )
        if not ok:
            failures.append({**case, "actual": actual, "raw": raw, "debug": debug, "gate": gate_reason})

    accuracy = 100.0 * passed / len(cases) if cases else 0.0
    average = sum(timings) / len(timings) if timings else 0.0
    warm_timings = timings[1:] if len(timings) > 1 else timings
    warm_average = sum(warm_timings) / len(warm_timings) if warm_timings else 0.0

    print(flush=True)
    print(f"RESULT: {passed}/{len(cases)} = {accuracy:.1f}%", flush=True)
    print(f"AI AVERAGE WALL TIME (non-gated): {average:.3f}s per request", flush=True)
    print(f"AI WARM AVERAGE (excluding first AI request): {warm_average:.3f}s", flush=True)

    if len(categories) > 1 or "uncategorized" not in categories:
        print("\nCATEGORY RESULTS:", flush=True)
        for name in sorted(categories):
            stats = categories[name]
            pct = 100.0 * stats["passed"] / stats["total"] if stats["total"] else 0.0
            print(f"- {name}: {stats['passed']}/{stats['total']} = {pct:.1f}%", flush=True)

    print("\nSAFETY GATE:", flush=True)
    print(f"- total gated to unknown: {sum(gated.values())}", flush=True)
    for reason in sorted(gated):
        print(f"- {reason}: {gated[reason]}", flush=True)

    print("\nERROR TYPES:", flush=True)
    print(f"- unsafe false positives: {unsafe_false_positives}", flush=True)
    print(f"- missed legitimate commands: {missed_commands}", flush=True)
    print(f"- wrong-action substitutions: {wrong_actions}", flush=True)

    if failures:
        print("\nFAILURES:", flush=True)
        for failure in failures:
            category = failure.get("category", "uncategorized")
            gate = f" gate={failure['gate']}" if failure.get("gate") else ""
            print(
                f"- [{category}] expected={failure['expected']} actual={failure['actual']} raw={failure['raw']!r}{gate}: "
                f"{failure['command']}",
                flush=True,
            )

    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
