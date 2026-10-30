# QRecall AutoQEC — ESP32 Repetition-Code Noise Demonstrator

A two-ESP32 demonstration. The transmitter sends repetition-encoded text over ESP-NOW with software-injected bit flips at a noise level you set from 1 to 100%. The receiver decodes it and reports two results for every packet: **without QEC** and **with QEC**. A browser page shows both side by side in real time.

> **Scope:** The transmitter performs 3× repetition encoding and software bit-flip injection. ESP-NOW frames that pick up real radio errors fail the Wi-Fi checksum and are dropped, so the bit flips are simulated in software on a real radio link. The receiver decodes each 3-copy block from its syndrome, using only the noisy copies. The `raw` field is transmitter-supplied text, used only to count errors for display.

## Live demo quick start

After the one-time setup below (sections 1–3), run:

```bash
./qrecall.sh flash    # once, or after changing the firmware
./qrecall.sh demo
```

If the shell reports `Permission denied`, run `chmod +x qrecall.sh` once, or use `bash qrecall.sh demo`.

Open **http://localhost:8765** in a browser on the same computer:

1. Type a message (up to 48 ASCII characters).
2. Drag the **noise bar** (1–100%) or click a preset. Each change sends the message once.
3. Turn on **Live** to keep sending about 3 packets a second while you move the bar.

| Panel | What it shows |
|---|---|
| Without QEC | The first copy of each bit, as an unprotected link would receive it. Wrong characters are highlighted. |
| With QEC | The RX ESP32's decoded text, plus the number of corrections it applied |
| Bit view | Every character as 8 bits × 3 copies. Flipped copies are red; the bottom strip shows whether each decoded bit is right. |
| Average | Bit error rate since the noise or message last changed, next to the expected value (p without QEC, 3p² − 2p³ with QEC) |

To rehearse without the boards, run `./qrecall.sh simulate`. It shows the same page, labelled **SIMULATION**, with encoding, noise and decoding computed on the PC.

### What to expect at each noise level

These figures are for 3 copies. A character counts as wrong if any of its 8 bits is wrong.

| Noise | Bit errors without → with QEC | Wrong characters without → with QEC |
|---|---|---|
| 5% | 5% → 0.7% | 34% → 6% |
| 10% | 10% → 2.8% | 57% → 20% |
| 20% | 20% → 10.4% | 83% → 58% |
| 30% | 30% → 21.6% | 94% → 86% |
| 50% | 50% → 50% | both unreadable |
| 70% | 70% → 78% | QEC makes it worse |

- **5–10%** gives the clearest contrast: the message is readable with QEC and garbled without it.
- **At 50%** every received copy is a coin toss, so no code can recover the message.
- **Above 50%** most copies are flipped, so the majority vote picks the wrong value; the page says so when the bar passes 50%.
- **A single packet can be unlucky.** Leave Live on for a few seconds and point at the Average panel.

## Architecture

```text
Browser (http://localhost:8765)
  | message + noise bar
  v
pc_demo/dashboard.py ── USB serial: "/noise N" + message ──> TX ESP32
  ^                                                           | 3× repetition encoding
  |                                                           | software bit flips (N%)
  |                                                           | ESP-NOW broadcast
  |                                                           v
  └──── USB serial: one JSON record per packet ─────────── RX ESP32
        (also appended to runs/<session>/received.jsonl)      | syndrome decoding of each 3-copy block
                                                               | without QEC: first copy of each bit
```

The older logger workflow (`./qrecall.sh deploy`) still works. The TX accepts typed messages and `/noise <1-100>`, and the logger prints the sent text and both results for every packet.

## Repository layout

```text
qrecall-automation/
├── .gitignore
├── README.md
├── qrecall.sh
├── qrecall.conf.example
├── TXNoiseDebug/TXNoiseDebug.ino
├── RXReceiver/RXReceiver.ino
├── pc_demo/dashboard.py
├── pc_logger/rx_logger.py
└── docs/INSTRUCTIONS.md
```

## Requirements

- Windows with WSL 2 and Ubuntu (the demonstrated workflow used Ubuntu 24.04)
- Two ESP32 development boards
- `usbipd-win` for USB passthrough into WSL 2
- Arduino CLI with the ESP32 Arduino platform installed
- Python 3 and `pyserial`
- `tmux`, `usbutils`, and standard Linux utilities

