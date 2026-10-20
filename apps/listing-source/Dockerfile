FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4002 FIXTURES_PATH=/app/fixtures/listings.json
COPY apps/listing-source/package.json ./
COPY apps/listing-source/src ./src
COPY fixtures ./fixtures
USER node
EXPOSE 4002
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:4002/health || exit 1
CMD ["node", "src/server.ts"]
