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
    "volume_up means make the current audio louder or increase its level; volume_down means make it quieter or reduce its level. "
    "Natural complaints that the sound is fierce, blasting, excessive, or too loud mean volume_down; complaints that it is faint, barely audible, or too quiet mean volume_up; "
    "mute means silence or cut the current audio, including requests for no sound temporarily; "
    "unmute means restore sound after mute, including requests to hear the sound again or have the sound/audio back; "
    "source_phono means select PHONO, the turntable, or record player; source_cd means select CD, compact disc, or the disc player; "
    "source_tidal means select TIDAL or HEOS as the source; source_tv means select the TV source; "
    "source_aux means select AUX or the projector source; "
    "play means start or resume current playback, continue/carry on with the current music, or keep current playback going; "
    "pause means pause, hold, or temporarily stop current playback; "
    "next means advance from the current track to the next track, including requests to skip, discard, or get rid of the current song; "
    "previous means go back to the previous track. "
    "A command may be short or elliptical and does not need a full sentence when its requested action is still clear. "
    "Polite requests such as 'could you', 'would you', or asking to have something changed now are commands when they clearly request an immediate action. "
    "Direct requests and clear complaints about current audio can imply an action. "
    "Questions, suggestions, and requests for an opinion or information are unknown unless they explicitly and unambiguously instruct the system to change state now. "
    "Do not turn a question about whether something is loud or quiet into a volume command. "
    "Negated commands that tell the system not to do something are unknown; never infer the opposite action from a negation. "
    "Observations, compliments, hypothetical or future/deferred statements, and unsupported requests must be unknown. "
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

NEGATION_RE = re.compile(
    r"\b(?:don't|dont|do not|didn't|didnt|did not|never|not)\b",
    re.IGNORECASE,
)
AVOIDANCE_RE = re.compile(
    r"(?:\brather\b.*\b(?:didn't|didnt|did not)\b|"
    r"\b(?:avoid|avoiding)\b|\bstay away from\b|\bbest not\b|"
    r"\bleave\b.*\b(?:alone|where it is|running|playing|switched on)\b|"
    r"\bkeep\b.*\b(?:muted|running|playing)\b|"
    r"\b(?:don't|dont|do not)\s+want\b)",
    re.IGNORECASE,
)
FUTURE_RE = re.compile(
    r"\b(?:later|tomorrow|tonight|next week|this evening|sometime|in a while|"
    r"in\s+(?:(?:a|one)\s+)?(?:few\s+)?(?:seconds?|minutes?|hours?)|"
    r"in\s+\d+\s+(?:seconds?|minutes?|hours?)|"
    r"at\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+o['’]?clock)|"
    r"once\b|after\b|when\b|"
    r"before\s+(?:(?:the|this|that|a|an)\s+(?:song|track|music|playback|record|album|side|film|movie|programme|program|news)\s+(?:starts?|begins?|ends?|finishes?)|"
    r"(?:i|we|you|he|she|they)\s+\w+))",
    re.IGNORECASE,
)
HYPOTHETICAL_RE = re.compile(
    r"^(?:if\b|suppose\b|imagine\b|assuming\b|what if\b|were\s+\w+\s+to\b)",
    re.IGNORECASE,
)
REPORTED_SPEECH_RE = re.compile(
    r"^(?:(?:he|she|they|someone|somebody)\b.*\b(?:said|asked|told|shouted|yelled)\b|"
    r"(?:the|a)\s+(?:message|instructions?|note|text)\b.*\b(?:says?|said|tells?|asks?)\b|"
    r"i\s+(?:heard|was told)\b.*\b(?:say|said|ask|asked|tell|told)\b)",
    re.IGNORECASE,
)
QUESTION_START_RE = re.compile(
    r"^(?:is|are|am|was|were|did|does|do|has|have|had|which|what|why|when|where|who|how|should|could|would|can|may)\b",
    re.IGNORECASE,
)
POLITE_COMMAND_START_RE = re.compile(
    r"^(?:(?:could|would|can|will)\s+you\b|(?:can|could|may)\s+i\s+(?:have|get)\b|please\b)",
    re.IGNORECASE,
)
OBSERVATION_START_RE = re.compile(
    r"^(?:the|this|that|it|my|your|our|we|we're|we are|i|i'm|i am|playback|sound|audio|music|receiver|amp|amplifier|television|projector|aux|phono|cd|tidal|heos)\b",
    re.IGNORECASE,
)
OBSERVATION_ACTION_RE = re.compile(
    r"\b(?:icon|showing|shows|uses|looks|seems|currently|already|at present|right now|remains|feeds|coming through|"
    r"source is|input is|current source|current input|is the current source|is the current input|"
    r"has stopped|has started|has paused|is stopped|is paused|is playing|is connected to|connected to|is for|"
    r"was the previous|is the next|was the next|is the previous|is selected|selected right now|"
    r"what we're listening to|what we are listening to|stopped on its own|came back by itself|came back on its own|"
    r"stayed on|nearly over|listening quite|hear(?:ing)?\s+the\s+music\s+clearly)\b",
    re.IGNORECASE,
)
UNRELATED_DEVICE_RE = re.compile(
    r"^(?:the\s+)?(?:doorbell|alarm|telephone|phone|kettle|fan|vacuum|hoover|washing machine|dryer|lamp|light)\b.*\b(?:loud|quiet|noisy|faint|volume|turn(?:ing)?\s+(?:up|down))\b",
    re.IGNORECASE,
)
AUDIO_RESTORE_RE = re.compile(
    r"\b(?:sound|audio)\b.*\b(?:back|again|restore|return|hear)\b|\b(?:back|again|restore|return|hear)\b.*\b(?:sound|audio|it)\b",
    re.IGNORECASE,
)
DEVICE_POWER_RE = re.compile(
    r"\b(?:marantz|receiver|amp|amplifier|system|power)\b",
    re.IGNORECASE,
)


