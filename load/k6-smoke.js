import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://localhost:3000";
const releaseProfile = __ENV.K6_PROFILE === "release";

export const options = {
  stages: releaseProfile
    ? [
        { duration: "1m", target: 25 },
        { duration: "5m", target: 25 },
        { duration: "1m", target: 0 },
      ]
    : [
        { duration: "10s", target: 5 },
        { duration: "30s", target: 5 },
        { duration: "10s", target: 0 },
      ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:non-ai}": ["p(95)<750"],
  },
};

function smoke() {
  for (const path of ["/api/health", "/api/proof/manifest", "/proof"]) {
    const response = http.get(baseUrl + path, { tags: { endpoint: "non-ai" } });
    check(response, { "status is successful": (value) => value.status < 400 });
  }
  sleep(1);
}

export default smoke;
