#!/bin/bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${TMPDIR:-/tmp}/hipos-dev"
PID_FILE="$LOG_DIR/pids"

KEEP_DB=false
DRY_RUN=false
for option in "$@"; do
  case "$option" in
    --keep-db) KEEP_DB=true ;;
    --dry-run) DRY_RUN=true ;;
    *) printf 'Kullanım: %s [--dry-run] [--keep-db]\n' "$(basename "$0")" >&2; exit 2 ;;
  esac
done

process_matches() {
  local pid="$1" expected_command="$2" expected_cwd="$3" command_line cwd
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ -n "$command_line" && "$command_line" == *"$expected_command"* ]] || return 1
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  [[ "$cwd" == "$expected_cwd" ]]
}

pid_from_file() {
  local key="$1"
  [[ -f "$PID_FILE" ]] || return 0
  awk -F= -v wanted="$key" '$1 == wanted { print $2; exit }' "$PID_FILE"
}

stop_service() {
  local label="$1" key="$2" port="$3" expected_command="$4" expected_cwd="$5"
  local pid attempt
  pid="$(pid_from_file "$key")"
  if [[ -z "$pid" ]]; then
    pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  fi
  if [[ -z "$pid" ]]; then
    printf '• %s zaten kapalı.\n' "$label"
    return 0
  fi
  if ! process_matches "$pid" "$expected_command" "$expected_cwd"; then
    printf '• %s için bulunan PID (%s) HIPOS süreci olarak doğrulanmadı; dokunmadım.\n' "$label" "$pid"
    return 0
  fi

  if [[ "$DRY_RUN" == true ]]; then
    printf '• %s çalışıyor (PID %s); dry-run nedeniyle durdurulmadı.\n' "$label" "$pid"
    return 0
  fi

  printf '• %s durduruluyor (PID %s)…\n' "$label" "$pid"
  kill -TERM "$pid" 2>/dev/null || true
  for attempt in $(seq 1 10); do
    if ! process_matches "$pid" "$expected_command" "$expected_cwd"; then
      printf '  Durduruldu.\n'
      return 0
    fi
    sleep 1
  done

  if process_matches "$pid" "$expected_command" "$expected_cwd"; then
    printf '  Normal kapanış tamamlanmadı; yalnızca doğrulanmış HIPOS sürecine zorla kapanış gönderiliyor.\n'
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

if ! command -v lsof >/dev/null 2>&1; then
  printf 'HATA: lsof bulunamadı; süreçleri güvenli biçimde doğrulayamıyorum.\n' >&2
  exit 1
fi

printf '\nHIPOS uygulama servisleri durduruluyor…\n'
stop_service "Yönetim API'si (5180)" api 5180 "Hipos.Api.dll" "$ROOT_DIR/apps/api/Hipos.Api"
stop_service "Yönetim paneli (5173)" admin 5173 "node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort" "$ROOT_DIR/apps/admin"
stop_service "Test POS (5176)" pos 5176 "node_modules/.bin/vite --host 0.0.0.0 --port 5176 --strictPort" "$ROOT_DIR/apps/pos"

if [[ "$KEEP_DB" == false && "$DRY_RUN" == true ]]; then
  printf '\nDry-run: HIPOS PostgreSQL konteyneri de durdurma hedefinde; hiçbir şey değiştirilmedi.\n'
elif [[ "$KEEP_DB" == false ]]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    printf '\nHIPOS PostgreSQL konteyneri durduruluyor; veritabanı dosyaları korunuyor…\n'
    if docker compose -f "$ROOT_DIR/compose.yaml" stop db; then
      printf '• PostgreSQL durduruldu. Veriyi silmek için volume silinmedi.\n'
    else
      printf 'UYARI: PostgreSQL konteyneri durdurulamadı. Uygulama servisleri yine de kapatıldı.\n' >&2
    fi
  else
    printf '\nDocker kapalı veya kullanılamıyor; PostgreSQL için işlem yapılmadı.\n'
  fi
else
  printf '\n--keep-db seçildi; PostgreSQL çalışmaya devam ediyor.\n'
fi

if [[ "$DRY_RUN" == false && -f "$PID_FILE" ]]; then rm -f "$PID_FILE"; fi
if [[ "$DRY_RUN" == true ]]; then
  printf '\nDry-run tamamlandı; hiçbir süreç veya konteyner durdurulmadı.\n'
else
  printf '\nHIPOS durdurma işlemi tamamlandı. Proje veritabanı silinmedi.\n'
fi
