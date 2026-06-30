FROM node:22-slim
WORKDIR /app
# 1. Copy all files and packages
COPY . .
# Install dependencies
RUN npm install
# 2. Build the project
ENV NODE_ENV=production
RUN npm run build
# Critical: start the Next.js production server, listening on port 3000
EXPOSE 3000
CMD ["npm", "start"]