def safety_gate(command: str):
    """Return a reason when a command must be forced to unknown, else None."""
    text = " ".join(str(command).strip().split())
    if not text:
        return "empty"
    if REPORTED_SPEECH_RE.search(text):
        return "reported_speech"
    if HYPOTHETICAL_RE.search(text):
        return "hypothetical"
    if NEGATION_RE.search(text) or AVOIDANCE_RE.search(text):
        return "negation"
    if FUTURE_RE.search(text):
        return "future"
    if QUESTION_START_RE.search(text) and not POLITE_COMMAND_START_RE.search(text):
        return "question"
    if text.endswith("?") and not POLITE_COMMAND_START_RE.search(text):
        return "question"
    if UNRELATED_DEVICE_RE.search(text):
        return "unrelated"
    if OBSERVATION_START_RE.search(text) and OBSERVATION_ACTION_RE.search(text):
        return "observation"
    return None


def disambiguate(command: str, actual):
    """Apply narrow deterministic corrections to otherwise valid AI intents."""
    text = " ".join(str(command).strip().split())
    if actual == "power_on" and AUDIO_RESTORE_RE.search(text) and not DEVICE_POWER_RE.search(text):
        return "unmute", "audio_restore"
    return actual, None


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
        return "unknown", f"safety:{gate_reason}", 0.0, "", gate_reason, None

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
        return None, "", time.perf_counter() - started, str(exc), None, None

    try:
        raw = str(result["choices"][0]["message"]["content"]).strip()
    except (KeyError, IndexError, TypeError):
        raw = ""

    actual = raw if raw in ALLOWED else None
    actual, correction = disambiguate(command, actual)
    return actual, raw, elapsed, json.dumps(result, ensure_ascii=False), None, correction


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
    corrected = defaultdict(int)

    print(f"Model: {model}", flush=True)
    print(f"Cases: {len(cases)} ({cases_path.name})", flush=True)
    print(f"Server: {SERVER_URL} (chat completions + deterministic safety gate)", flush=True)
    print(flush=True)

    for index, case in enumerate(cases, 1):
        actual, raw, elapsed, debug, gate_reason, correction = classify(case["command"])
        if gate_reason:
            gated[gate_reason] += 1
        else:
            timings.append(elapsed)
        if correction:
            corrected[correction] += 1
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
        correction_label = f" correction={correction}" if correction else ""
        print(
            f"{index:02d}. {status}  expected={case['expected']:<13} "
            f"actual={str(actual):<13} {elapsed:5.2f}s{gate_label}{correction_label}  {case['command']}",
            flush=True,
        )
        if not ok:
            failures.append({**case, "actual": actual, "raw": raw, "debug": debug, "gate": gate_reason, "correction": correction})

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

    print("\nPOST-AI CORRECTIONS:", flush=True)
    print(f"- total corrections: {sum(corrected.values())}", flush=True)
    for reason in sorted(corrected):
        print(f"- {reason}: {corrected[reason]}", flush=True)

    print("\nERROR TYPES:", flush=True)
    print(f"- unsafe false positives: {unsafe_false_positives}", flush=True)
    print(f"- missed legitimate commands: {missed_commands}", flush=True)
    print(f"- wrong-action substitutions: {wrong_actions}", flush=True)

    if failures:
        print("\nFAILURES:", flush=True)
        for failure in failures:
            category = failure.get("category", "uncategorized")
            gate = f" gate={failure['gate']}" if failure.get("gate") else ""
            correction = f" correction={failure['correction']}" if failure.get("correction") else ""
            print(
                f"- [{category}] expected={failure['expected']} actual={failure['actual']} raw={failure['raw']!r}{gate}{correction}: "
                f"{failure['command']}",
                flush=True,
            )

    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())