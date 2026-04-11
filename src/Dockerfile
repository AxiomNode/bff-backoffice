FROM node:20-bookworm-slim AS deps
WORKDIR /workspace/bff-backoffice/src
COPY bff-backoffice/src/package.json bff-backoffice/src/package-lock.json* ./
COPY shared-sdk-client/typescript /workspace/shared-sdk-client/typescript
COPY contracts-and-schemas /workspace/contracts-and-schemas
RUN npm install -g npm@11.12.1 \
	&& npm --prefix /workspace/shared-sdk-client/typescript install \
	&& npm --prefix /workspace/shared-sdk-client/typescript run build \
	&& npm install

FROM node:20-bookworm-slim AS build
WORKDIR /workspace/bff-backoffice/src
COPY --from=deps /workspace/bff-backoffice/src/node_modules ./node_modules
COPY --from=deps /workspace/shared-sdk-client/typescript /workspace/shared-sdk-client/typescript
COPY bff-backoffice/src .
RUN npm install -g npm@11.12.1 && npm install && npm run build
RUN npm prune --production

FROM node:20-bookworm-slim AS runtime
WORKDIR /workspace/bff-backoffice/src
ENV NODE_ENV=production
COPY --from=build /workspace/bff-backoffice/src/node_modules ./node_modules
COPY --from=build /workspace/shared-sdk-client/typescript /workspace/shared-sdk-client/typescript
COPY --from=build /workspace/bff-backoffice/src/dist ./dist
COPY --from=build /workspace/bff-backoffice/src/.env.example ./.env.example
RUN chown -R node:node /workspace
USER node
EXPOSE 7011
CMD ["node", "dist/app/server.js"]
