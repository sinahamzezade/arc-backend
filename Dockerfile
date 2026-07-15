# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Vite admin dashboard CSS/JS (served at /admin-assets)
COPY --from=builder /app/public ./public
EXPOSE 9000
CMD ["node", "dist/main.js"]
