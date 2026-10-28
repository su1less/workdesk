# 工作台云端服务容器（零依赖 Node 服务器）
FROM node:20-alpine

WORKDIR /app
COPY . .

ENV PORT=8765 NODE_ENV=production
EXPOSE 8765

# 数据与密码配置持久化挂载点（docker-compose 中映射到宿主机 ./data）
VOLUME /app/data

CMD ["node", "server.js"]
