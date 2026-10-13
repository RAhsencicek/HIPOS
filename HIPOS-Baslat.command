#!/bin/bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${TMPDIR:-/tmp}/hipos-dev"
PID_FILE="$LOG_DIR/pids"
API_PID=""
ADMIN_PID=""
POS_PID=""
TAIL_PID=""

cd "$ROOT_DIR"
mkdir -p "$LOG_DIR"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  for pid in "$TAIL_PID" "$ADMIN_PID" "$POS_PID" "$API_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$TAIL_PID" "$ADMIN_PID" "$POS_PID" "$API_PID"; do
    if [[ -n "$pid" ]]; then wait "$pid" 2>/dev/null || true; fi
  done
  if [[ -f "$PID_FILE" ]]; then rm -f "$PID_FILE"; fi
  printf '\nHIPOS uygulama süreçleri durduruldu. PostgreSQL verisi korunuyor.\n'
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
  printf '\nHATA: %s\n' "$1" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 bulunamadı. README.md içindeki kurulum gereksinimlerine bakın."
}

for command_name in docker node npm dotnet psql curl lsof; do need_command "$command_name"; done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" -ge 22 ]] || fail "Node.js 22 veya üzeri gerekli; bulunan: $(node --version)"
dotnet_major="$(dotnet --version | cut -d. -f1)"
[[ "$dotnet_major" -ge 10 ]] || fail ".NET 10 SDK gerekli; bulunan: $(dotnet --version)"

for port in 5173 5176 5180; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "${port} portu zaten kullanımda. Var olan HIPOS süreçlerini kapatıp tekrar deneyin."
  fi
done

if ! docker info >/dev/null 2>&1; then
  printf 'Docker Desktop başlatılıyor; veritabanı hazır olana kadar bekleyeceğim…\n'
  open -a Docker >/dev/null 2>&1 || true
  docker_ready=false
  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then docker_ready=true; break; fi
    sleep 2
  done
  [[ "$docker_ready" == true ]] || fail "Docker Engine başlatılamadı. Docker Desktop durumunu kontrol edip tekrar deneyin."
fi

printf '\n[1/6] Yerel PostgreSQL başlatılıyor…\n'
docker compose up -d db
database_ready=false
for _ in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U hipos -d hipos_features >/dev/null 2>&1; then
    database_ready=true
    break
  fi
  sleep 2
done
[[ "$database_ready" == true ]] || fail "PostgreSQL hazır olmadı. `docker compose ps` ile durumu kontrol edin."

if [[ ! -x "$ROOT_DIR/node_modules/.bin/vite" ]]; then
  printf '\nNode paketleri bulunamadı; npm install çalıştırılıyor…\n'
  npm install
fi
if [[ ! -f "$ROOT_DIR/apps/api/Hipos.Api/obj/project.assets.json" ]]; then
  printf '\n.NET paketleri geri yükleniyor…\n'
  dotnet restore apps/api/Hipos.Api/Hipos.Api.csproj
fi

printf '\n[2/6] Yerel Entity Framework aracı hazırlanıyor…\n'
dotnet tool restore

export HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only'
export HIPOS_DEMO_DATABASE_URL='postgresql://hipos:hipos-dev-only@127.0.0.1:5433/hipos_features'

printf '\n[3/6] Veritabanı migration’ları uygulanıyor…\n'
for context in FeatureDbContext CatalogDbContext SalesDbContext CariDbContext ServiceDbContext InventoryDbContext CashDbContext; do
  printf '  • %s\n' "$context"
  dotnet tool run dotnet-ef database update \
    --project apps/api/Hipos.Api/Hipos.Api.csproj \
    --context "$context"
done

printf '\n[4/6] Demo veri sözleşmesi ve eksik başlangıç kayıtları kontrol ediliyor…\n'
npm run demo:check
npm run demo:seed
npm run demo:seed:menus
npm run demo:seed:cari
npm run demo:seed:service
npm run demo:seed:inventory
npm run demo:seed:cash

printf '\n[5/6] API derleniyor…\n'
dotnet build apps/api/Hipos.Api/Hipos.Api.csproj --no-restore

