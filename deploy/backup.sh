#!/bin/bash
# ============================================================
# workdesk 数据异地备份 —— 服务器 data/ 与 assets/ 自动提交到
# USTC GitLab 私有分支 data-backup（每天最多一个提交，数据不变不提交）
#
# 用法（服务器 root）：  /opt/workdesk/deploy/backup.sh
# 建议配合 cron 每日执行（见 deploy/服务器部署指南.md「数据备份与迁移」）
#
# 前置：仓库的 Deploy key 需勾选"授予写权限"（GitLab → 项目 →
#       Settings → Repository → Deploy keys）
# 恢复：见指南同名章节
#
# 可用环境变量覆盖默认值：WB_SRC / WB_BAK / WB_BRANCH / WB_REPO
# ============================================================
set -e
SRC="${WB_SRC:-/opt/workdesk}"
BAK="${WB_BAK:-/root/wdesk-data-backup}"
BR="${WB_BRANCH:-data-backup}"
REPO="${WB_REPO:-git@git.ustc.edu.cn:jett/workdesk.git}"

command -v git >/dev/null 2>&1 || { echo '✘ 需要 git'; exit 1; }
command -v rsync >/dev/null 2>&1 || { echo '… 安装 rsync'; apt-get install -y rsync >/dev/null; }

# git 提交身份兜底（服务器 root 常未配置 user.name/email）
export GIT_AUTHOR_NAME="workdesk-backup" GIT_AUTHOR_EMAIL="backup@workdesk.local"
export GIT_COMMITTER_NAME="workdesk-backup" GIT_COMMITTER_EMAIL="backup@workdesk.local"

[ -f "$SRC/data/db.json" ] || { echo "✘ 未找到 $SRC/data/db.json（服务器数据不存在？）"; exit 1; }

# 1) 备份用克隆目录初始化（与运行目录完全分离，互不影响）
if [ ! -d "$BAK/.git" ]; then
  echo "… 首次初始化备份克隆 $BAK"
  git clone -q "$REPO" "$BAK"
fi
cd "$BAK"

# 2) 切到/创建备份分支
if git show-ref --verify --quiet "refs/heads/$BR"; then
  git checkout -q "$BR"
elif git ls-remote --exit-code --heads origin "$BR" >/dev/null 2>&1; then
  git fetch -q origin "$BR" && git checkout -q -B "$BR" "origin/$BR"
else
  git checkout -q --orphan "$BR"
  git rm -rqf . >/dev/null 2>&1 || true   # 清掉代码文件，本分支只放数据
fi

# 3) 镜像复制数据（--delete 同步删除，保持与服务器一致）
rsync -a --delete --exclude '.git' "$SRC/data/" "$BAK/data/"
if [ -d "$SRC/assets" ]; then
  rsync -a --delete "$SRC/assets/" "$BAK/assets/"
else
  mkdir -p "$BAK/assets"
fi

# 4) 有变化才提交推送
git add -Af data assets
if git diff --cached --quiet; then
  echo "[$(date '+%F %H:%M')] 数据无变化，无需备份"
else
  git commit -qm "数据备份 $(date '+%F %H:%M')"
  git push -q origin "$BR"
  echo "[$(date '+%F %H:%M')] ✔ 已备份并推送到分支 $BR"
fi
