#!/usr/bin/env python3
"""QRecall live demo: a browser page with a 1-100% noise bar that drives the two ESP32s.

Each send writes "/noise N" and the message to the TX ESP32 over USB serial. The RX ESP32 decodes the
packet and prints one JSON record; this script reads it from the RX serial port, appends it to a JSONL
file and shows the receiver's two results side by side: without QEC and with QEC.

--simulate runs the same encode, flip and decode steps in Python so the page can be rehearsed without the
boards. Simulated records carry "simulated": true and the page is labelled SIMULATION.
"""

import argparse
import json
import random
import sys
import threading
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

MAX_MESSAGE_LENGTH = 48  # must match both sketches
REPETITION_FACTOR = 3
KEEP_RECORDS = 500


# =====================================================
# CODEC (mirrors TXNoiseDebug.ino and RXReceiver.ino)
# =====================================================

def decode_block(copies):
    """Syndrome decoding as in RXReceiver.ino. Returns (bit, syndrome_fired)."""
    error = weight_a = 0
    fired = False
    for i in range(1, len(copies)):
        syndrome = copies[i - 1] ^ copies[i]
        fired = fired or bool(syndrome)
        error ^= syndrome
        weight_a += error
    weight_b = len(copies) - weight_a
    return copies[0] ^ (1 if weight_b < weight_a else 0), fired


