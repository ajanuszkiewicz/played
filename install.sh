#!/usr/bin/env bash
# install.sh — Run as root from inside the rpi-song-tracker directory
# Usage: cd rpi-song-tracker && sudo bash install.sh
set -euo pipefail

INSTALL_DIR=/usr/local/bin/song-tracker
DATA_DIR=/var/lib/song-tracker
CONF_DIR=/etc/song-tracker
WEB_DIR=$INSTALL_DIR/web
LOG_FILE=/var/log/song-tracker.log
SERVICE_USER=song-tracker

# Ensure we are running from the right directory
if [ ! -f "scripts/song_tracker.py" ]; then
    echo "ERROR: Please run this script from inside the rpi-song-tracker directory."
    echo "  cd rpi-song-tracker && sudo bash install.sh"
    exit 1
fi

echo "==> Updating system packages..."
apt-get update -q
apt-get install -y -q \
    python3 python3-venv python3-pip \
    alsa-utils \
    libopenblas-dev \
    ffmpeg

echo "==> Creating service user..."
id "$SERVICE_USER" &>/dev/null || \
    useradd -r -s /usr/sbin/nologin -G audio "$SERVICE_USER"

echo "==> Creating directories..."
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$CONF_DIR" "$WEB_DIR"
chown "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR"

echo "==> Creating log file..."
touch "$LOG_FILE"
chown "$SERVICE_USER":"$SERVICE_USER" "$LOG_FILE"

echo "==> Installing Python scripts..."
cp scripts/song_tracker.py "$INSTALL_DIR/"
cp scripts/web_server.py   "$INSTALL_DIR/"
chmod 644 "$INSTALL_DIR/song_tracker.py"
chmod 644 "$INSTALL_DIR/web_server.py"

echo "==> Copying web dashboard..."
cp -r web/. "$WEB_DIR/"
chmod -R 755 "$WEB_DIR"

echo "==> Creating Python virtual environment..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install -q --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -q flask shazamio

echo "==> Installing systemd services..."
cp systemd/song-tracker.service     /etc/systemd/system/
cp systemd/song-tracker-web.service /etc/systemd/system/
systemctl daemon-reload

echo "==> Setting up configuration..."
if [ ! -f "$CONF_DIR/env" ]; then
    cp env.example "$CONF_DIR/env"
    echo ""
    echo "  !! ACTION REQUIRED:"
    echo "  Edit $CONF_DIR/env and set your AUDIO_DEVICE."
    echo "  Run 'arecord -l' to find your USB audio adapter's device name."
    echo ""
fi

echo "==> Detecting audio devices..."
echo "--- Available capture devices (arecord -l) ---"
arecord -l 2>/dev/null || echo "(No capture devices found yet)"
echo "----------------------------------------------"

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Edit /etc/song-tracker/env"
echo "     - Set AUDIO_DEVICE (e.g. hw:1,0 for USB adapter)"
echo "     - Run 'arecord -l' to confirm the correct device"
echo ""
echo "  2. Enable and start services:"
echo "     sudo systemctl enable --now song-tracker song-tracker-web"
echo ""
echo "  3. Check status:"
echo "     sudo systemctl status song-tracker"
echo "     sudo journalctl -u song-tracker -f"
echo ""
echo "  4. Open the dashboard:"
echo "     http://$(hostname -I | awk '{print $1}'):8080"
