# Build stage - build the React client
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY client/package*.json ./client/

# Install dependencies
RUN npm ci
RUN cd client && npm ci

# Copy source code
COPY . .

# Build the client
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server code
COPY server ./server

# Copy built client from builder stage
COPY --from=builder /app/client/dist ./client/dist

# Create directories for data and library
RUN mkdir -p /data /library

# Environment variables with defaults
ENV PORT=3001
ENV DATA_PATH=/data
ENV LIBRARY_PATH=/library

# Expose the port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/auth/status || exit 1

# Run the server
CMD ["node", "server/index.js"]
