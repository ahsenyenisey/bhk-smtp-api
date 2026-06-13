FROM node:22-alpine
WORKDIR /opt/bhk
COPY package.json package-lock.json* ./
RUN npm install --production
COPY contact-api.js ./
EXPOSE 3000
CMD ["node", "contact-api.js"]