def decode_packed(packed, length):
    """Packed noisy copies -> (without_qec bytes, with_qec bytes, corrections applied)."""
    without, with_qec = bytearray(), bytearray()
    corrections = bit_index = 0
    for _ in range(length):
        unprotected = decoded = 0
        for _ in range(8):
            copies = []
            for _ in range(REPETITION_FACTOR):
                copies.append((packed[bit_index // 8] >> (7 - bit_index % 8)) & 1)
                bit_index += 1
            bit, fired = decode_block(copies)
            corrections += fired
            unprotected = (unprotected << 1) | copies[0]
            decoded = (decoded << 1) | bit
        without.append(unprotected)
        with_qec.append(decoded)
    return bytes(without), bytes(with_qec), corrections


def count_errors(sent, received):
    """(bit errors, character errors) between two equal-length byte strings."""
    bits = sum(bin(a ^ b).count("1") for a, b in zip(sent, received))
    chars = sum(a != b for a, b in zip(sent, received))
    return bits, chars


def simulate_record(message, noise, seq, rng):
    """One packet through the same steps as the two sketches, as an RX-style record."""
    raw = message.encode("ascii")
    packed = bytearray(len(raw) * REPETITION_FACTOR)
    flips = bit_index = 0
    for byte in raw:
        for position in range(7, -1, -1):
            for _ in range(REPETITION_FACTOR):
                bit = (byte >> position) & 1
                if rng.randrange(100) < noise:
                    bit ^= 1
                    flips += 1
                if bit:
                    packed[bit_index // 8] |= 1 << (7 - bit_index % 8)
                bit_index += 1

    without, with_qec, corrections = decode_packed(packed, len(raw))
    bits_without, chars_without = count_errors(raw, without)
    bits_with, chars_with = count_errors(raw, with_qec)
    total = len(raw) * 8 * REPETITION_FACTOR
    return {
        "seq": seq,
        "raw": message,
        "noise_percent": noise,
        "flip_count": flips,
        "encoded_bits_per_char": 8 * REPETITION_FACTOR,
        "encoded_bits_total": total,
        "observed_noise_percent": round(100 * flips / total, 2) if total else 0.0,
        "noisy_encoded_hex": packed.hex().upper(),
        # The RX escapes every byte as \u00XX, which JSON reads back as Latin-1.
        "without_qec": without.decode("latin-1"),
        "with_qec": with_qec.decode("latin-1"),
        "bit_errors_without_qec": bits_without,
        "bit_errors_with_qec": bits_with,
        "char_errors_without_qec": chars_without,
        "char_errors_with_qec": chars_with,
        "corrections_applied": corrections,
        "decode_us": None,  # Python timing says nothing about the ESP32
        "sender_mac": "simulated",
        "receiver_count": seq,
        "simulated": True,
    }


def validate(message, noise):
    """Returns a problem description, or None when the request can go to the TX."""
    if not message:
        return "Type a message first."
    if len(message) > MAX_MESSAGE_LENGTH:
        return f"Messages are limited to {MAX_MESSAGE_LENGTH} characters."
    if any(not 32 <= ord(c) <= 126 for c in message):
        return "Use plain ASCII characters (no emoji or accents)."
    if message.startswith("/"):
        return "Messages cannot start with '/': the TX reads those lines as commands."
    if isinstance(noise, bool) or not isinstance(noise, int) or not 1 <= noise <= 100:
        return "Noise must be a whole number from 1 to 100."
    return None


# =====================================================
# SHARED STATE
# =====================================================

class Demo:
    """State shared by the serial readers, the simulator and the HTTP handlers."""

    def __init__(self, mode, ports, output):
        self.mode = mode
        self.ports = ports
        self.lock = threading.Lock()
        self.records = deque(maxlen=KEEP_RECORDS)
        self.count = 0
        self.log = deque(maxlen=80)
        self.error = None
        self.sent_at = None
        self.output = output.open("a", encoding="utf-8") if output else None

    def mark_sent(self):
        with self.lock:
            self.sent_at = time.monotonic()

    def add_record(self, record):
        record["pc_received_at_utc"] = datetime.now(timezone.utc).isoformat()
        with self.lock:
            if self.sent_at is not None:
                record["pc_round_trip_ms"] = round((time.monotonic() - self.sent_at) * 1000, 1)
                self.sent_at = None
            if str(record.get("raw", "")).startswith("/noise"):
                self.error = "The TX sent '/noise' as a message: flash the updated TXNoiseDebug.ino."
            self.count += 1
            self.records.append((self.count, record))
            if self.output:
                self.output.write(json.dumps(record, ensure_ascii=False) + "\n")
                self.output.flush()

    def add_log(self, source, line):
        with self.lock:
            self.log.append(f"[{source}] {line}")

    def set_error(self, message):
        with self.lock:
            self.error = message

    def snapshot(self, since):
        with self.lock:
            return {
                "mode": self.mode,
                "ports": self.ports,
                "count": self.count,
                "records": [dict(record, index=index) for index, record in self.records if index > since],
                "log": list(self.log),
                "error": self.error,
            }


# =====================================================
# LINKS: real boards over USB serial, or the simulator
# =====================================================

class SerialLink:
    def __init__(self, demo, tx_port, rx_port, baud):
        import serial  # only needed with real boards

        self.serial = serial
        self.demo = demo
        self.tx = serial.Serial(tx_port, baud, timeout=0.5)
        self.rx = serial.Serial(rx_port, baud, timeout=0.5)
        self.tx_lock = threading.Lock()
        for port, name, handler in ((self.tx, "TX", self._tx_line), (self.rx, "RX", self._rx_line)):
            threading.Thread(target=self._pump, args=(port, name, handler), daemon=True).start()

    def _pump(self, port, name, handler):
        while True:
            try:
                raw = port.readline()
            except self.serial.SerialException as exc:
                self.demo.set_error(f"{name} serial port stopped: {exc}")
                return
            line = raw.decode("utf-8", errors="replace").strip()
            if line:
                handler(name, line)

    def _tx_line(self, name, line):
        self.demo.add_log(name, line)

    def _rx_line(self, name, line):
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            record = None
        if isinstance(record, dict) and "with_qec" in record:
            self.demo.add_record(record)
            return
        self.demo.add_log(name, line)
        if isinstance(record, dict):
            self.demo.set_error("The RX sent a record without decoding results: flash the updated RXReceiver.ino.")

    def send(self, message, noise):
        # The noise goes with every message, so a TX that restarted mid-demo picks it up again.
        with self.tx_lock:
            self.tx.write(f"/noise {noise}\n{message}\n".encode("ascii"))
            self.tx.flush()


class SimulatedLink:
    def __init__(self, demo):
        self.demo = demo
        self.rng = random.Random()
        self.seq = 0
        demo.add_log("SIM", "Simulation mode: no ESP32 attached; every record is computed on this PC.")

    def send(self, message, noise):
        self.seq += 1
        record = simulate_record(message, noise, self.seq, self.rng)
        threading.Timer(0.03, self.demo.add_record, args=(record,)).start()


# =====================================================
# HTTP
# =====================================================

def make_handler(demo, link):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, status, body, content_type):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status, payload):
            self._send(status, json.dumps(payload).encode("utf-8"), "application/json")

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/":
                self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
            elif url.path == "/api/state":
                try:
                    since = int(parse_qs(url.query).get("since", ["0"])[0])
                except ValueError:
                    since = 0
                self._json(200, demo.snapshot(since))
            else:
                self._json(404, {"error": "Not found."})

        def do_POST(self):
            if urlparse(self.path).path != "/api/send":
                return self._json(404, {"error": "Not found."})
            # JSON only: a plain cross-site form cannot trigger a send.
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                return self._json(415, {"error": "Send JSON."})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "Invalid JSON."})
            message = str(body.get("message", "")).strip()
            noise = body.get("noise")
            problem = validate(message, noise)
            if problem:
                return self._json(400, {"error": problem})
            demo.mark_sent()
            try:
                link.send(message, noise)
            except Exception as exc:  # serial write failures surface on the page
                demo.set_error(f"Could not write to the TX: {exc}")
                return self._json(500, {"error": f"Could not write to the TX: {exc}"})
            self._json(200, {"ok": True})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="QRecall live demo: noise bar plus without/with QEC results.")
    parser.add_argument("--tx", help="TX ESP32 serial port, e.g. /dev/ttyUSB0 or COM5")
    parser.add_argument("--rx", help="RX ESP32 serial port, e.g. /dev/ttyUSB1 or COM6")
    parser.add_argument("--baud", type=int, default=115200, help="Serial baud rate (default: 115200)")
    parser.add_argument("--simulate", action="store_true", help="No boards: encode, flip and decode on this PC")
    parser.add_argument("--host", default="127.0.0.1", help="Address to serve the page on (default: 127.0.0.1)")
    parser.add_argument("--http-port", type=int, default=8765, help="Page port (default: 8765)")
    parser.add_argument("--output", help="Append every record to this JSONL file")
    args = parser.parse_args()

    if not args.simulate and not (args.tx and args.rx):
        parser.error("give --tx and --rx for the boards, or --simulate")

    output = Path(args.output).expanduser() if args.output else None
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)

    if args.simulate:
        demo = Demo("simulation", {}, output)
        link = SimulatedLink(demo)
    else:
        demo = Demo("hardware", {"tx": args.tx, "rx": args.rx}, output)
        try:
            link = SerialLink(demo, args.tx, args.rx, args.baud)
        except ImportError:
            sys.exit("pyserial is missing. Install it with: python3 -m pip install --user pyserial")
        except Exception as exc:
            sys.exit(f"Could not open the serial ports: {exc}\n"
                     "Check the port names and permissions, and close any other serial monitor on them.")
        # Opening a port can restart an ESP32; give both boards time to boot before the first send.
        print("Ports open. Waiting 2 s in case the boards restarted...", flush=True)
        time.sleep(2)

    server = ThreadingHTTPServer((args.host, args.http_port), make_handler(demo, link))
    print(f"QRecall live demo ({demo.mode}): open http://localhost:{args.http_port}   Ctrl+C stops it.", flush=True)
    if output:
        print(f"Saving records to {output.resolve()}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


# =====================================================
# PAGE
# =====================================================

PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QRecall ESP32 Live</title>
<style>
  :root {
    --bg: #070b14; --panel: #0e1626; --panel-2: #121c30; --line: #1f2b44;
    --text: #e6edf7; --muted: #8796b3; --cyan: #5ad8ef;
    --good: #3fd0b0; --bad: #f47c80; --warn: #f2c46d;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: radial-gradient(ellipse at 50% -10%, #10203a, var(--bg) 60%) fixed; color: var(--text);
         font: 15px/1.45 "Segoe UI", system-ui, -apple-system, sans-serif; }
  header { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between;
           padding: 14px 24px; border-bottom: 1px solid var(--line); }
  .brand { font-size: 18px; font-weight: 600; letter-spacing: .2px; }
  .brand .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--cyan);
                box-shadow: 0 0 12px var(--cyan); margin-right: 8px; }
  .status { display: flex; flex-wrap: wrap; gap: 8px; }
  .pill { border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 3px 12px;
          font-size: 12.5px; color: var(--muted); }
  .pill.ok { color: var(--good); border-color: #1d5a4d; }
  .pill.warn { color: var(--warn); border-color: #6b5524; }
  main { max-width: 1280px; margin: 0 auto; padding: 18px 24px 40px; display: grid; gap: 16px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; }
  h2, h3 { margin: 0 0 10px; font-size: 16px; font-weight: 600; }
  .muted { color: var(--muted); }
  .small { font-size: 12.5px; font-weight: 400; }
  .mono { font-family: "Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace; }

  .controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) auto; gap: 22px; align-items: start; }
  .field { display: grid; gap: 6px; }
  .field > span:first-child, .noise-head span { font-size: 12.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .6px; }
  input[type=text] { width: 100%; background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
                     border-radius: 10px; padding: 10px 12px; font: 17px "Cascadia Mono", Consolas, monospace; }
  input[type=text]:focus { outline: 2px solid var(--cyan); outline-offset: 1px; }
  .noise-head { display: flex; justify-content: space-between; align-items: baseline; }
  #noiseOut { font-size: 30px; font-weight: 700; color: var(--cyan); font-variant-numeric: tabular-nums; }
  #noiseOut.hot { color: var(--warn); }
  .slider-wrap { position: relative; padding: 6px 0; }
  input[type=range] { width: 100%; accent-color: var(--cyan); height: 26px; margin: 0; }
  .mark50 { position: absolute; left: calc(50% - 1px); top: 0; bottom: 0; width: 2px; background: var(--warn); opacity: .7; pointer-events: none; }
  .presets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .presets button { background: var(--panel-2); color: var(--muted); border: 1px solid var(--line); border-radius: 8px;
                    padding: 3px 10px; font-size: 12.5px; cursor: pointer; }
  .presets button:hover { color: var(--text); border-color: var(--cyan); }
  #noiseNote { margin: 8px 0 0; }
  #noiseNote.hot { color: var(--warn); }
  .buttons { display: grid; gap: 8px; min-width: 130px; padding-top: 20px; }
  button.primary, button.toggle { border-radius: 10px; padding: 10px 16px; font-size: 15px; font-weight: 600; cursor: pointer; }
  button.primary { background: var(--cyan); color: #04121a; border: 0; }
  button.toggle { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); }
  button.toggle[aria-pressed=true] { border-color: var(--good); color: var(--good); box-shadow: 0 0 0 1px var(--good) inset; }
  button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }

  .error { margin: 0; padding: 10px 14px; border-radius: 10px; background: #2a1218; border: 1px solid #6b2a33; color: var(--bad); }
  .results { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .result { border-top: 3px solid var(--bad); }
  .result.good-side { border-top-color: var(--good); }
  .text { min-height: 2.6em; font: 600 clamp(18px, 2.1vw, 28px)/1.35 "Cascadia Mono", Consolas, monospace;
          white-space: pre-wrap; word-break: break-all; margin: 4px 0 12px; }
  .text .wrong { background: rgba(244, 124, 128, .22); color: var(--bad); border-radius: 3px; }
  .stat { color: var(--muted); }
  .stat b { color: var(--text); font-size: 20px; font-variant-numeric: tabular-nums; }
  .meta { display: grid; gap: 4px; }
  .meta .mono { font-size: 17px; }

  .bits { display: flex; flex-wrap: wrap; gap: 10px 12px; }
  .ch { display: grid; gap: 3px; justify-items: center; }
  .ch span { font: 12px "Cascadia Mono", Consolas, monospace; color: var(--muted); min-height: 1em; }
  .grid { display: grid; grid-template-columns: repeat(8, 7px); gap: 2px; }
  .grid i { width: 7px; height: 7px; border-radius: 1.5px; background: #24324f; }
  .grid i.f { background: var(--bad); }
  .grid i.d { height: 4px; margin-top: 2px; }
  .grid i.ok { background: var(--good); opacity: .65; }
  .grid i.bad { background: var(--bad); }

  .bars { display: grid; gap: 10px; }
  .bar-row { display: grid; grid-template-columns: 110px 1fr 70px 130px; gap: 12px; align-items: center; }
  .bar { height: 14px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 7px; overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; background: var(--bad); transition: width .25s ease; }
  .bar i.good { background: var(--good); }
  .bar-row b { font-variant-numeric: tabular-nums; text-align: right; }
  details summary { cursor: pointer; color: var(--muted); }
  pre { margin: 10px 0 0; max-height: 220px; overflow: auto; font: 12px/1.5 "Cascadia Mono", Consolas, monospace; color: var(--muted); white-space: pre-wrap; }

  @media (max-width: 900px) {
    .controls, .results { grid-template-columns: 1fr; }
    .buttons { grid-auto-flow: column; padding-top: 0; }
    .bar-row { grid-template-columns: 90px 1fr 60px; }
    .bar-row .exp { grid-column: 2 / -1; }
    header, main { padding-left: 16px; padding-right: 16px; }
  }
  @media (prefers-reduced-motion: reduce) { .bar i { transition: none; } }
</style>
</head>
<body>
<header>
  <div class="brand"><span class="dot"></span>QRecall <span class="muted">· ESP32 live link</span></div>
  <div class="status"><span id="mode" class="pill">connecting…</span><span id="link" class="pill">waiting</span></div>
</header>
<main>
  <section class="card controls">
    <label class="field">
      <span>Message</span>
      <input id="msg" type="text" maxlength="48" value="QRECALL LIVE QEC DEMO" autocomplete="off" spellcheck="false">
      <span id="msgCount" class="muted small"></span>
    </label>
    <div>
      <div class="noise-head"><span id="noiseLabel">Noise</span><output id="noiseOut" for="noise">10%</output></div>
      <div class="slider-wrap">
        <input id="noise" type="range" min="1" max="100" value="10" aria-labelledby="noiseLabel">
        <div class="mark50" title="50%: every bit is a coin toss"></div>
      </div>
      <div class="presets" id="presets"></div>
      <p id="noiseNote" class="small muted"></p>
    </div>
    <div class="buttons">
      <button id="send" class="primary">Send</button>
      <button id="live" class="toggle" aria-pressed="false">Live: off</button>
    </div>
  </section>

  <p id="error" class="error" hidden></p>

  <section class="results">
    <article class="card result">
      <h2>Without QEC <span class="muted small">one copy of each bit</span></h2>
      <div id="without" class="text muted">waiting for a packet…</div>
      <div class="stat"><b id="withoutChars">–</b> wrong characters · <span id="withoutBits">–</span> bit errors</div>
    </article>
    <article class="card result good-side">
      <h2>With QEC <span id="withSub" class="muted small">3 copies + syndrome decoding on the RX ESP32</span></h2>
      <div id="with" class="text muted">waiting for a packet…</div>
      <div class="stat"><b id="withChars">–</b> wrong characters · <span id="withBits">–</span> bit errors · <span id="corr">–</span> corrections applied</div>
    </article>
  </section>

  <section class="card meta">
    <div><span class="muted">Sent:</span> <span id="sent" class="mono">–</span></div>
    <div id="facts" class="small muted">Press Send, or turn Live on to keep sending while you move the bar.</div>
  </section>

  <section class="card">
    <h3>Bit view <span class="muted small">each character = 8 bits × 3 copies. Red squares: copies flipped by noise. Bottom strip: decoded bit, green right, red wrong.</span></h3>
    <div id="bits" class="bits"></div>
  </section>

  <section class="card">
    <h3>Average at <span id="avgNoise">10%</span> noise <span class="muted small" id="avgCount">0 packets</span></h3>
    <div class="bars">
      <div class="bar-row"><span>Without QEC</span><div class="bar"><i id="barWithout"></i></div><b id="avgWithout">–</b><span class="muted small exp" id="expWithout"></span></div>
      <div class="bar-row"><span>With QEC</span><div class="bar"><i id="barWith" class="good"></i></div><b id="avgWith">–</b><span class="muted small exp" id="expWith"></span></div>
    </div>
    <p class="small muted">Bit error rate over the packets received since the noise or message last changed. Expected: p without QEC, 3p² − 2p³ with 3 copies.</p>
  </section>

  <details class="card"><summary>Device log</summary><pre id="log"></pre></details>
</main>
<script>
const $ = (id) => document.getElementById(id);
let since = 0, pendingAt = null, lastSendAt = 0, live = false, clientError = null;
let avg = { key: "", n: 0, bits: 0, without: 0, with: 0 };

const message = () => $("msg").value.trim();
const noise = () => Number($("noise").value);
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const shown = (ch) => { const c = ch.charCodeAt(0); return c < 32 || (c >= 127 && c < 160) ? "·" : ch; };
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function noiseNote(p) {
  if (p < 50) return `Each transmitted copy of each bit flips with probability ${p}%.`;
  if (p === 50) return "50%: every received bit is a coin toss, so no code can recover the message.";
  return `${p}%: most copies arrive flipped, so the majority vote picks the wrong value. QEC cannot help above 50%.`;
}

function updateNoise() {
  const p = noise();
  $("noiseOut").textContent = `${p}%`;
  $("noiseOut").classList.toggle("hot", p >= 50);
  $("noiseNote").textContent = noiseNote(p);
  $("noiseNote").classList.toggle("hot", p >= 50);
  resetAverage();
}

function resetAverage() {
  avg = { key: `${noise()}|${message()}`, n: 0, bits: 0, without: 0, with: 0 };
  renderAverage();
}

function addToAverage(rec) {
  if (`${rec.noise_percent}|${rec.raw}` !== avg.key) return;
  avg.n += 1;
  avg.bits += rec.raw.length * 8;
  avg.without += rec.bit_errors_without_qec;
  avg.with += rec.bit_errors_with_qec;
}

function renderAverage() {
  const p = noise() / 100;
  const w = avg.bits ? avg.without / avg.bits : null;
  const q = avg.bits ? avg.with / avg.bits : null;
  $("avgNoise").textContent = `${noise()}%`;
  $("avgCount").textContent = `${avg.n} packet${avg.n === 1 ? "" : "s"}`;
  $("avgWithout").textContent = w === null ? "–" : pct(w);
  $("avgWith").textContent = q === null ? "–" : pct(q);
  $("barWithout").style.width = w === null ? "0" : pct(w);
  $("barWith").style.width = q === null ? "0" : pct(q);
  $("expWithout").textContent = `expected ${pct(p)}`;
  $("expWith").textContent = `expected ${pct(3 * p * p - 2 * p ** 3)}`;
}

function renderText(el, text, raw) {
  el.classList.remove("muted");
  el.replaceChildren(...[...text].map((ch, i) => {
    const span = document.createElement("span");
    span.textContent = shown(ch);
    if (ch !== raw[i]) span.className = "wrong";
    return span;
  }));
}

function renderBits(rec) {
  const hex = rec.noisy_encoded_hex || "";
  const copy = (i) => (parseInt(hex[i >> 2], 16) >> (3 - (i & 3))) & 1;
  let html = "";
  for (let i = 0; i < rec.raw.length; i++) {
    const sent = rec.raw.charCodeAt(i), decoded = rec.with_qec.charCodeAt(i);
    let cells = "";
    for (let k = 0; k < 3; k++) {
      for (let b = 0; b < 8; b++) {
        cells += `<i class="${copy((i * 8 + b) * 3 + k) !== ((sent >> (7 - b)) & 1) ? "f" : ""}"></i>`;
      }
    }
    for (let b = 0; b < 8; b++) {
      cells += `<i class="d ${((decoded ^ sent) >> (7 - b)) & 1 ? "bad" : "ok"}"></i>`;
    }
    html += `<div class="ch"><span>${escapeHtml(shown(rec.raw[i]))}</span><div class="grid">${cells}</div></div>`;
  }
  $("bits").innerHTML = html;
}

function render(rec) {
  const n = rec.raw.length;
  $("sent").textContent = rec.raw;
  renderText($("without"), rec.without_qec, rec.raw);
  renderText($("with"), rec.with_qec, rec.raw);
  $("withoutChars").textContent = `${rec.char_errors_without_qec} / ${n}`;
  $("withChars").textContent = `${rec.char_errors_with_qec} / ${n}`;
  $("withoutBits").textContent = rec.bit_errors_without_qec;
  $("withBits").textContent = rec.bit_errors_with_qec;
  $("corr").textContent = rec.corrections_applied;
  const facts = [`packet #${rec.seq}`, `noise ${rec.noise_percent}%`,
                 `${rec.flip_count} of ${rec.encoded_bits_total} copies flipped (${rec.observed_noise_percent}%)`];
  if (rec.decode_us !== null && rec.decode_us !== undefined) facts.push(`decoded in ${rec.decode_us} µs on the RX ESP32`);
  if (rec.simulated) facts.push("simulated on this PC, no radio");
  else if (rec.pc_round_trip_ms !== undefined) facts.push(`PC → TX → radio → RX → PC in ${Math.round(rec.pc_round_trip_ms)} ms`);
  $("facts").textContent = facts.join(" · ");
  renderBits(rec);
  renderAverage();
}

function showError(text) {
  $("error").hidden = !text;
  $("error").textContent = text || "";
}

async function send() {
  pendingAt = lastSendAt = performance.now();
  try {
    const r = await fetch("/api/send", { method: "POST", headers: { "Content-Type": "application/json" },
                                         body: JSON.stringify({ message: message(), noise: noise() }) });
    const data = await r.json();
    clientError = r.ok ? null : data.error;
    if (!r.ok) { pendingAt = null; setLive(false); }
  } catch {
    clientError = "The dashboard server is not responding.";
    pendingAt = null;
  }
}

function setLive(on) {
  live = on;
  $("live").setAttribute("aria-pressed", String(on));
  $("live").textContent = on ? "Live: on" : "Live: off";
}

async function poll() {
  try {
    const r = await fetch(`/api/state?since=${since}`, { cache: "no-store" });
    const s = await r.json();
    const sim = s.mode === "simulation";
    $("mode").textContent = sim ? "SIMULATION · no boards" : `HARDWARE · TX ${s.ports.tx} · RX ${s.ports.rx}`;
    $("mode").className = `pill ${sim ? "warn" : "ok"}`;
    if (sim) $("withSub").textContent = "3 copies + syndrome decoding, simulated on this PC";
    $("link").textContent = s.count ? `${s.count} packets received` : "waiting for the first packet";
    $("log").textContent = s.log.join("\n");
    for (const rec of s.records) {
      since = Math.max(since, rec.index);
      addToAverage(rec);
    }
    if (s.records.length) {
      pendingAt = null;
      render(s.records[s.records.length - 1]);
    }
    showError(clientError || s.error);
  } catch {
    $("link").textContent = "dashboard offline";
  }
  // Live mode is stop-and-wait: the next packet goes once the last result is back (or after 1.5 s).
  const now = performance.now();
  if (live && now - lastSendAt > 300 && (pendingAt === null || now - pendingAt > 1500)) send();
  setTimeout(poll, 120);
}

for (const p of [5, 10, 20, 30, 50, 70, 100]) {
  const b = document.createElement("button");
  b.textContent = `${p}%`;
  b.addEventListener("click", () => { $("noise").value = p; updateNoise(); if (!live) send(); });
  $("presets").append(b);
}
$("noise").addEventListener("input", updateNoise);
$("noise").addEventListener("change", () => { if (!live) send(); });
$("msg").addEventListener("input", () => { $("msgCount").textContent = `${$("msg").value.length}/48`; resetAverage(); });
$("msg").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
$("send").addEventListener("click", send);
$("live").addEventListener("click", () => setLive(!live));
$("msgCount").textContent = `${$("msg").value.length}/48`;
updateNoise();
poll();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
