"""python3 -m unittest discover -s tests"""
import http.client
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import check  # noqa: E402

CFG = {"userAgent": "t", "timeoutSeconds": 1, "slowMs": 5000}
HEALTH = {"type": "health", "url": "https://x/api/health", "fallback": {"url": "https://x/"}}


def resp(code, body=b"", headers=None, ms=10):
    return {"code": code, "ms": ms, "body": body, "headers": headers or {}}


class HealthTest(unittest.TestCase):
    def run_health(self, answers, check_cfg=HEALTH):
        with mock.patch.object(check, "http_get", side_effect=answers) as m:
            return check.check_health(check_cfg, CFG), m.call_count

    def test_ok(self):
        res, _ = self.run_health([resp(200, b'{"ok": true}')])
        self.assertEqual(res["state"], "up")

    def test_ok_false_is_down(self):
        res, n = self.run_health([resp(200, b'{"ok": false}')])
        self.assertEqual((res["state"], n), ("down", 1))

    def test_503_retry_after_is_maintenance(self):
        res, _ = self.run_health([resp(503, headers={"Retry-After": "600"})])
        self.assertEqual(res["state"], "maintenance")

    def test_outage_does_not_fall_back(self):
        for r in (resp(502), resp(503), resp(500), {"error": "timeout"}, resp(200, b"<html>")):
            res, n = self.run_health([r, resp(200)])
            self.assertEqual((res["state"], n), ("down", 1), r)

    def test_404_falls_back_to_home_page_200(self):
        res, n = self.run_health([resp(404), resp(200, b"<html>")])
        self.assertEqual((res["state"], n), ("up", 2))

    def test_404_fallback_non_200_is_down(self):
        for r in (resp(503, headers={"Retry-After": "1"}), resp(302), {"error": "connect"}):
            res, _ = self.run_health([resp(404), r])
            self.assertEqual(res["state"], "down", r)

    def test_strict_without_fallback(self):
        res, n = self.run_health([resp(404)], {"type": "health", "url": "https://x/api/health"})
        self.assertEqual((res["state"], n), ("down", 1))


class RobustnessTest(unittest.TestCase):
    def test_protocol_error_is_down(self):
        with mock.patch("urllib.request.OpenerDirector.open", side_effect=http.client.BadStatusLine("x")):
            self.assertEqual(check.http_get("https://x/", CFG), {"error": "protocol"})

    def test_exception_in_one_service_does_not_stop_run(self):
        svc = {"id": "a", "check": {"type": "http", "url": "https://x/"}}
        with mock.patch.dict(check.CHECKS, {"http": mock.Mock(side_effect=RuntimeError("boom"))}), \
                mock.patch.object(check.time, "sleep"):
            res = check.run_service(svc, CFG)
        self.assertEqual(res, {"state": "down", "detail": "check_error"})


if __name__ == "__main__":
    unittest.main()
