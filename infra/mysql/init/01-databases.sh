#!/bin/bash
# One database and one user per service (spec 00). Runs once, on an empty data volume.
set -euo pipefail

create_db() {
  local db="$1" pass="$2"
  MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '$db'@'%' IDENTIFIED BY '$pass';
GRANT ALL PRIVILEGES ON \`$db\`.* TO '$db'@'%';
SQL
}

create_db api "$MYSQL_PASSWORD_API"
create_db mcp "$MYSQL_PASSWORD_MCP"
create_db bank "$MYSQL_PASSWORD_BANK"
create_db regulator "$MYSQL_PASSWORD_REGULATOR"
create_db operator "$MYSQL_PASSWORD_OPERATOR"
create_db payout "$MYSQL_PASSWORD_PAYOUT"
create_db weid "$MYSQL_PASSWORD_WEID"
create_db webase "$MYSQL_PASSWORD_WEBASE"
create_db wecross "$MYSQL_PASSWORD_WECROSS"
create_db bundler "$MYSQL_PASSWORD_BUNDLER"
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "FLUSH PRIVILEGES;"
