"""Internal stdin/stdout adapter. Consent and process deadline belong to the Pi extension.

No .env loading, file discovery, request logging, or automatic retry.
"""
import json
import logging
import math
import os
import re
import sys

MAX_BYTES = 65536
BASE_URL = "https://api.typesafe.ai"


def error(code):
    return {"status": "error", "code": code}


def validate_request(request):
    if not isinstance(request, dict) or set(request) != {"model", "state", "questions"}:
        raise ValueError()
    if request["model"] != "jev-latest":
        raise ValueError()
    state = request["state"]
    if not isinstance(state, dict) or set(state) != {"question", "evaluation_criteria", "candidates"}:
        raise ValueError()
    for field in ("question", "evaluation_criteria"):
        if not isinstance(state[field], str) or not state[field].strip() or len(state[field]) > 4000:
            raise ValueError()
    candidates = state["candidates"]
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= 10:
        raise ValueError()
    ids = set()
    for candidate in candidates:
        if not isinstance(candidate, dict) or set(candidate) != {"id", "url", "title", "excerpt"}:
            raise ValueError()
        for field, limit in (("id", 64), ("url", 2048), ("title", 500), ("excerpt", 4000)):
            value = candidate[field]
            if not isinstance(value, str) or not value.strip() or len(value) > limit:
                raise ValueError()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", candidate["id"]) or candidate["id"] in ids:
            raise ValueError()
        ids.add(candidate["id"])
    questions = request["questions"]
    if not isinstance(questions, dict) or set(questions) != {f"candidate_{i}" for i in range(len(candidates))}:
        raise ValueError()
    for question in questions.values():
        if not isinstance(question, dict) or set(question) != {"type", "instructions", "criteria"} or question["type"] != "score":
            raise ValueError()
        if not isinstance(question["instructions"], str) or not question["instructions"].strip():
            raise ValueError()
        levels = question["criteria"]
        if not isinstance(levels, list) or len(levels) != 4 or not all(isinstance(x, str) and x.strip() for x in levels):
            raise ValueError()
    if len(json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_BYTES:
        raise ValueError()


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError()
    return value


def normalize(response, question_ids):
    if not isinstance(response.model, str) or not re.fullmatch(r"jev-[a-zA-Z0-9._-]{1,80}", response.model):
        raise ValueError()
    if set(response.answers) != set(question_ids) or set(response.scores) != set(question_ids):
        raise ValueError()
    answers = {}
    for qid in question_ids:
        answer = response.scores[qid]
        if set(answer.probabilities) != {0, 1, 2, 3}:
            raise ValueError()
        probabilities = {str(i): number(answer.probabilities[i], 0, 1) for i in range(4)}
        score = number(answer.score, 0, 3)
        if abs(sum(probabilities.values()) - 1) > .001 or abs(sum(i * probabilities[str(i)] for i in range(4)) - score) > .01:
            raise ValueError()
        answers[qid] = {"type": "score", "score": score, "confidence": number(answer.confidence, 0, 1), "probabilities": probabilities}
    usage = {}
    for field in ("input_tokens", "output_tokens"):
        value = getattr(response.usage, field)
        if value is not None and (type(value) is not int or not 0 <= value <= 9007199254740991):
            raise ValueError()
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
        # Only fixed codes cross the process boundary. No request, response, key or traceback.
        status = getattr(exc, "status", None)
        if status == 429:
            return error("rate_limited")
        if status in (401, 403):
            return error("authentication_failed")
        if type(exc).__name__ == "TypeSafeAPITimeoutError":
            return error("provider_timeout")
        return error("provider_error")
    try:
        return normalize(response, request["questions"])
    except Exception:
        return error("invalid_response")


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
