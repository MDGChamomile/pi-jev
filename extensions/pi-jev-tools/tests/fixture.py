"""Offline subprocess fixture. Only fixed test modes; no network."""
import json
import os
import sys
import time

mode = json.load(sys.stdin)["mode"]
if mode == "sleep":
    time.sleep(60)
elif mode == "overflow":
    sys.stdout.write("x" * 40000)
elif mode == "exit":
    sys.stderr.write("DO_NOT_EXPOSE_FAKE_SECRET")
    sys.exit(1)
else:
    print(json.dumps({"stdin_mode": mode, "has_unrelated_secret": "UNRELATED_SECRET" in os.environ,
                      "has_key": bool(os.environ.get("TYPESAFE_API_KEY")),
                      "args_contain_key": any("FAKE_TEST_KEY" in arg for arg in sys.argv)}))
