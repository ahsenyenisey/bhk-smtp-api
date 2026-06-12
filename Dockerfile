FROM node:22-alpine
RUN mkdir -p /srv/app && chown node:node /srv/app
WORKDIR /srv/app
USER node
COPY --chown=node:node package.json package-lock.json* ./
RUN npm install --production
COPY --chown=node:node server.js ./
EXPOSE 3000
CMD ["node", "server.js"]
