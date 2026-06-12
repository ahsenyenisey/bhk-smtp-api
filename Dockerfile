FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
ARG CACHE_BUST=v3
COPY server.js ./
EXPOSE 3000
CMD ["node", "server.js"]