The automation script defaults to the Arduino FQBN `esp32:esp32:esp32`. Confirm this FQBN matches the exact ESP32 board variant being used.

## 1. Install Linux-side dependencies

In Ubuntu/WSL:

```bash
sudo apt update
sudo apt install -y tmux python3 python3-serial unzip usbutils
```

Confirm the required tools are present:

```bash
arduino-cli version
arduino-cli core list
arduino-cli board list
python3 --version
tmux -V
```

Install Arduino CLI and the ESP32 board platform if they are not already installed.

## 2. Attach both ESP32 boards to WSL 2

Open **PowerShell as Administrator** and list connected USB devices:

```powershell
usbipd list
```

Identify the two USB-to-UART adapters and their actual BUSIDs. Bind each device if it is not already shared:

```powershell
usbipd bind --busid <TX_BUSID>
usbipd bind --busid <RX_BUSID>
```

Then use **normal PowerShell** to attach both to WSL:

```powershell
usbipd attach --wsl --busid <TX_BUSID>
usbipd attach --wsl --busid <RX_BUSID>
```

Replace the placeholders with the BUSIDs shown on your computer.

Verify from Ubuntu:

```bash
lsusb
ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
./qrecall.sh ports
```

To identify which physical ESP32 corresponds to a port, disconnect one board, run `./qrecall.sh ports`, and note which device disappears. Repeat for the other board. Device numbering may change after reconnecting; use `/dev/serial/by-id/` paths where available.

If you get a serial permission error, check group membership and add your user to `dialout` if needed:

```bash
groups
sudo usermod -aG dialout "$USER"
newgrp dialout
```

If the new group is not reflected in the current shell, open a new Ubuntu terminal. Verify read/write access using the actual device paths, for example:

```bash
test -r /dev/ttyUSB0 && test -w /dev/ttyUSB0 && echo "USB0 accessible"
test -r /dev/ttyUSB1 && test -w /dev/ttyUSB1 && echo "USB1 accessible"
```

## 3. Configure the TX and RX serial ports

Copy the example configuration and edit it:

```bash
cp qrecall.conf.example qrecall.conf
nano qrecall.conf
```

Set the verified paths. Example only:

```bash
TX_PORT="/dev/ttyUSB0"
RX_PORT="/dev/ttyUSB1"
```

Prefer stable `/dev/serial/by-id/...` paths if the adapters expose unique IDs. **Do not commit `qrecall.conf`**: it is machine-specific and ignored by Git. Commit only `qrecall.conf.example`.

## 4. Compile both ESP32 sketches

From the repository root:

```bash
./qrecall.sh build
```

This compiles TX and RX without flashing. Fix compiler errors before continuing. To override the default board FQBN:

```bash
FQBN="esp32:esp32:esp32" ./qrecall.sh build
```

## 5. Flash and deploy

After a successful build and after checking the port mapping:

```bash
./qrecall.sh deploy
```

The automation script compiles both sketches, flashes the RX first and then the TX, creates a timestamped folder under `runs/`, and launches a tmux session containing the RX JSON logger and TX serial monitor.

The Python logger owns the RX serial port during the session. Do not open a second serial monitor on that same RX port.

## 6. Send a test message

In the TX serial-monitor pane, enter a test message such as:

```text
QHACK 2026
```

For ten ASCII characters, with 8 bits per character and three repetitions per bit:

```text
10 characters × 8 bits/character × 3 = 240 encoded bits
```

The TX debug output reports the sequence number, encoded-bit count, flip count, configured noise, and ESP-NOW send-request status.

`ESP-NOW send request accepted` means the local ESP-NOW stack accepted the request; it is not by itself a delivery acknowledgement. A corresponding JSON record from the RX logger is evidence that the packet reached the receiver and was logged.

## 7. Inspect the JSONL output

Open a second WSL terminal without stopping the running logger:

```bash
LATEST=$(find runs -type f -name received.jsonl -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)
echo "Latest log: $LATEST"
wc -l "$LATEST"
tail -n 10 "$LATEST"
```

Validate that each non-empty line is valid JSON:

