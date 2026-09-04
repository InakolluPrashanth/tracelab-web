#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${1:-http://localhost:10000}"
echo "[1/3] Health: $BASE_URL/api/health"
curl -fsS "$BASE_URL/api/health" | tee /tmp/tracelab-health.json
echo
echo "[2/3] Runtimes: $BASE_URL/api/runtimes"
curl -fsS "$BASE_URL/api/runtimes" | tee /tmp/tracelab-runtimes.json
echo
echo "[3/3] C++ execution"
curl -fsS -X POST "$BASE_URL/api/execute" \
  -H 'Content-Type: application/json' \
  --data '{"language":"cpp","code":"#include <iostream>\nint main(){std::cout << 21;}"}' | tee /tmp/tracelab-cpp.json
echo
echo "Smoke test complete. C++ response should contain output 21 and ok:true."
