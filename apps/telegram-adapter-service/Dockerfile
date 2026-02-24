FROM node:20-alpine

WORKDIR /app

COPY apps/telegram-adapter-service/package*.json ./
RUN npm install

COPY apps/telegram-adapter-service ./
RUN npm run build

EXPOSE 3050
CMD ["npm", "start"]
