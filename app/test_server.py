import copy
import json
from pathlib import Path
import tempfile
import unittest
import threading
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from server import Bluetooth, DEVICE, Handler, ROOT, Store


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "history.sqlite3"
        self.store = Store(self.path)
        self.store.save_profile({"height_cm": 184, "birthdate": "2003-09-23", "sex": "male"})
        from decode import decode
        self.measurement = {**decode("0226ea070a16133539e701d23c"), "captured_at": "2026-10-22T19:53:49Z"}

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def test_progressive_impedance_and_duplicates(self):
        weight_only = {**self.measurement, "impedance_ohm": None, "raw_hex": "weight-only"}
        self.assertTrue(self.store.record(weight_only))
        self.assertIsNone(self.store.rows()[0]["metrics"])
        self.assertTrue(self.store.record(self.measurement))
        self.assertFalse(self.store.record(self.measurement))
        self.assertEqual(len(self.store.rows()), 1)
        self.assertAlmostEqual(self.store.rows()[0]["metrics"]["body_fat_percent"], 19.78604393063582)

    def test_new_day_persists_and_profile_does_not_rewrite_past(self):
        self.store.record(self.measurement)
        self.store.save_profile({"height_cm": 180, "birthdate": "2003-09-23", "sex": "male"})
        tomorrow = {**self.measurement, "captured_at": "2026-10-23T19:53:49Z", "raw_hex": "next-day"}
        self.assertTrue(self.store.record(tomorrow))
        rows = self.store.rows()
        self.assertEqual(rows[0]["profile"]["height_cm"], 180)
        self.assertEqual(rows[1]["profile"]["height_cm"], 184)
        self.store.db.close()
        self.store = Store(self.path)
        self.assertEqual(len(self.store.rows()), 2)
        self.assertFalse(self.store.record(tomorrow))

    def test_unstable_removed_and_invalid_profile(self):
        for field in ({"stabilized": False}, {"load_removed": True}, {"weight_kg": 0}):
            self.assertFalse(self.store.record({**self.measurement, **field}))
        with self.assertRaises(ValueError):
            self.store.save_profile({"height_cm": float("nan"), "birthdate": "2003-09-23", "sex": "male"})
        self.assertEqual(self.store.rows(), [])

    def test_replay_ble_packets(self):
        bluetooth = Bluetooth(self.store)
        for payload in ("0204ea070a161335390000d23c", "0226ea070a16133539e701d23c"):
            bluetooth.ingest({"event": "read", "uuid": "2A9C", "hex": payload, "captured_at": "2026-10-22T19:53:49Z"})
        rows = self.store.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["weight_kg"], 77.85)
        self.assertEqual(rows[0]["impedance_ohm"], 487)
        self.assertIsNotNone(rows[0]["metrics"])

    def test_http_state_export_static_and_origin_validation(self):
        self.store.record(self.measurement)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.store = self.store
        server.bluetooth = Bluetooth(self.store)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urllib.request.urlopen(base + "/api/state") as response:
                self.assertEqual(len(json.load(response)["measurements"]), 1)
            with urllib.request.urlopen(base + "/api/export.csv") as response:
                self.assertIn("attachment", response.headers["Content-Disposition"])
                self.assertIn("77.85", response.read().decode())
            for path in ("/", "/app.js", "/style.css"):
                with urllib.request.urlopen(base + path) as response:
                    self.assertEqual(response.status, 200)
            request = urllib.request.Request(base + "/api/disconnect", data=b'{}', headers={"Content-Type": "application/json", "Origin": "https://example.com"})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 403)
            request = urllib.request.Request(base + "/api/profile", data=b'{"height_cm": 0}', headers={"Content-Type": "application/json"})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
