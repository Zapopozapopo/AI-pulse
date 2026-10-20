FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/listing-source/package.json apps/listing-source/
RUN npm ci --workspace @competitor-pulse/web --include-workspace-root --ignore-scripts
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN npm run build -w @competitor-pulse/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
