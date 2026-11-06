# Use official lightweight Node.js LTS Alpine image
FROM node:22-alpine

# Install git, openssh-client, ca-certificates, and tzdata
RUN apk add --no-cache git openssh-client ca-certificates tzdata

# Avoid Git "dubious ownership" errors when mounting external volumes in container
RUN git config --system --add safe.directory "*"

# Set working directory
WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source code
COPY index.js ./
COPY src/ ./src/

# Create repository working directory and ensure node user permissions
RUN mkdir -p /app/repo && chown -R node:node /app

# Switch to non-root user
USER node

# Default environment variables
ENV NODE_ENV=production \
    REPO_DIR=/app/repo

# Start the bot daemon
CMD ["node", "index.js"]
