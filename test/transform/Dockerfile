FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY run.js ./
COPY cases ./cases

# transform.js is mounted at runtime, not baked in — see docker-compose.test.yml:
#   ./plugin/src/src/transform.js → /app/transform.js (read-only)
ENV TRANSFORM_PATH=/app/transform.js

CMD ["node", "run.js"]
