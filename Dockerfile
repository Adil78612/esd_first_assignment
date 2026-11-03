FROM node:22-slim

# build tools for native modules (better-sqlite3 compiles from source)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY app.js db.js grpc_server.js start.js generations.proto openapi.yaml ./
EXPOSE 3000 50051 9091
CMD ["node", "start.js"]