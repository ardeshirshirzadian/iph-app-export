FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm install
ENV NODE_ENV=production
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
