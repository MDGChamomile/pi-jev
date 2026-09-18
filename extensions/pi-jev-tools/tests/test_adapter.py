import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('adapter', Path(__file__).resolve().parents[1] / 'adapter.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def request():
    return {'model': 'jev-latest', 'state': {'question': 'Was it completed?', 'evaluation_criteria': 'Distinguish intent from execution.',
            'candidates': [{'id': 'a', 'url': 'https://example.com', 'title': 'Public synthetic example', 'excerpt': '완료했다.'}]},
            'questions': {'candidate_0': {'type': 'score', 'instructions': 'Evaluate candidates[0].', 'criteria': ['Unrelated', 'Background', 'Partial evidence', 'Direct evidence']}}}


def response():
    answers = {'candidate_0': SimpleNamespace(score=3, confidence=1, probabilities={0:0, 1:0, 2:0, 3:1})}
    return SimpleNamespace(model='jev-1.13.0', answers=answers, scores=answers, usage=SimpleNamespace(input_tokens=100, output_tokens=10))


class AdapterTests(unittest.TestCase):
    def fake_sdk(self, result=None, failure=None):
        self.calls = []
        self.config = {}
        outer = self
        class Client:
            def __init__(self, **kwargs): outer.config.update(kwargs)
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def system_one(self, **kwargs):
                outer.calls.append(kwargs)
                if failure: raise failure
                return result or response()
        return SimpleNamespace(TypeSafeClient=Client, RetryPolicy=lambda **kwargs: kwargs)

    def test_single_request_and_no_retries(self):
        result = adapter.evaluate(request(), self.fake_sdk(), 'FAKE_TEST_KEY')
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.config['retry']['max_retries'], 0)
        self.assertEqual(self.config['timeout'], 30)
        self.assertEqual(self.config['base_url'], 'https://api.typesafe.ai')
        self.assertEqual(self.calls[0]['state']['candidates'][0]['excerpt'], '완료했다.')
        self.assertNotIn('FAKE_TEST_KEY', json.dumps(result))

    def test_missing_key_and_invalid_input_never_call(self):
        sdk = self.fake_sdk()
        self.assertEqual(adapter.evaluate(request(), sdk, '')['code'], 'missing_key')
        bad = request(); bad['state']['candidates'] *= 11
        self.assertEqual(adapter.evaluate(bad, sdk, 'fake')['code'], 'invalid_request')
        self.assertEqual(self.calls, [])

    def test_provider_failure_sanitized_without_retry(self):
        failure = RuntimeError('FAKE_SECRET raw body and request')
        failure.status = 429
        result = adapter.evaluate(request(), self.fake_sdk(failure=failure), 'fake')
        self.assertEqual(result, {'status': 'error', 'code': 'rate_limited'})
        self.assertEqual(len(self.calls), 1)

    def test_invalid_numeric_or_missing_answer(self):
        for bad in (float('nan'), -1, True):
            r = response(); r.scores['candidate_0'].score = bad
            self.assertEqual(adapter.evaluate(request(), self.fake_sdk(result=r), 'fake')['code'], 'invalid_response')
        r = response(); r.answers = {}
        self.assertEqual(adapter.evaluate(request(), self.fake_sdk(result=r), 'fake')['code'], 'invalid_response')

    def test_process_missing_key_no_sdk_needed(self):
        result = subprocess.run([sys.executable, '-I', '-B', str(Path(adapter.__file__))],
            input=json.dumps(request()), text=True, capture_output=True, env={}, check=True)
        self.assertEqual(json.loads(result.stdout)['code'], 'missing_key')
        self.assertEqual(result.stderr, '')

    def test_actual_sdk_mock_transport(self):
        try:
            import typesafe_sdk
            import httpx2
        except ImportError:
            self.skipTest('Optional installed typesafe-sdk required for HTTP contract test')
        calls = []
        def handle(req):
            calls.append(json.loads(req.content))
            self.assertEqual(str(req.url), 'https://api.typesafe.ai/v1/systemone')
            return httpx2.Response(200, json={'model':'jev-1.13.0', 'usage':{'input_tokens':100,'output_tokens':10},
                'answers':{'candidate_0':{'type':'score','score':3.0,'confidence':1.0,
                    'probabilities':{'0':0.,'1':0.,'2':0.,'3':1.},
                    'legend':{'0':'Unrelated','1':'Background','2':'Partial evidence','3':'Direct evidence'}}}})
        sdk = SimpleNamespace(RetryPolicy=typesafe_sdk.RetryPolicy,
            TypeSafeClient=lambda **kwargs: typesafe_sdk.TypeSafeClient(**kwargs, transport=httpx2.MockTransport(handle)))
        # Any unintended real socket access fails this offline test.
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')):
            result = adapter.evaluate(request(), sdk, 'FAKE_TEST_KEY')
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['state'], request()['state'])
        self.assertEqual(calls[0]['questions'], request()['questions'])

    def test_actual_sdk_429_is_not_retried(self):
        try:
            import typesafe_sdk
            import httpx2
        except ImportError:
            self.skipTest('Optional installed SDK required')
        calls = []
        def handle(req):
            calls.append(1)
            return httpx2.Response(429, json={'detail':'FAKE_SECRET'}, headers={'retry-after':'0'})
        sdk = SimpleNamespace(RetryPolicy=typesafe_sdk.RetryPolicy,
            TypeSafeClient=lambda **kwargs: typesafe_sdk.TypeSafeClient(**kwargs, transport=httpx2.MockTransport(handle)))
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')):
            result = adapter.evaluate(request(), sdk, 'FAKE_TEST_KEY')
        self.assertEqual(result['code'], 'rate_limited')
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
