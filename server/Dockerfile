# Serveur Fil Unifié — build TS puis exécution de dist/.
# Base Debian (glibc) : les binaires précompilés de better-sqlite3 s'utilisent tels quels.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
COPY shared/ /app/shared/
# @fil/shared est un package local du monorepo : on pointe npm dessus avant l'install.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies['@fil/shared']='file:/app/shared';fs.writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN npm install --no-audit --no-fund
COPY server/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# tsc ne copie pas les fichiers non-TS : le SQL de migration vit à côté du code compilé.
COPY --from=build /app/src/db/schema.sql ./dist/db/schema.sql
# La base SQLite vit dans /app/data (volume docker en prod).
RUN mkdir -p /app/data
EXPOSE 4000
CMD ["node", "dist/index.js"]
