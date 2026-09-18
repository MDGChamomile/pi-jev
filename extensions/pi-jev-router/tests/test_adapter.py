import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("adapter", Path(__file__).resolve().parents[1] / "adapter.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def request():
    tools = [{"name": "read", "description": "Read local files."}]
    skills = [{"name": "pi-subagent", "description": "Run a bounded investigation."}]
    return {
        "model": "jev-latest",
        "state": {
            "task": "Investigate the current public implementation without modifying files.",
            "constraints": "Read-only; use public sources where needed.",
            "available_tools": tools,
            "available_skills": skills,
        },
        "questions": {
            "route": {
                "type": "choice", "instructions": {"question": "Which primary route should be used?"},
                "criteria": {key: key for key in adapter.ROUTES},
            },
            "subagent_preset": {
                "type": "choice", "instructions": {"question": "Which preset applies?"},
                "criteria": {key: key for key in adapter.PRESETS},
            },
            "primary_tool": {
                "type": "choice", "instructions": {"question": "Which tool applies?"},
                "criteria": {"none": "None", "tool_0": {"name": "read", "description": "Read local files."}},
            },
            "specialist_skill": {
                "type": "choice", "instructions": {"question": "Which skill applies?"},
                "criteria": {"none": "None", "skill_0": {"name": "pi-subagent", "description": "Run a bounded investigation."}},
            },
            "parallel_investigation": {
                "type": "noul", "instructions": {"question": "Are independent parallel tracks useful?"},
                "criteria": {"true": "Yes", "false": "No"},
            },
        },
    }


def choice(selected, options):
    return SimpleNamespace(choice=selected, confidence=1.0, probabilities={key: float(key == selected) for key in options})


def response(req=None):
    req = req or request()
    choices = {
        "route": choice("web_subagent", req["questions"]["route"]["criteria"]),
        "subagent_preset": choice("analysis_standard", req["questions"]["subagent_preset"]["criteria"]),
        "primary_tool": choice("none", req["questions"]["primary_tool"]["criteria"]),
        "specialist_skill": choice("skill_0", req["questions"]["specialist_skill"]["criteria"]),
    }
    nouls = {"parallel_investigation": SimpleNamespace(noul=0.2)}
    answers = {**choices, **nouls}
    return SimpleNamespace(
        model="jev-1.13.0", answers=answers, choices=choices, nouls=nouls,
        usage=SimpleNamespace(input_tokens=100, output_tokens=10),
    )


class AdapterTests(unittest.TestCase):
    def fake_sdk(self, result=None, failure=None):
        self.calls = []
        self.config = {}
        outer = self

        class Client:
            def __init__(self, **kwargs):
                outer.config.update(kwargs)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def system_one(self, **kwargs):
                outer.calls.append(kwargs)
                if failure:
                    raise failure
                return result or response()

        return SimpleNamespace(TypeSafeClient=Client, RetryPolicy=lambda **kwargs: kwargs)

    def test_single_request_and_no_retries(self):
        req = request()
        result = adapter.evaluate(req, self.fake_sdk(result=response(req)), "FAKE_TEST_KEY")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.config["retry"]["max_retries"], 0)
        self.assertEqual(self.config["timeout"], 30)
        self.assertEqual(self.config["base_url"], "https://api.typesafe.ai")
        self.assertEqual(self.calls[0]["state"]["task"], req["state"]["task"])
        self.assertNotIn("FAKE_TEST_KEY", json.dumps(result))

    def test_missing_key_and_invalid_input_never_call(self):
        sdk = self.fake_sdk()
        self.assertEqual(adapter.evaluate(request(), sdk, "")["code"], "missing_key")
        bad = request()
        bad["state"]["available_tools"] *= 33
        self.assertEqual(adapter.evaluate(bad, sdk, "fake")["code"], "invalid_request")
        self.assertEqual(self.calls, [])

    def test_provider_failure_is_sanitized_without_retry(self):
        failure = RuntimeError("FAKE_SECRET raw body and request")
        failure.status = 429
        result = adapter.evaluate(request(), self.fake_sdk(failure=failure), "fake")
        self.assertEqual(result, {"status": "error", "code": "rate_limited"})
        self.assertEqual(len(self.calls), 1)

    def test_response_diagnostics_are_fixed_and_fail_closed(self):
        cases = [
            ("model_format", lambda r: setattr(r, "model", "FAKE_SECRET")),
            ("answer_ids", lambda r: setattr(r, "answers", {})),
            ("choice_ids", lambda r: setattr(r, "choices", {})),
            ("noul_ids", lambda r: setattr(r, "nouls", {})),
            ("choice_value", lambda r: setattr(r.choices["route"], "choice", "unknown")),
            ("probability_options", lambda r: setattr(r.choices["route"], "probabilities", {"direct": 1})),
            ("probability_range", lambda r: setattr(r.choices["route"], "probabilities", {key: (-1 if key == "direct" else 0) for key in request()["questions"]["route"]["criteria"]})),
            ("probability_sum", lambda r: setattr(r.choices["route"], "probabilities", {key: 0 for key in request()["questions"]["route"]["criteria"]})),
            ("choice_consistency", lambda r: setattr(r.choices["route"], "probabilities", {key: (0.8 if key == "direct" else 0.2 if key == "web_subagent" else 0) for key in request()["questions"]["route"]["criteria"]})),
            ("confidence_range", lambda r: setattr(r.choices["route"], "confidence", 2)),
            ("noul_range", lambda r: setattr(r.nouls["parallel_investigation"], "noul", True)),
            ("usage_range", lambda r: setattr(r.usage, "input_tokens", -1)),
            ("response_shape", lambda r: delattr(r, "usage")),
        ]
        for diagnostic, mutate in cases:
            with self.subTest(diagnostic=diagnostic):
                req = request()
                value = response(req)
                mutate(value)
                result = adapter.evaluate(req, self.fake_sdk(result=value), "FAKE_SECRET")
                self.assertEqual(result, {"status": "error", "code": "invalid_response", "diagnostic": diagnostic})
                self.assertNotIn("FAKE_SECRET", json.dumps(result))
                self.assertEqual(len(self.calls), 1)

    def test_process_missing_key_needs_no_sdk(self):
        result = subprocess.run(
            [sys.executable, "-I", "-B", str(Path(adapter.__file__))],
            input=json.dumps(request()), text=True, capture_output=True, env={}, check=True,
        )
        self.assertEqual(json.loads(result.stdout)["code"], "missing_key")
        self.assertEqual(result.stderr, "")

    def test_actual_sdk_mock_transport(self):
        try:
            import typesafe_sdk
            import httpx2
        except ImportError:
            self.skipTest("Optional installed typesafe-sdk required for HTTP contract test")
        calls = []
        req = request()

        def handle(http_request):
            calls.append(json.loads(http_request.content))
            self.assertEqual(str(http_request.url), "https://api.typesafe.ai/v1/systemone")
            answers = {}
            selections = {
                "route": "web_subagent", "subagent_preset": "analysis_standard",
                "primary_tool": "none", "specialist_skill": "skill_0",
            }
            for question_id, selected in selections.items():
                options = req["questions"][question_id]["criteria"]
                answers[question_id] = {
                    "type": "choice", "choice": selected, "confidence": 1.0,
                    "probabilities": {key: float(key == selected) for key in options},
                }
            answers["parallel_investigation"] = {"type": "noul", "noul": 0.2}
            return httpx2.Response(200, json={
                "model": "jev-1.13.0", "usage": {"input_tokens": 100, "output_tokens": 10}, "answers": answers,
            })

        sdk = SimpleNamespace(
            RetryPolicy=typesafe_sdk.RetryPolicy,
            TypeSafeClient=lambda **kwargs: typesafe_sdk.TypeSafeClient(**kwargs, transport=httpx2.MockTransport(handle)),
        )
        with patch.object(socket.socket, "connect", side_effect=AssertionError("network forbidden")):
            result = adapter.evaluate(req, sdk, "FAKE_TEST_KEY")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["state"], req["state"])
        self.assertEqual(calls[0]["questions"], req["questions"])

    def test_actual_sdk_429_is_not_retried(self):
        try:
            import typesafe_sdk
            import httpx2
        except ImportError:
            self.skipTest("Optional installed SDK required")
        calls = []

        def handle(_request):
            calls.append(1)
            return httpx2.Response(429, json={"detail": "FAKE_SECRET"}, headers={"retry-after": "0"})

        sdk = SimpleNamespace(
            RetryPolicy=typesafe_sdk.RetryPolicy,
            TypeSafeClient=lambda **kwargs: typesafe_sdk.TypeSafeClient(**kwargs, transport=httpx2.MockTransport(handle)),
        )
        with patch.object(socket.socket, "connect", side_effect=AssertionError("network forbidden")):
            result = adapter.evaluate(request(), sdk, "FAKE_TEST_KEY")
        self.assertEqual(result["code"], "rate_limited")
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
