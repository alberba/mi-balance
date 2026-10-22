"""Local Mi Balance app: SQLite history and a CoreBluetooth bridge."""
import argparse
import csv
import datetime as dt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import os
import json
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import threading
import webbrowser
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from decode import decode
from metrics import ALGORITHM, age_on, calculate

device_path = ROOT / "captures/device.json"
local_device = json.loads(device_path.read_text()).get("corebluetooth_id", "") if device_path.exists() else ""
DEVICE = os.environ.get("MI_BALANCE_DEVICE", local_device)
DEFAULT_PROFILE = {"height_cm": 175, "birthdate": "1990-01-01", "sex": "male"}


def metrics_for(weight, impedance, captured_at, profile):
    date = dt.datetime.fromisoformat(captured_at.replace("Z", "+00:00")).astimezone(ZoneInfo("Europe/Madrid")).date()
    age = age_on(dt.date.fromisoformat(profile["birthdate"]), date)
    return calculate(weight, profile["height_cm"], age, profile["sex"], impedance) if impedance else None


def validate_profile(profile):
    if not isinstance(profile, dict):
        raise ValueError("El perfil debe ser un objeto")
    try:
        height = float(profile["height_cm"])
        birthdate = dt.date.fromisoformat(profile["birthdate"])
        sex = profile["sex"]
        age = age_on(birthdate, dt.datetime.now(ZoneInfo("Europe/Madrid")).date())
        if not 100 <= height <= 220:
            raise ValueError("La altura debe estar entre 100 y 220 cm")
        calculate(70, height, age, sex, 500)
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("Revisa altura (100–220 cm), fecha de nacimiento (18–99 años) y sexo") from error
    return {"height_cm": height, "birthdate": birthdate.isoformat(), "sex": sex}


