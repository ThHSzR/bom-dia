#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
: "${PREFIX:?Execute no Termux}"
PROJECT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)"
SERVICE_DIR="$PREFIX/var/service/bom-dia"
LOG_DIR="$PREFIX/var/log/sv/bom-dia"
command -v sv >/dev/null || { echo 'Instale termux-services primeiro.'; exit 1; }
test -f "$PROJECT_DIR/config.json" || { echo 'Crie config.json primeiro.'; exit 1; }
test -f "$PROJECT_DIR/data/auth/session.json" || { echo 'Execute npm run pair primeiro.'; exit 1; }
if test -d "$SERVICE_DIR"; then
  echo 'O servico bom-dia ja existe. Use sv restart bom-dia; nao foi sobrescrito.'
  exit 1
fi
mkdir -p "$SERVICE_DIR/log" "$LOG_DIR" "$HOME/.termux/boot"
touch "$SERVICE_DIR/down"
{
  printf '#!%s/bin/bash\n' "$PREFIX"
  printf 'export PATH=%q:$PATH\n' "$PREFIX/bin"
  printf 'cd -- %q || exit 1\n' "$PROJECT_DIR"
  printf 'umask 077\nexec 2>&1\nexec node src/index.js\n'
} > "$SERVICE_DIR/run"
{
  printf '#!%s/bin/bash\n' "$PREFIX"
  printf 'exec %q -tt %q\n' "$PREFIX/bin/svlogd" "$LOG_DIR"
} > "$SERVICE_DIR/log/run"
{
  printf '#!%s/bin/bash\n' "$PREFIX"
  printf 'if [ "$1" = 1 ] || [ "$1" = 2 ]; then\n  touch ./down\n  sv down .\nfi\n'
} > "$SERVICE_DIR/finish"
printf 's1000000\nn5\n' > "$LOG_DIR/config"
{
  printf '#!%s/bin/bash\n' "$PREFIX"
  printf 'export PATH=%q:$PATH\n' "$PREFIX/bin"
  printf 'termux-wake-lock\n. %q\n' "$PREFIX/etc/profile.d/start-services.sh"
} > "$HOME/.termux/boot/20-bom-dia-services"
chmod 700 "$SERVICE_DIR/run" "$SERVICE_DIR/finish" "$SERVICE_DIR/log/run" "$HOME/.termux/boot/20-bom-dia-services"
termux-wake-lock
. "$PREFIX/etc/profile.d/start-services.sh"
echo 'Instalado, ainda desativado. Para iniciar: sv-enable bom-dia'
echo 'Abra o aplicativo Termux:Boot uma vez e retire as restricoes de bateria dos dois apps.'
