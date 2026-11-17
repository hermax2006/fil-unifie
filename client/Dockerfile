# Client Fil Unifié — build Vite puis service statique nginx.
# nginx fait aussi proxy vers le serveur : tout passe par la même origine
# (plus de CORS, cookies simples).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY client/package.json client/package-lock.json* ./
COPY shared/ /app/shared/
# @fil/shared est un package local du monorepo : on pointe npm dessus avant l'install.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies['@fil/shared']='file:/app/shared';fs.writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
