"""Internal stdin/stdout adapter for the Pi Jev router.

Consent and process deadline belong to the Pi extension. No .env loading, file
or session discovery, request logging, or automatic retry.
"""
import json
import logging
import math
import os
import re
import sys

MAX_BYTES = 65536
MAX_CANDIDATES = 32
BASE_URL = "https://api.typesafe.ai"
CHOICE_IDS = ("route", "subagent_preset", "primary_tool", "specialist_skill")
ALL_IDS = set(CHOICE_IDS) | {"parallel_investigation"}
ROUTES = {
    "direct", "local_subagent", "web_subagent", "browser_interaction",
    "specialist_skill", "clarify_with_user", "no_match",
}
PRESETS = {"lookup_standard", "analysis_standard", "review_standard", "not_applicable"}


def error(code):
    return {"status": "error", "code": code}


def valid_text(value, limit, allow_empty=False):
    return isinstance(value, str) and (allow_empty or value.strip()) and len(value) <= limit


def valid_entry(value, depth=0):
    if depth > 8:
        return False
    if value is None or isinstance(value, str):
        return True
    if isinstance(value, list):
        return all(valid_entry(item, depth + 1) for item in value)
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        return all(valid_entry(item, depth + 1) for item in value.values())
    return False


def validate_catalog(items):
    if not isinstance(items, list) or len(items) > MAX_CANDIDATES:
        raise ValueError()
    names = set()
    for item in items:
        if not isinstance(item, dict) or set(item) != {"name", "description"}:
            raise ValueError()
        if not valid_text(item["name"], 128) or not valid_text(item["description"], 4000):
            raise ValueError()
        if item["name"] in names:
            raise ValueError()
        names.add(item["name"])


def validate_choice(question, expected_options):
    if not isinstance(question, dict) or set(question) != {"type", "instructions", "criteria"}:
        raise ValueError()
    if question["type"] != "choice" or not valid_entry(question["instructions"]):
        raise ValueError()
    if not isinstance(question["criteria"], dict) or set(question["criteria"]) != set(expected_options):
        raise ValueError()
    if not all(valid_entry(value) for value in question["criteria"].values()):
        raise ValueError()


def validate_request(request):
    if not isinstance(request, dict) or set(request) != {"model", "state", "questions"}:
        raise ValueError()
    if request["model"] != "jev-latest":
        raise ValueError()
    state = request["state"]
    if not isinstance(state, dict) or set(state) != {"task", "constraints", "available_tools", "available_skills"}:
        raise ValueError()
    if not valid_text(state["task"], 8000) or not valid_text(state["constraints"], 4000):
        raise ValueError()
    validate_catalog(state["available_tools"])
    validate_catalog(state["available_skills"])

    questions = request["questions"]
    if not isinstance(questions, dict) or set(questions) != ALL_IDS:
        raise ValueError()
    validate_choice(questions["route"], ROUTES)
    validate_choice(questions["subagent_preset"], PRESETS)
    validate_choice(questions["primary_tool"], {"none"} | {f"tool_{i}" for i in range(len(state["available_tools"]))})
    validate_choice(questions["specialist_skill"], {"none"} | {f"skill_{i}" for i in range(len(state["available_skills"]))})

    parallel = questions["parallel_investigation"]
    if not isinstance(parallel, dict) or set(parallel) != {"type", "instructions", "criteria"}:
        raise ValueError()
    if parallel["type"] != "noul" or not valid_entry(parallel["instructions"]):
        raise ValueError()
    if not isinstance(parallel["criteria"], dict) or set(parallel["criteria"]) != {"true", "false"}:
        raise ValueError()
    if not all(valid_entry(value) for value in parallel["criteria"].values()):
        raise ValueError()

    if len(json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_BYTES:
        raise ValueError()


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError()
    return value


class ResponseValidationError(ValueError):
    """Only fixed local diagnostic codes may cross the process boundary."""
    def __init__(self, diagnostic):
        self.diagnostic = diagnostic


def require_response(condition, diagnostic):
    if not condition:
        raise ResponseValidationError(diagnostic)


def response_number(value, low, high, diagnostic):
    try:
        return number(value, low, high)
    except ValueError:
        raise ResponseValidationError(diagnostic) from None


def normalize(response, request):
    require_response(isinstance(response.model, str) and re.fullmatch(r"jev-[a-zA-Z0-9._-]{1,80}", response.model), "model_format")
    require_response(set(response.answers) == ALL_IDS, "answer_ids")
    require_response(set(response.choices) == set(CHOICE_IDS), "choice_ids")
    require_response(set(response.nouls) == {"parallel_investigation"}, "noul_ids")
    answers = {}
    for question_id in CHOICE_IDS:
        answer = response.choices[question_id]
        options = set(request["questions"][question_id]["criteria"])
        require_response(isinstance(answer.choice, str) and answer.choice in options, "choice_value")
        require_response(set(answer.probabilities) == options, "probability_options")
        probabilities = {key: response_number(answer.probabilities[key], 0, 1, "probability_range") for key in options}
        require_response(abs(sum(probabilities.values()) - 1) <= .001, "probability_sum")
        require_response(all(value <= probabilities[answer.choice] + .001 for value in probabilities.values()), "choice_consistency")
        answers[question_id] = {
            "type": "choice",
            "choice": answer.choice,
            "confidence": response_number(answer.confidence, 0, 1, "confidence_range"),
            "probabilities": probabilities,
        }
    noul = response.nouls["parallel_investigation"]
    answers["parallel_investigation"] = {
        "type": "noul",
        "noul": response_number(noul.noul, 0, 1, "noul_range"),
    }
    usage = {}
    for field in ("input_tokens", "output_tokens"):
        value = getattr(response.usage, field)
        require_response(value is None or (type(value) is int and 0 <= value <= 9007199254740991), "usage_range")
        usage[field] = value
    return {"status": "ok", "model": response.model, "answers": answers, "usage": usage}


def evaluate(request, sdk, api_key):
    """Injectable SDK boundary for offline tests; never format exception messages."""
    try:
        validate_request(request)
    except Exception:
        return error("invalid_request")
    if not api_key or not api_key.strip():
        return error("missing_key")
    try:
        retry = sdk.RetryPolicy(max_retries=0, timeout=30.0)
        with sdk.TypeSafeClient(api_key=api_key, model="jev-latest", base_url=BASE_URL, retry=retry, timeout=30.0) as client:
            response = client.system_one(state=request["state"], questions=request["questions"], model=request["model"])
    except Exception as exc:
        status = getattr(exc, "status", None)
        if status == 429:
            return error("rate_limited")
        if status in (401, 403):
            return error("authentication_failed")
        if type(exc).__name__ == "TypeSafeAPITimeoutError":
            return error("provider_timeout")
        return error("provider_error")
    try:
        return normalize(response, request)
    except ResponseValidationError as exc:
        return {**error("invalid_response"), "diagnostic": exc.diagnostic}
    except Exception:
        return {**error("invalid_response"), "diagnostic": "response_shape"}


def main():
    logging.disable(logging.CRITICAL)
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            return error("invalid_request")
        request = json.loads(raw)
        validate_request(request)
    except Exception:
        return error("invalid_request")
    api_key = os.environ.get("TYPESAFE_API_KEY", "")
    if not api_key.strip():
        return error("missing_key")
    try:
        import typesafe_sdk
    except Exception:
        return error("sdk_unavailable")
    return evaluate(request, typesafe_sdk, api_key)


if __name__ == "__main__":
    try:
        result = main()
    except Exception:
        result = error("provider_error")
    sys.stdout.write(json.dumps(result, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
