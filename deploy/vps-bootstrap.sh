#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "run this script as root" >&2
    exit 1
fi

DEPLOY_USER=${DEPLOY_USER:-deploy}
SWAP_MB=${SWAP_MB:-2048}

. /etc/os-release
case "${ID}" in
    ubuntu|debian) ;;
    *) echo "unsupported distribution: ${ID}" >&2; exit 1 ;;
esac

apt-get update
apt-get install -y ca-certificates curl gnupg ufw

install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
fi
chmod a+r /etc/apt/keyrings/docker.asc

printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "${ID}" "${VERSION_CODENAME}" \
    > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/ex_ty
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/ex_ty/backups

if [ -n "${SSH_PUBLIC_KEY:-}" ]; then
    install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"
    touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    chown "$DEPLOY_USER:$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    grep -qxF "$SSH_PUBLIC_KEY" "/home/${DEPLOY_USER}/.ssh/authorized_keys" \
        || printf '%s\n' "$SSH_PUBLIC_KEY" >> "/home/${DEPLOY_USER}/.ssh/authorized_keys"

    cat > /etc/ssh/sshd_config.d/99-ex_ty-hardening.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin prohibit-password
EOF
    sshd -t
    systemctl reload ssh 2>/dev/null || systemctl reload sshd
fi

ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

if [ ! -f /swapfile ]; then
    fallocate -l "${SWAP_MB}M" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_MB"
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi

echo "bootstrap complete"
echo "copy deploy/env.example to /opt/ex_ty/.env and deploy/app.env.example to /opt/ex_ty/app.env"
echo "then set: chown ${DEPLOY_USER}:${DEPLOY_USER} /opt/ex_ty/.env /opt/ex_ty/app.env && chmod 600 /opt/ex_ty/.env /opt/ex_ty/app.env"
