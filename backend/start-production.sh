#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_BIN=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
        PYTHON_BIN="$(command -v "$candidate")"
        break
    fi
done

if [ -z "$PYTHON_BIN" ]; then
    echo "No supported Python interpreter found."
    exit 1
fi

VENV_DIR="$SCRIPT_DIR/venv"
VENV_PYTHON="$VENV_DIR/bin/python"
VENV_PIP="$VENV_DIR/bin/pip"
VENV_GUNICORN="$VENV_DIR/bin/gunicorn"

rebuild_venv() {
    echo "Rebuilding virtual environment..."
    rm -rf "$VENV_DIR"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
}

if [ ! -x "$VENV_PYTHON" ]; then
    echo "Creating virtual environment..."
    "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

if [ -f "$VENV_PIP" ]; then
    PIP_SHEBANG="$(sed -n '1p' "$VENV_PIP" || true)"
    case "$PIP_SHEBANG" in
        "#!$SCRIPT_DIR/"* | "#!/usr/bin/env "*)
            ;;
        *)
            rebuild_venv
            ;;
    esac
fi

if ! "$VENV_PYTHON" -c "import pkg_resources" >/dev/null 2>&1; then
    echo "Installing production dependencies..."
    "$VENV_PIP" install --upgrade pip setuptools wheel
    "$VENV_PIP" install --upgrade --force-reinstall -r requirements.txt
fi

if [ ! -x "$VENV_GUNICORN" ]; then
    echo "Installing Gunicorn..."
    "$VENV_PIP" install --upgrade --force-reinstall -r requirements.txt
fi

export FLASK_ENV="${FLASK_ENV:-production}"
export PORT="${PORT:-8000}"

exec "$VENV_GUNICORN" -c gunicorn.conf.py wsgi:app
