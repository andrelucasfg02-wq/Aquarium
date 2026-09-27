FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server/ ./server/
COPY public/ ./public/
ENV PORT=3000 DB_PATH=/data/aquarium.db
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
