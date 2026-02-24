FROM node:20-alpine

WORKDIR /app

COPY apps/whatsapp-adapter-service/package*.json ./
RUN npm install

COPY apps/whatsapp-adapter-service ./
RUN npm run build

EXPOSE 3051
CMD ["npm", "start"]
