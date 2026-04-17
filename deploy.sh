#!/usr/bin/env bash
PI=adamj@platipi.local

echo "==> Syncing files..."
rsync -av --exclude='.DS_Store' ./ $PI:/home/adamj/rpi-song-tracker/

echo "==> Deploying on Pi..."
ssh $PI "
  sudo cp ~/rpi-song-tracker/scripts/*.py /usr/local/bin/song-tracker/ &&
  sudo chmod 644 /usr/local/bin/song-tracker/*.py &&
  sudo cp -r ~/rpi-song-tracker/web/. /usr/local/bin/song-tracker/web/ &&
  sudo chmod -R 755 /usr/local/bin/song-tracker/web/ &&
  sudo cp ~/rpi-song-tracker/env.example /etc/song-tracker/env &&
  sudo cp ~/rpi-song-tracker/config/asound.conf /etc/asound.conf &&
  sudo systemctl restart song-tracker song-tracker-web &&
  echo 'Deploy complete'
"