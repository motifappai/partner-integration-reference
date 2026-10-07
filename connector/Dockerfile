FROM node:24.18.0-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/motifappai/partner-integration-reference"
LABEL org.opencontainers.image.description="Motif partner RabbitMQ connector"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node src ./src
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8080/health').then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/main.ts"]