printf '\n[6/6] API, yönetim paneli ve geliştirme Test POS başlatılıyor…\n'
(
  cd "$ROOT_DIR/apps/api/Hipos.Api"
  exec env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://127.0.0.1:5180 \
    HIPOS_FEATURE_STORAGE=postgres HIPOS_FEATURES_CONNECTION="$HIPOS_FEATURES_CONNECTION" \
    dotnet bin/Debug/net10.0/Hipos.Api.dll
) >"$LOG_DIR/api.log" 2>&1 &
API_PID=$!

api_ready=false
for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:5180/health >/dev/null 2>&1; then api_ready=true; break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "$api_ready" != true ]]; then
  tail -n 60 "$LOG_DIR/api.log" || true
  fail "API başlamadı. API logu: $LOG_DIR/api.log"
fi

(
  cd "$ROOT_DIR/apps/admin"
  exec env VITE_FEATURE_PROVIDER=http VITE_CATALOG_PROVIDER=http VITE_SALES_PROVIDER=http \
    VITE_CARI_PROVIDER=http VITE_SERVICE_PROVIDER=http VITE_INVENTORY_PROVIDER=http VITE_CASH_PROVIDER=http \
    VITE_API_BASE_URL=http://127.0.0.1:5180 HIPOS_DEV_API_TARGET=http://127.0.0.1:5180 \
    "$ROOT_DIR/node_modules/.bin/vite" --host 0.0.0.0 --port 5173 --strictPort
) >"$LOG_DIR/admin.log" 2>&1 &
ADMIN_PID=$!

(
  cd "$ROOT_DIR/apps/pos"
  exec env VITE_API_BASE_URL=http://127.0.0.1:5180 \
    "$ROOT_DIR/node_modules/.bin/vite" --host 0.0.0.0 --port 5176 --strictPort
) >"$LOG_DIR/pos.log" 2>&1 &
POS_PID=$!

# Store only the child service PIDs; HIPOS-Durdur.command validates both the
# command line and working directory before signalling any process.
printf 'api=%s\nadmin=%s\npos=%s\n' "$API_PID" "$ADMIN_PID" "$POS_PID" > "$PID_FILE"

panel_ready=false
pos_ready=false
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:5173/admin >/dev/null 2>&1; then panel_ready=true; fi
  if curl -fsS http://127.0.0.1:5176 >/dev/null 2>&1; then pos_ready=true; fi
  if [[ "$panel_ready" == true && "$pos_ready" == true ]]; then break; fi
  sleep 1
done
if [[ "$panel_ready" != true || "$pos_ready" != true ]]; then
  tail -n 50 "$LOG_DIR/admin.log" "$LOG_DIR/pos.log" || true
  fail "Panel veya Test POS başlamadı. Ayrıntı: $LOG_DIR"
fi

printf '\nHIPOS hazır.\n'
printf 'Yönetim paneli: http://localhost:5173/admin\n'
printf 'Cari hesaplar:  http://localhost:5173/admin/customers/accounts\n'
printf 'Test POS:       http://localhost:5176\n'
printf 'API sağlık:     http://localhost:5180/health\n'
printf 'Loglar:         %s\n' "$LOG_DIR"
printf 'Uygulama sunucularını durdurmak için bu Terminal penceresinde Ctrl+C kullanın. PostgreSQL verisi korunur.\n\n'

open http://localhost:5173/admin >/dev/null 2>&1 || true
tail -n 20 -F "$LOG_DIR/api.log" "$LOG_DIR/admin.log" "$LOG_DIR/pos.log" &
TAIL_PID=$!

while true; do
  if ! kill -0 "$API_PID" 2>/dev/null; then fail "API durdu. Ayrıntı: $LOG_DIR/api.log"; fi
  if ! kill -0 "$ADMIN_PID" 2>/dev/null; then fail "Yönetim paneli durdu. Ayrıntı: $LOG_DIR/admin.log"; fi
  if ! kill -0 "$POS_PID" 2>/dev/null; then fail "Test POS durdu. Ayrıntı: $LOG_DIR/pos.log"; fi
  sleep 2
done
