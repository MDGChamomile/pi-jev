import json
import os
import sys
import time

raw = sys.stdin.buffer.read()
request = json.loads(raw)
mode = request.get("mode")
if mode == "inspect":
    result = {
        "stdin_mode": mode,
        "has_unrelated_secret": bool(os.environ.get("UNRELATED_SECRET")),
        "has_key": bool(os.environ.get("TYPESAFE_API_KEY")),
        "args_contain_key": any("FAKE_TEST_KEY" in value for value in sys.argv),
    }
elif mode == "sleep":
    time.sleep(60)
    result = {"late": True}
elif mode == "overflow":
    sys.stdout.write("x" * 40000)
    raise SystemExit(0)
elif mode == "exit":
    raise SystemExit(2)
else:
    result = {"mode": mode}
sys.stdout.write(json.dumps(result))