```bash
python3 - "$LATEST" <<'PY'
import json
import sys

valid = invalid = 0
with open(sys.argv[1], encoding="utf-8") as stream:
    for line_number, line in enumerate(stream, 1):
        if not line.strip():
            continue
        try:
            json.loads(line)
            valid += 1
        except json.JSONDecodeError as exc:
            invalid += 1
            print(f"Invalid JSON at line {line_number}: {exc}")

print(f"Valid JSON records: {valid}")
print(f"Invalid lines: {invalid}")
PY
```

## Automation commands

Run these from the repository root:

| Command | Purpose |
|---|---|
| `./qrecall.sh ports` | List serial devices visible to WSL |
| `./qrecall.sh build` | Compile TX and RX sketches |
| `./qrecall.sh flash` | Compile and flash both ESP32 boards |
| `./qrecall.sh deploy` | Compile, flash, and launch logger/monitor session |
| `./qrecall.sh monitor` | Launch logger/monitor session without flashing |
| `./qrecall.sh demo` | Start the live demo page (noise bar, without/with QEC) on the configured ports |
| `./qrecall.sh simulate` | Start the demo page with no boards, for rehearsal |
| `./qrecall.sh stop` | Stop the QRecall tmux session |

`demo` and `simulate` serve the page on port 8765. Use `DEMO_PORT=9000 ./qrecall.sh demo` to change it.

### Running the demo page on Windows without WSL

The dashboard is plain Python. If the boards are already flashed, it can run directly on Windows using the COM ports shown in Device Manager:

```powershell
py -m pip install pyserial
py pc_demo\dashboard.py --tx COM5 --rx COM6
py pc_demo\dashboard.py --simulate
```

To open the TX monitor directly:

```bash
arduino-cli monitor --port /dev/ttyUSB0 --config baudrate=115200
```

Use the currently verified TX port. `Ctrl+C` exits the host-side monitor; it does not erase the firmware stored on the ESP32.

## Troubleshooting

### No serial ports appear in WSL

- Run `usbipd list` in Windows PowerShell.
- Confirm that both USB adapters are attached to WSL.
- Run `lsusb` and `ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null` in Ubuntu.
- Run `./qrecall.sh ports` again.

See [Microsoft's WSL USB documentation](https://learn.microsoft.com/en-us/windows/wsl/connect-usb).

### Permission denied on a serial port

Ensure your user belongs to `dialout`, then open a new Ubuntu shell if the group change has not taken effect.

### Build fails

Check the Arduino CLI version, installed ESP32 core, and selected FQBN. Resolve the first compiler error before flashing.

### Logger runs but no JSON is saved

Check that the logger is using the RX port and the monitor is using the TX port. Verify both firmware sketches agree on the ESP-NOW channel and packet structure, and confirm the RX firmware has been flashed.

### Demo page problems

- **The page does not open from Windows while the dashboard runs in WSL.** Recent WSL versions forward `localhost` automatically. If yours does not, start the dashboard with `--host 0.0.0.0` and open the WSL IP address shown by `hostname -I`.
- **The page shows "flash the updated TXNoiseDebug.ino" or "flash the updated RXReceiver.ino".** One board still runs the old firmware, which has no `/noise` command or no decoding. Run `./qrecall.sh flash`.
- **"The logger/monitor session is using the ports".** Run `./qrecall.sh stop`, then `./qrecall.sh demo`. Only one program can own each serial port.
- **Nothing arrives.** Open **Device log** at the bottom of the page. A `[TX] ESP-NOW send request accepted.` line with no new result means the RX did not receive the packet. Check that both boards use the same Wi-Fi channel and are powered.

### Unreadable serial characters

Confirm firmware, logger, and monitor use the intended baud rate (default `115200`). Startup output may appear before JSON. The logger prints non-JSON serial lines for diagnostics but persists only valid JSON objects.

## Detailed setup guide

See [`docs/INSTRUCTIONS.md`](docs/INSTRUCTIONS.md) for the full step-by-step WSL2, USB passthrough, build, flash, run, and troubleshooting instructions.

## References

- [Microsoft Learn: Connect USB devices to WSL](https://learn.microsoft.com/en-us/windows/wsl/connect-usb)
- [Arduino CLI documentation](https://docs.arduino.cc/arduino-cli/)
- [Arduino CLI monitor command](https://docs.arduino.cc/arduino-cli/commands-reference/arduino-cli_monitor)
- [Arduino CLI upload command](https://docs.arduino.cc/arduino-cli/commands-reference/arduino-cli_upload)