class Store:
    def __init__(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS measurements (
                id INTEGER PRIMARY KEY, captured_at TEXT NOT NULL, device_id TEXT NOT NULL,
                weight_kg REAL NOT NULL, impedance_ohm INTEGER, raw_hex TEXT NOT NULL,
                metrics_json TEXT, profile_json TEXT NOT NULL, algorithm TEXT NOT NULL,
                UNIQUE(device_id,raw_hex));
        """)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO profile VALUES (1,?)", (json.dumps(DEFAULT_PROFILE),))

    def profile(self):
        with self.lock:
            return json.loads(self.db.execute("SELECT value FROM profile WHERE id=1").fetchone()[0])

    def save_profile(self, profile):
        profile = validate_profile(profile)
        with self.lock, self.db:
            self.db.execute("UPDATE profile SET value=? WHERE id=1", (json.dumps(profile),))
        # Existing results retain the profile used when they were captured.
        return profile

    def rows(self):
        with self.lock:
            result = []
            for row in self.db.execute("SELECT * FROM measurements ORDER BY captured_at DESC,id DESC"):
                value = dict(row)
                value["metrics"] = json.loads(value.pop("metrics_json"))
                value["profile"] = json.loads(value.pop("profile_json"))
                result.append(value)
            return result

    def record(self, measurement, device_id=DEVICE):
        if not measurement["stabilized"] or measurement["load_removed"] or not 10 <= (measurement["weight_kg"] or 0) <= 200:
            return False
        with self.lock, self.db:
            if self.db.execute("SELECT id FROM measurements WHERE device_id=? AND raw_hex=?", (device_id, measurement["raw_hex"])).fetchone():
                return False
            profile = self.profile()
            weight, impedance = measurement["weight_kg"], measurement["impedance_ohm"]
            stamp = measurement["captured_at"]
            last = self.db.execute("SELECT * FROM measurements WHERE device_id=? ORDER BY captured_at DESC,id DESC LIMIT 1", (device_id,)).fetchone()
            delta = (dt.datetime.fromisoformat(stamp.replace("Z", "+00:00")) - dt.datetime.fromisoformat(last["captured_at"].replace("Z", "+00:00"))).total_seconds() if last else None
            # One weighing repeats many frames; enrich the same row when impedance arrives.
            if last and 0 <= delta <= 120 and abs(last["weight_kg"] - weight) <= 0.1:
                if not impedance or last["impedance_ohm"]:
                    return False
                original_profile = json.loads(last["profile_json"])
                metrics = metrics_for(weight, impedance, last["captured_at"], original_profile)
                self.db.execute("UPDATE measurements SET weight_kg=?,impedance_ohm=?,raw_hex=?,metrics_json=? WHERE id=?",
                                (weight, impedance, measurement["raw_hex"], json.dumps(metrics), last["id"]))
            else:
                metrics = metrics_for(weight, impedance, stamp, profile)
                self.db.execute("INSERT INTO measurements(captured_at,device_id,weight_kg,impedance_ohm,raw_hex,metrics_json,profile_json,algorithm) VALUES (?,?,?,?,?,?,?,?)",
                                (stamp, device_id, weight, impedance, measurement["raw_hex"], json.dumps(metrics), json.dumps(profile), ALGORITHM))
            return True


class Bluetooth:
    def __init__(self, store):
        self.store = store
        self.lock = threading.RLock()
        self.process = None
        self.status = {"running": False, "phase": "idle", "message": "Conecta la báscula para recibir tu próxima pesada", "last_packet": None}

    def snapshot(self):
        with self.lock:
            state = dict(self.status)
            packet = state.get("last_packet")
            if state["phase"] == "measuring" and packet:
                age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(packet["captured_at"].replace("Z", "+00:00"))).total_seconds()
                if age > 20:
                    state.update(phase="connected", message="Esperando otra pesada. Activa la báscula para medir.")
            return state

    def start(self):
        with self.lock:
            if self.process and self.process.poll() is None:
                return
            self.process = subprocess.Popen([str(ROOT / "tools/scale-scan"), "0", "--gatt", "--device", DEVICE],
                                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            self.status.update(running=True, phase="scanning", message="Buscando tu báscula. Súbete para activarla.")
            threading.Thread(target=self.read, args=(self.process,), daemon=True).start()

    def stop(self):
        with self.lock:
            process = self.process
            self.process = None
            self.status.update(running=False, phase="idle", message="Bluetooth desconectado")
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    def read(self, process):
        try:
            for line in process.stdout:
                try:
                    event = json.loads(line)
                    with self.lock:
                        if self.process is not process:
                            return
                        self.ingest(event)
                except (ValueError, KeyError, TypeError, sqlite3.Error) as error:
                    with self.lock:
                        self.status.update(phase="error", message=f"No se pudo procesar la lectura: {error}")
            code = process.wait()
            with self.lock:
                if self.process is process:
                    self.process = None
                    message = self.status["message"] if self.status["phase"] == "error" else f"El lector Bluetooth terminó ({code}). Comprueba el permiso de Bluetooth y vuelve a conectar."
                    self.status.update(running=False, phase="error", message=message)
        finally:
            process.stdout.close()

    def ingest(self, event):
        kind = event.get("event")
        if kind == "bluetooth_state":
            state = event.get("state")
            messages = {2: "Bluetooth no está disponible en este Mac", 4: "Activa Bluetooth en Ajustes del Sistema", 3: "Permite Bluetooth en Ajustes del Sistema → Privacidad y seguridad"}
            if state in messages:
                self.status.update(phase="error", message=messages[state])
        if kind == "connected":
            self.status.update(phase="connected", message="Báscula conectada. Esperando una pesada.")
        if kind in ("disconnected", "connection_error"):
            self.status.update(phase="scanning", message="Buscando la báscula. Actívala con una pesada.")
        if "error" in event:
            self.status.update(phase="error", message="Error de Bluetooth: " + str(event["error"]))
        payloads = []
        if kind == "advertisement" and event.get("device_id") == DEVICE:
            payloads = [payload for uuid, payload in event.get("service_data", {}).items() if uuid.upper() == "181B"]
        elif kind == "read" and event.get("uuid") == "2A9C" and not event.get("error"):
            payloads = [event["hex"]]
        for payload in payloads:
            measurement = {**decode(payload), "captured_at": event["captured_at"]}
            self.status["last_packet"] = measurement
            if measurement["load_removed"]:
                self.status.update(phase="connected", message="Pesada terminada. Esperando la próxima.")
                continue
            if measurement["stabilized"]:
                saved = self.store.record(measurement)
                if measurement["impedance_ohm"]:
                    self.status.update(phase="saved", message="Pesada guardada con todas las métricas")
                elif saved:
                    self.status.update(phase="measuring", message="Peso guardado. Esperando la impedancia; sigue descalzo en la báscula.")
            else:
                self.status.update(phase="measuring", message="Midiendo. Espera a que el peso se estabilice.")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, data, status=200, content_type="application/json; charset=utf-8"):
        if not isinstance(data, bytes):
            data = json.dumps(data, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if content_type.startswith("text/csv"):
            self.send_header("Content-Disposition", 'attachment; filename="mi-balance.csv"')
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def local_request(self):
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        return self.headers.get("Host") in allowed and (not self.headers.get("Origin") or self.headers["Origin"] in {"http://" + host for host in allowed})

    def do_GET(self):
        if not self.local_request():
            return self.send({"error": "Origen no permitido"}, 403)
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self.send({"app": "mi-balance"})
        if path == "/api/state":
            return self.send({"profile": self.server.store.profile(), "status": self.server.bluetooth.snapshot(), "measurements": self.server.store.rows()})
        if path == "/api/export.csv":
            output = io.StringIO()
            rows = self.server.store.rows()
            metrics = list(calculate(70, 184, 23, "male", 500))
            writer = csv.writer(output)
            writer.writerow(["captured_at_utc", "weight_kg", "impedance_ohm", *metrics])
            for row in rows:
                writer.writerow([row["captured_at"], row["weight_kg"], row["impedance_ohm"], *[(row["metrics"] or {}).get(key, "") for key in metrics]])
            return self.send(output.getvalue().encode("utf-8-sig"), content_type="text/csv; charset=utf-8")
        files = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/style.css": ("style.css", "text/css")}
        if path not in files:
            return self.send({"error": "No encontrado"}, 404)
        name, mime = files[path]
        self.send((ROOT / "app/static" / name).read_bytes(), content_type=mime + "; charset=utf-8")

    def do_POST(self):
        if not self.local_request() or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send({"error": "Origen o formato no permitido"}, 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise ValueError("Solicitud inválida")
            body = json.loads(self.rfile.read(length))
            if self.path == "/api/profile":
                return self.send({"profile": self.server.store.save_profile(body)})
            if self.path == "/api/connect":
                self.server.bluetooth.start()
            elif self.path == "/api/disconnect":
                self.server.bluetooth.stop()
            else:
                return self.send({"error": "No encontrado"}, 404)
            self.send({"ok": True})
        except (ValueError, TypeError) as error:
            self.send({"error": str(error)}, 400)
        except OSError:
            self.send({"error": "No se pudo iniciar el lector Bluetooth"}, 500)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true")
    parser.add_argument("--no-bluetooth", action="store_true")
    args = parser.parse_args()
    store = Store(ROOT / "data/mi-balance.sqlite3")
    seed_path = ROOT / "captures/measurement.json"
    if not store.rows() and seed_path.exists():
        store.record(json.loads(seed_path.read_text()))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.store = store
    server.bluetooth = Bluetooth(store)
    def shutdown(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    if not args.no_bluetooth:
        server.bluetooth.start()
    url = f"http://127.0.0.1:{args.port}"
    print(f"Mi Balance · {url}", flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    finally:
        server.bluetooth.stop()
        server.server_close()
        store.db.close()


if __name__ == "__main__":
    main()
