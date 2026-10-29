# Live view: a headed browser on a PC and a phone

The driver runs headless by default. This page shows how to see the
browser while a run works. It uses a virtual display (Xvfb), a VNC server
(x11vnc), and a browser viewer (noVNC). The viewer speaks HTTP, so a phone
can open it too.

## What this host has

- `Xvfb` is installed at `/usr/bin/Xvfb`.
- `x11vnc`, `websockify`, and `noVNC` are not installed.
- This host has no sudo access, so the install steps wait for an admin.

The service and the profiles work without them. Only the live view needs
the extra packages.

## Host setup, once

Debian and Ubuntu:

```sh
sudo apt install x11vnc websockify novnc
```

Fedora:

```sh
sudo dnf install x11vnc python3-websockify novnc
```

`novnc` installs `vnc.html` under `/usr/share/novnc`. `websockify` ships
with the `novnc` package on some distributions and as its own package on
others.

## Start the display and the viewer

```sh
# 1. a virtual display, 1280x800, in the background
Xvfb :99 -screen 0 1280x800x24 &

# 2. VNC on that display, loopback only, with a password
x11vnc -display :99 -localhost -rfbauth ~/.vnc/passwd -forever -shared &

# 3. the web viewer, loopback only
websockify --web /usr/share/novnc 6080 localhost:5900 &
```

Create the password file once with `x11vnc -storepasswd`. Then open
`http://127.0.0.1:6080/vnc.html` on the PC.

From a phone, tunnel the viewer port over SSH:

```sh
ssh -L 6080:127.0.0.1:6080 user@host
```

Open `http://127.0.0.1:6080/vnc.html` on the phone. The tunnel carries the
traffic. Do not open the VNC or viewer port to the network.

## Start the service on the display

```sh
export DISPLAY=:99
export BROWSER_DRIVER_TOKEN="$(openssl rand -hex 16)"
npm run service
```

Then start a headed run:

```sh
browser-driver run --goal "Log in and open the invoice list" \
  --url "https://example.test/login" --profile work --headed \
  --allowlist example.test
```

The window shows in the viewer. A run that needs a person ends
`needs-human-input` and keeps the browser open. Log in by hand in the
viewer, then `browser-driver stop <run-id>`. The profile keeps the login
for later runs.

## Limits

- One display can show many runs, but the windows overlap. Run one headed
  run at a time.
- VNC has no audio and no file transfer by default. It shows the page and
  takes input.
- The viewer adds latency. A headed run on a slow link is slower than a
  headless run.
